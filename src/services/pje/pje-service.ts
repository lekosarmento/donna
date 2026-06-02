import { MCPBridge } from './mcp-bridge.js';
import { 
  PjeProcesso, 
  pjeProcessoSchema
} from './pje-tools.js';
import { LgpdHandler } from '../../compliance/lgpd-handler.js';
import { AuditLogger } from '../../compliance/audit-logger.js';

#region Erros de Domínio Tipados

export class PjeDomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'PjeDomainError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProcessoNaoEncontradoError extends PjeDomainError {
  constructor(numeroProcesso: string) {
    super(`Processo judicial ${numeroProcesso} não foi localizado no PJe do tribunal.`, 'PJE_PROCESSO_NAO_ENCONTRADO');
    this.name = 'ProcessoNaoEncontradoError';
  }
}

export class CertificadoInvalidoError extends PjeDomainError {
  constructor(details: string) {
    super(`Falha na validação do certificado digital A1: ${details}`, 'PJE_CERTIFICADO_INVALIDO');
    this.name = 'CertificadoInvalidoError';
  }
}

export class ConexaoMcpError extends PjeDomainError {
  constructor(details: string) {
    super(`Erro de comunicação com a ponte MCP do PJe: ${details}`, 'PJE_CONEXAO_MCP_FALHOU');
    this.name = 'ConexaoMcpError';
  }
}

export class RespostaInvalidaError extends PjeDomainError {
  constructor(details: string) {
    super(`Formato de resposta retornado pelo PJe é inválido: ${details}`, 'PJE_RESPOSTA_INVALIDA');
    this.name = 'RespostaInvalidaError';
  }
}

export class RateLimitExcedidoError extends PjeDomainError {
  constructor(userId: string) {
    super(`Limite de requisições excedido para o usuário ${userId} (máximo de 60 requisições por minuto).`, 'PJE_RATE_LIMIT_EXCEDIDO');
    this.name = 'RateLimitExcedidoError';
  }
}

export class CircuitBreakerOpenError extends PjeDomainError {
  constructor() {
    super('A conexão com o PJe MCP Server está temporariamente suspensa devido a falhas consecutivas (Circuit Breaker Ativo).', 'PJE_CIRCUIT_BREAKER_ABERTO');
    this.name = 'CircuitBreakerOpenError';
  }
}

#endregion

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

/**
 * Serviço de alto nível da Donna para integração com o Processo Judicial Eletrônico (PJe).
 * Implementa Rate Limiting por usuário, Circuit Breaker de proteção da ponte MCP,
 * cache de 5 minutos com regras de privacidade e auditorias em conformidade com a LGPD.
 */
export class PjeService {
  private bridge: MCPBridge;
  private cache: Map<string, CacheEntry<PjeProcesso>> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // TTL estrito de 5 minutos (LGPD)

  // Rate Limiting por Operador
  private requestTimestamps: Map<string, number[]> = new Map();
  private readonly MAX_REQ_PER_MINUTE = 60;

  // Circuit Breaker da Ponte MCP
  private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly FAILURE_THRESHOLD = 5;
  private readonly COOLDOWN_MS = 30000; // 30 segundos de cooldown

  constructor(bridge: MCPBridge) {
    this.bridge = bridge;
  }

  /**
   * Busca as informações completas de um processo pelo número CNJ.
   * Aplica cache de 5 minutos, controle de vazão, resiliência de conexões e auditoria LGPD.
   */
  public async buscarProcesso(numeroProcesso: string, operadorId: string, correlationId: string): Promise<PjeProcesso> {
    // 1. Controle de Vazão (Rate Limiting)
    this.checkRateLimit(operadorId);

    // 2. Proteção de Infraestrutura (Circuit Breaker)
    this.checkCircuitBreaker();

    // 3. Auditoria LGPD: Registrar finalidade e base legal (Art. 7, VI)
    LgpdHandler.auditLgpdAccess(operadorId, 'CONSULTAR_PROCESSO', numeroProcesso, correlationId);

    // 4. Verificar Cache local
    const cached = this.cache.get(numeroProcesso);
    if (cached && cached.expiry > Date.now()) {
      this.logStructured('info', 'Processo recuperado do cache em memória.', { numeroProcesso, correlationId });
      AuditLogger.log({ correlationId, userId: operadorId, action: 'BUSCAR_PROCESSO_CACHE', resource: numeroProcesso, result: 'SUCCESS' });
      return cached.data;
    }

    try {
      // 5. Invocar ferramenta do MCP Server
      const rawResult = await this.bridge.callTool('pje_buscar_processo', { id: numeroProcesso });
      
      if (!rawResult) {
        throw new ProcessoNaoEncontradoError(numeroProcesso);
      }

      let parsedData: any;
      if (typeof rawResult === 'object' && rawResult.content) {
        const textContent = rawResult.content.find((c: any) => c.type === 'text')?.text;
        if (!textContent) {
          throw new RespostaInvalidaError('Nenhum texto retornado no payload MCP.');
        }

        const jsonStartIndex = textContent.indexOf('{');
        const jsonEndIndex = textContent.lastIndexOf('}');
        if (jsonStartIndex === -1 || jsonEndIndex === -1) {
          throw new RespostaInvalidaError('JSON de dados processuais não localizado na resposta textual.');
        }
        parsedData = JSON.parse(textContent.substring(jsonStartIndex, jsonEndIndex + 1));
      } else {
        parsedData = rawResult;
      }

      if (parsedData.success === false || (parsedData.result && parsedData.result.numeroProcesso === undefined)) {
        throw new ProcessoNaoEncontradoError(numeroProcesso);
      }

      const processoBruto = parsedData.result || parsedData.processo || parsedData;

      // 6. Validar o schema usando Zod
      const validation = pjeProcessoSchema.safeParse(processoBruto);
      if (!validation.success) {
        const issues = validation.error.issues.map(i => i.message).join(', ');
        throw new RespostaInvalidaError(`Validação Zod do PJe falhou: ${issues}`);
      }

      // 7. Pseudonimização LGPD antes de persistir em cache
      const processoSanitizado = LgpdHandler.pseudonimizeProcesso(validation.data);

      // 8. Atualizar cache local
      this.cache.set(numeroProcesso, {
        data: processoSanitizado,
        expiry: Date.now() + this.CACHE_TTL_MS
      });

      // Registrar sucesso no Circuit Breaker
      this.recordSuccess();

      // Logar Auditoria SIEM
      AuditLogger.log({ correlationId, userId: operadorId, action: 'BUSCAR_PROCESSO_PJE', resource: numeroProcesso, result: 'SUCCESS' });

      return processoSanitizado;
    } catch (error) {
      this.recordFailure();
      AuditLogger.log({ correlationId, userId: operadorId, action: 'BUSCAR_PROCESSO_PJE', resource: numeroProcesso, result: 'FAILED' });
      this.handleError(error, numeroProcesso, correlationId);
    }
  }

