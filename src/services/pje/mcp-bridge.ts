import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

/**
 * Ponte de comunicação de baixo nível com o PJe MCP Server via StdIO (JSON-RPC 2.0).
 * Gerencia ciclo de vida, reconexão automática, pooling de requisições e segurança de logs.
 */
export class MCPBridge extends EventEmitter {
  private serverPath: string;
  private childProcess: ChildProcess | null = null;
  private requestIdCounter = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isShuttingDown = false;
  private defaultTimeoutMs: number;
  private buffer = '';

  constructor(serverPath?: string, defaultTimeoutMs = 30000) {
    super();
    this.serverPath = serverPath || path.resolve('d:/Donna/services/pje-mcp-server/build/index.js');
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  /**
   * Conecta e inicializa o servidor de processos filhos MCP.
   */
  public async connect(): Promise<void> {
    if (this.childProcess || this.isConnecting) return;
    this.isConnecting = true;
    this.isShuttingDown = false;

    this.logStructured('info', 'Iniciando PJe MCP Server...', { path: this.serverPath });

    try {
      this.childProcess = spawn('node', [this.serverPath], {
        env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.childProcess.stdout?.on('data', (data: Buffer) => this.handleData(data));
      this.childProcess.stderr?.on('data', (data: Buffer) => this.handleErrorStream(data));
      this.childProcess.on('close', (code) => this.handleClose(code));
      this.childProcess.on('error', (err) => this.handleProcessError(err));

      // Executar o handshake de inicialização exigido pelo Model Context Protocol
      await this.performHandshake();

      this.isConnecting = false;
      this.emit('connected');
      this.logStructured('info', 'Handshake MCP concluído. Servidor pronto.');
    } catch (error) {
      this.isConnecting = false;
      this.logStructured('error', 'Falha ao conectar ao servidor MCP.', { error: String(error) });
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Executa uma ferramenta (tool) específica no servidor MCP de forma assíncrona.
   */
  public async callTool(toolName: string, args: any, timeoutMs?: number): Promise<any> {
    if (!this.childProcess) {
      throw new Error('Servidor MCP não está conectado.');
    }

    const id = ++this.requestIdCounter;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    // Auditoria: Logar chamada de ferramenta omitindo dados sensíveis dos argumentos
    this.logStructured('debug', `Chamando ferramenta MCP: ${toolName}`, {
      toolName,
      requestId: id,
      arguments: this.sanitizePayload(args)
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const err = new Error(`Timeout da chamada MCP para a ferramenta: ${toolName} (limite ${timeoutMs || this.defaultTimeoutMs}ms)`);
        this.logStructured('warn', err.message, { toolName, requestId: id });
        reject(err);
      }, timeoutMs || this.defaultTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      
      const payload = JSON.stringify(request) + '\n';
      this.childProcess?.stdin?.write(payload);
    });
  }

  /**
   * Finaliza de forma limpa a conexão com o servidor.
   */
  public async disconnect(): Promise<void> {
    this.isShuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
    // Limpar requisições pendentes
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('Servidor MCP desconectado pelo cliente.'));
    }
    this.pendingRequests.clear();

    if (this.childProcess) {
      const proc = this.childProcess;
      this.childProcess = null;
      proc.kill('SIGTERM');
    }
    
    this.emit('disconnected');
    this.logStructured('info', 'Servidor MCP desconectado de forma controlada.');
  }

  private async performHandshake(): Promise<void> {
    const id = ++this.requestIdCounter;
    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'donna-backend-bridge',
          version: '1.0.0'
        }
      }
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Timeout durante a inicialização do handshake MCP.'));
      }, 10000); // Handshake deve ser rápido

      this.pendingRequests.set(id, {
        resolve: (res) => {
          // Após inicializar, o cliente DEVE enviar uma notificação 'initialized'
          const initializedNotification: JsonRpcRequest = {
            jsonrpc: '2.0',
            method: 'notifications/initialized'
          };
          this.childProcess?.stdin?.write(JSON.stringify(initializedNotification) + '\n');
          resolve(res);
        },
        reject,
        timer
      });

      this.childProcess?.stdin?.write(JSON.stringify(initRequest) + '\n');
    });
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString('utf8');
    let lineEndIndex: number;

    while ((lineEndIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, lineEndIndex).trim();
      this.buffer = this.buffer.substring(lineEndIndex + 1);

      if (line) {
        try {
          const response: JsonRpcResponse = JSON.parse(line);
          this.processResponse(response);
        } catch (error) {
          this.logStructured('error', 'Erro ao decodificar JSON-RPC do stdout do MCP.', { line, error: String(error) });
        }
      }
    }
  }

  private processResponse(response: JsonRpcResponse): void {
    if (response.id !== undefined && response.id !== null) {
      const id = typeof response.id === 'string' ? parseInt(response.id, 10) : response.id;
      const pending = this.pendingRequests.get(id);

      if (pending) {
        this.pendingRequests.delete(id);
        clearTimeout(pending.timer);

        if (response.error) {
          pending.reject(new Error(`[MCP Error ${response.error.code}]: ${response.error.message}`));
        } else {
          // Emitir resultado higienizado para eventos
          this.emit('tool_result', { requestId: id, result: this.sanitizePayload(response.result) });
          pending.resolve(response.result);
        }
      }
    }
  }

  private handleErrorStream(data: Buffer): void {
    const message = data.toString('utf8').trim();
    // Mensagens de log internas do servidor MCP vão para stderr
    if (message) {
      this.logStructured('info', `[MCP Server Log]: ${message}`, { stream: 'stderr' });
    }
  }

  private handleClose(code: number | null): void {
    this.childProcess = null;
    this.emit('disconnected');
    this.logStructured('warn', 'Processo do servidor MCP encerrado.', { code });

    if (!this.isShuttingDown) {
      this.scheduleReconnect();
    }
  }

  private handleProcessError(err: Error): void {
    this.logStructured('error', 'Falha crítica no processo filho do MCP.', { error: err.message });
    this.emit('error', err);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
    this.reconnectTimer = setTimeout(() => {
      this.logStructured('info', 'Tentando reconectar ao PJe MCP Server...');
      this.connect().catch(() => {});
    }, 5000); // Tentar reconectar a cada 5 segundos
  }

  private sanitizePayload(payload: any): any {
    if (!payload) return payload;
    
    // Clonar para evitar mutação indesejada
    const cloned = JSON.parse(JSON.stringify(payload));
    
    // Ocultar dados potencialmente gigantes de arquivos ou petições
    const recursivelySanitize = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      for (const key of Object.keys(obj)) {
        if (key.toLowerCase().includes('password') || key.toLowerCase().includes('senha')) {
          obj[key] = '[PROTEGIDO]';
        } else if (key === 'content' && typeof obj[key] === 'string' && obj[key].length > 1000) {
          obj[key] = `${obj[key].substring(0, 100)}... [CONTEÚDO DE DOCUMENTO SUPRIMIDO PARA LOGS E LGPD - ${obj[key].length} caracteres]`;
        } else if (key === 'text' && typeof obj[key] === 'string' && obj[key].length > 1000) {
          obj[key] = `${obj[key].substring(0, 100)}... [TEXTO SUPRIMIDO - ${obj[key].length} caracteres]`;
        } else if (typeof obj[key] === 'object') {
          recursivelySanitize(obj[key]);
        }
      }
      return obj;
    };
    
    return recursivelySanitize(cloned);
  }

  private logStructured(level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata: any = {}): void {
    const logObj = {
      level,
      timestamp: new Date().toISOString(),
      correlationId: metadata.correlationId || 'MCP-BRIDGE',
      message,
      ...metadata
    };
    if (level === 'error') {
      console.error(JSON.stringify(logObj));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logObj));
    } else {
      console.log(JSON.stringify(logObj));
    }
  }
}
