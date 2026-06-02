import { sanitizeProcessoLGPD, PjeProcesso } from '../pje-tools.js';
import { PjeService, ProcessoNaoEncontradoError } from '../pje-service.js';
import { MCPBridge } from '../mcp-bridge.js';

// Mock do MCPBridge para testar o PjeService isoladamente
jest.mock('../mcp-bridge.js');

describe('PJe Integration Service Suite', () => {

  describe('PJe Tools - LGPD Sanitization', () => {
    it('deve mascarar CPFs corretamente mantendo apenas os 3 últimos dígitos e o dígito verificador', () => {
      const mockProcesso: PjeProcesso = {
        numeroProcesso: '08012345620268150001',
        classe: 'Procedimento Comum',
        assunto: 'Danos Morais',
        orgaoJulgador: '1ª Vara Cível de João Pessoa',
        partes: [
          { tipo: 'ATIVO', nome: 'Fulano de Tal', cpfCnpj: '12345678901' },
          { tipo: 'PASSIVO', nome: 'Empresa Ficticia S.A.', cpfCnpj: '12345678000199' }
        ]
      };

      const sanitizado = sanitizeProcessoLGPD(mockProcesso);
      expect(sanitizado.partes[0].cpfCnpj).toBe('***.***.789-01');
      expect(sanitizado.partes[1].cpfCnpj).toBe('**.***.***/0001-99');
    });

    it('deve anonimizar nomes de terceiros não relacionados', () => {
      const mockProcesso: PjeProcesso = {
        numeroProcesso: '08012345620268150001',
        classe: 'Procedimento Comum',
        assunto: 'Danos Morais',
        orgaoJulgador: '1ª Vara Cível',
        partes: [
          { tipo: 'ATIVO', nome: 'Fulano de Tal' },
          { tipo: 'Terceiro', nome: 'Testemunha Maria Souza Pereira' }
        ]
      };

      const sanitizado = sanitizeProcessoLGPD(mockProcesso);
      expect(sanitizado.partes[0].nome).toBe('Fulano de Tal'); // Mantém
      expect(sanitizado.partes[1].nome).toBe('Testemunha M. S. P.'); // Anonimiza
    });
  });

  describe('PjeService', () => {
    let mockBridge: jest.Mocked<MCPBridge>;
    let service: PjeService;

    beforeEach(() => {
      jest.clearAllMocks();
      mockBridge = new MCPBridge() as jest.Mocked<MCPBridge>;
      service = new PjeService(mockBridge);
    });

    it('deve buscar processo do PJe, validar schema, aplicar LGPD e armazenar no cache', async () => {
      const cnj = '08012345620268150001';
      const mockPayload = {
        result: {
          numeroProcesso: cnj,
          classe: 'Procedimento Comum',
          assunto: 'Cível',
          orgaoJulgador: '1ª Vara',
          partes: [
            { tipo: 'Autor', nome: 'Fulano', cpfCnpj: '12345678901' }
          ]
        }
      };

      mockBridge.callTool.mockResolvedValue({
        content: [
          { type: 'text', text: JSON.stringify(mockPayload) }
        ]
      });

      const auditSpy = jest.spyOn(console, 'log');

      const processo = await service.buscarProcesso(cnj, 'OAB-PB12345', 'TEST-REQ-1');

      expect(processo.numeroProcesso).toBe(cnj);
      expect(processo.partes[0].cpfCnpj).toBe('***.***.789-01'); // Sanitizado
      expect(mockBridge.callTool).toHaveBeenCalledWith('pje_buscar_processo', { id: cnj });
      
      // Valida se registrou logs de auditoria
      expect(auditSpy).toHaveBeenCalled();
      const lastAuditLog = JSON.parse(auditSpy.mock.calls[0][0]);
      expect(lastAuditLog.type).toBe('AUDIT_SECURITY_PJE');
      expect(lastAuditLog.operador).toBe('OAB-PB12345');
    });

    it('deve retornar do cache em chamadas consecutivas dentro do TTL sem invocar a bridge novamente', async () => {
      const cnj = '08012345620268150001';
      const mockPayload = {
        numeroProcesso: cnj,
        classe: 'Procedimento Comum',
        assunto: 'Cível',
        orgaoJulgador: '1ª Vara',
        partes: [{ tipo: 'Autor', nome: 'Fulano' }]
      };

      mockBridge.callTool.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockPayload) }]
      });

      // Primeira chamada (popula cache)
      await service.buscarProcesso(cnj, 'OAB-123', 'REQ-1');
      // Segunda chamada (deve usar cache)
      await service.buscarProcesso(cnj, 'OAB-123', 'REQ-2');

      expect(mockBridge.callTool).toHaveBeenCalledTimes(1);
    });

    it('deve lançar ProcessoNaoEncontradoError se a resposta for nula ou inválida', async () => {
      const cnj = '99999999999999999999';
      mockBridge.callTool.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ success: false }) }]
      });

      await expect(service.buscarProcesso(cnj, 'OAB-123', 'REQ-3'))
        .rejects.toThrow(ProcessoNaoEncontradoError);
    });
  });
});
