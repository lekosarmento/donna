import { jest } from '@jest/globals';

// Mock do cliente Supabase para isolar a regra de negócio de persistência
jest.unstable_mockModule('../../src/config/supabase.js', () => {
  const mockSingle = jest.fn();
  const mockEq = jest.fn().mockReturnThis();
  const mockSelect = jest.fn().mockReturnThis();
  const mockFrom = jest.fn().mockReturnValue({
    select: mockSelect,
    eq: mockEq,
    single: mockSingle
  });
  return {
    supabase: {
      from: mockFrom
    }
  };
});

// Importações dinâmicas após o mock para garantir o interceptamento do ESM
const { LgpdHandler } = await import('../../src/compliance/lgpd-handler.js');
const { SigiloGuard } = await import('../../src/security/sigilo-guard.js');
const { supabase } = await import('../../src/config/supabase.js');

describe('Sigilo e Compliance Jurídico - Art. 189 CPC & LGPD', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('LgpdHandler.classificarSigilo', () => {
    it('deve classificar processo público normalmente', () => {
      const proc = {
        numeroProcesso: '0001234-56.2026.8.15.0001',
        classe: 'Ação Cível Ordinária',
        assunto: 'Cobrança Tributária',
        orgaoJulgador: '1ª Vara da Fazenda Pública'
      };

      const result = LgpdHandler.classificarSigilo(proc);
      expect(result.nivel).toBe('publico');
      expect(result.artigo).toContain('93, inciso IX');
    });

    it('deve detectar segredo de justiça por classe CNJ de Divórcio Consensual', () => {
      const proc = {
        numeroProcesso: '0001234-56.2026.8.15.0001',
        classe: 'Divórcio Consensual',
        classeId: '1116',
        assunto: 'Dissolução do Casamento',
        orgaoJulgador: '1ª Vara de Família'
      };

      const result = LgpdHandler.classificarSigilo(proc);
      expect(result.nivel).toBe('segredo');
      expect(result.artigo).toContain('189, inciso II');
    });

    it('deve detectar segredo de justiça por violência doméstica (Maria da Penha) no assunto', () => {
      const proc = {
        numeroProcesso: '0001234-56.2026.8.15.0001',
        classe: 'Medida Protetiva',
        assunto: 'Violência Doméstica Contra a Mulher',
        orgaoJulgador: 'Juizado de Violência Doméstica'
      };

      const result = LgpdHandler.classificarSigilo(proc);
      expect(result.nivel).toBe('segredo');
      expect(result.artigo).toContain('189, inciso III');
    });

    it('deve detectar segredo de justiça em processo com interesse de menor/adoção', () => {
      const proc = {
        numeroProcesso: '0001234-56.2026.8.15.0001',
        classe: 'Procedimento Comum Cível',
        assunto: 'Adoção de Criança',
        orgaoJulgador: 'Vara da Infância e Juventude'
      };

      const result = LgpdHandler.classificarSigilo(proc);
      expect(result.nivel).toBe('segredo');
      expect(result.artigo).toContain('Artigo 143');
    });

    it('deve classificar processo contendo dados sensíveis de saúde mental como restrito', () => {
      const proc = {
        numeroProcesso: '0001234-56.2026.8.15.0001',
        classe: 'Interdição',
        assunto: 'Internação Compulsória e Saúde Mental',
        orgaoJulgador: '1ª Vara Cível'
      };

      const result = LgpdHandler.classificarSigilo(proc);
      expect(result.nivel).toBe('restrito');
      expect(result.artigo).toContain('Artigo 5º, inciso X');
    });
  });

  describe('SigiloGuard.verificarLegitimidade e Censura', () => {
    const mockProcessoSegredo = {
      numeroProcesso: '0800123-45.2026.8.15.0001',
      classe: 'Guarda',
      assunto: 'Disputa de Guarda e Alimentos',
      orgaoJulgador: '3ª Vara de Família',
      partes: [
        { tipo: 'Autor', nome: 'Carlos de Souza', oab: 'OAB/PB 99999' },
        { tipo: 'Réu', nome: 'Maria dos Anjos', advogados: [{ oab: 'OAB/PB 88888' }] }
      ],
      movimentos: [
        { data: '01/06/2026', descricao: 'Decisão deferindo alimentos provisórios.' }
      ]
    };

    it('deve permitir acesso completo se a OAB do advogado executor constar nos polos', async () => {
      // Configurar mock do Supabase para retornar OAB correspondente à OAB/PB 99999
      (supabase.from('usuarios').select('oab').eq('id', 'usr-legitimo').single as any).mockResolvedValue({
        data: { oab: 'OAB/PB 99999' },
        error: null
      });

      const res = await SigiloGuard.protegerProcesso(mockProcessoSegredo, 'usr-legitimo', 'corr-1');
      
      expect(res.bloqueado).toBeUndefined();
      expect(res.partes[0].nome).toBe('Carlos de Souza');
      expect(res.movimentos.length).toBe(1);
      expect(res.sigiloInfo.legitimidadeConfirmada).toBe(true);
    });

    it('deve bloquear acesso aos autos e censurar tudo se o advogado NÃO constar nos polos', async () => {
      // Advogado com OAB não cadastrada no processo
      (supabase.from('usuarios').select('oab').eq('id', 'usr-invasor').single as any).mockResolvedValue({
        data: { oab: 'OAB/PB 11111' },
        error: null
      });

      const res = await SigiloGuard.protegerProcesso(mockProcessoSegredo, 'usr-invasor', 'corr-2');
      
      expect(res.bloqueado).toBe(true);
      expect(res.mensagemBloqueio).toContain('Acesso restrito');
      expect(res.partes[0].nome).toBe('SEGREDO DE JUSTIÇA (Acesso Bloqueado)');
      expect(res.movimentos.length).toBe(0);
      expect(res.fundamentacaoLegal).toContain('direito de família');
      expect(res.artigoCPC).toContain('Artigo 189, inciso II');
    });

    it('deve aplicar censura parcial (redact de dados sensíveis e vulneráveis) em nível restrito mesmo sem legitimidade', async () => {
      const mockProcessoRestrito = {
        numeroProcesso: '0800777-12.2026.8.15.0001',
        classe: 'Interdição',
        assunto: 'Tutela Cível por Doença Mental',
        orgaoJulgador: '1ª Vara Cível',
        partes: [
          { tipo: 'Autor', nome: 'Paulo Santos' },
          { tipo: 'Vítima', nome: 'Menor de Idade da Silva' }
        ],
        movimentos: [
          { data: '02/06/2026', descricao: 'Decisão sobre laudo psiquiátrico de esquizofrenia.' }
        ]
      };

      (supabase.from('usuarios').select('oab').eq('id', 'usr-externo').single as any).mockResolvedValue({
        data: { oab: 'OAB/PB 55555' },
        error: null
      });

      const res = await SigiloGuard.protegerProcesso(mockProcessoRestrito, 'usr-externo', 'corr-3');
      
      expect(res.bloqueado).toBeUndefined(); // Não é segredo absoluto, apenas restrito
      expect(res.partes[0].nome).toBe('Paulo S.'); // Sobrenome omitido (LGPD)
      expect(res.partes[1].nome).toBe('PARTE VULNERÁVEL (OMITIDA SOB LGPD)'); // Menor/Vítima censurada
      expect(res.movimentos[0].descricao).toContain('[INFORMAÇÃO MÉDICA CONFIDENCIAL SUPRIMIDA]'); // Laudo psiquiátrico suprimido
    });
  });
});