  /**
   * Consulta a lista de processos associados aos termos informados.
   */
  public async listarProcessos(filtro: string, operadorId: string, correlationId: string): Promise<PjeProcesso[]> {
    this.checkRateLimit(operadorId);
    this.checkCircuitBreaker();
    LgpdHandler.auditLgpdAccess(operadorId, 'LISTAR_PROCESSOS', filtro, correlationId);

    try {
      const rawResult = await this.bridge.callTool('pje_listar_processos', { filter: filtro });
      
      let parsedData: any;
      if (typeof rawResult === 'object' && rawResult.content) {
        const textContent = rawResult.content.find((c: any) => c.type === 'text')?.text;
        if (!textContent) return [];
        
        const jsonStartIndex = textContent.indexOf('[');
        const jsonEndIndex = textContent.lastIndexOf(']');
        if (jsonStartIndex === -1 || jsonEndIndex === -1) {
          const objStart = textContent.indexOf('{');
          const objEnd = textContent.lastIndexOf('}');
          if (objStart === -1 || objEnd === -1) return [];
          parsedData = [JSON.parse(textContent.substring(objStart, objEnd + 1))];
        } else {
          parsedData = JSON.parse(textContent.substring(jsonStartIndex, jsonEndIndex + 1));
        }
      } else {
        parsedData = Array.isArray(rawResult) ? rawResult : [rawResult];
      }

      const listaBruta = Array.isArray(parsedData) ? parsedData : (parsedData.result || []);
      const resultados: PjeProcesso[] = [];

      for (const item of listaBruta) {
        const validation = pjeProcessoSchema.safeParse(item);
        if (validation.success) {
          // Pseudonimiza cada item retornado na lista
          resultados.push(LgpdHandler.pseudonimizeProcesso(validation.data));
        }
      }

      this.recordSuccess();
      AuditLogger.log({ correlationId, userId: operadorId, action: 'LISTAR_PROCESSOS_PJE', resource: filtro, result: 'SUCCESS' });
      return resultados;
    } catch (error) {
      this.recordFailure();
      AuditLogger.log({ correlationId, userId: operadorId, action: 'LISTAR_PROCESSOS_PJE', resource: filtro, result: 'FAILED' });
      throw new ConexaoMcpError(`Falha ao listar processos com filtro: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Limpa o cache de processos manualmente para liberar memória.
   */
  public limparCache(): void {
    this.cache.clear();
    this.logStructured('info', 'Cache de processos PJe limpo.');
  }

  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const timestamps = this.requestTimestamps.get(userId) || [];
    
    // Limpar timestamps com mais de 60 segundos
    const filtered = timestamps.filter(ts => now - ts < 60000);
    
    if (filtered.length >= this.MAX_REQ_PER_MINUTE) {
      throw new RateLimitExcedidoError(userId);
    }

    filtered.push(now);
    this.requestTimestamps.set(userId, filtered);
  }

  private checkCircuitBreaker(): void {
    if (this.circuitState === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      
      if (timeSinceFailure > this.COOLDOWN_MS) {
        this.circuitState = 'HALF_OPEN';
        this.logStructured('warn', 'Circuit Breaker em estado HALF_OPEN. Testando conectividade com PJe MCP Server.');
      } else {
        throw new CircuitBreakerOpenError();
      }
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitState === 'HALF_OPEN') {
      this.circuitState = 'CLOSED';
      this.logStructured('info', 'Circuit Breaker restabelecido para o estado CLOSED.');
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      this.circuitState = 'OPEN';
      this.lastFailureTime = Date.now();
      this.logStructured('error', `Circuit Breaker TRIPADO para o estado OPEN devido a ${this.consecutiveFailures} falhas consecutivas.`);
    }
  }

  private handleError(error: any, numeroProcesso: string, correlationId: string): never {
    if (error instanceof PjeDomainError) {
      throw error;
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    
    if (errorMsg.includes('auth') || errorMsg.includes('certificado') || errorMsg.includes('401') || errorMsg.includes('403')) {
      throw new CertificadoInvalidoError(errorMsg);
    }

    throw new ConexaoMcpError(`Erro operacional na consulta do processo ${numeroProcesso}: ${errorMsg}`);
  }

  private logStructured(level: 'info' | 'warn' | 'error', message: string, metadata: any = {}): void {
    const logObj = {
      level,
      timestamp: new Date().toISOString(),
      correlationId: metadata.correlationId || 'PJE-SERVICE',
      message,
      ...metadata
    };
    console.log(JSON.stringify(logObj));
  }
}

