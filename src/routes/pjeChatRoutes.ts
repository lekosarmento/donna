import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { MCPBridge } from '../services/pje/mcp-bridge.js';
import { PjeService } from '../services/pje/pje-service.js';
import { DonnaAgent, AgentEvent } from '../ai/donna-agent.js';
import { ContextBuilder } from '../ai/context-builder.js';
import { pjeConfig } from '../config/pje-config.js';
import { CertificateVault } from '../security/certificate-vault.js';

let bridge: MCPBridge | null = null;
let pjeService: PjeService | null = null;

// Esquema de validação e sanitização do input para prevenção de injections
const chatRequestSchema = z.object({
  message: z.string()
    .min(1, { message: 'Mensagem não pode ser vazia.' })
    .max(2000, { message: 'Limite de caracteres excedido (máx 2000).' })
    .transform(val => val.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')),
  sessionId: z.string().min(1, { message: 'ID da sessão é obrigatório.' }),
  userId: z.string().min(1, { message: 'ID do usuário/operador é obrigatório.' }),
});

/**
 * Plugin de rotas Fastify para interações de IA integradas ao PJe.
 */
export default async function pjeChatRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  
  if (!bridge) {
    try {
      await CertificateVault.getInstance().initialize(
        pjeConfig.PJE_CERTIFICATE_PFX_PATH,
        pjeConfig.PJE_CERTIFICATE_PFX_PASSWORD
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[Vault Startup] Falha ao carregar certificado no cofre criptografado: ${errMsg}`);
    }

    bridge = new MCPBridge();
    bridge.connect().catch(err => {
      fastify.log.error(`[PJe Startup] Falha crítica de conexão StdIO MCP: ${err.message}`);
    });
    pjeService = new PjeService(bridge);
  }

  /**
   * POST /api/donna/chat
   * Endpoint de chat em tempo real com streaming Server-Sent Events (SSE).
   */
  fastify.post('/api/donna/chat', async (request, reply) => {
    const correlationId = request.headers['x-correlation-id'] as string || `CHAT-${Date.now()}`;
    
    // 1. Validação de Input com Zod (Fail-Fast)
    const bodyParse = chatRequestSchema.safeParse(request.body);
    if (!bodyParse.success) {
      const errorMsg = bodyParse.error.issues.map(i => i.message).join(', ');
      return reply.status(400).send({ error: 'Parâmetros de chat inválidos', detalhes: errorMsg });
    }

    const { message, sessionId, userId } = bodyParse.data;
    const startTime = Date.now();
    const toolsCalledList: string[] = [];

    // 2. Inicializar agentes e utilitários
    const contextBuilder = new ContextBuilder();
    const history = contextBuilder.buildConversationHistory([
      { role: 'user', content: message }
    ]);

    const agent = new DonnaAgent(pjeService!);

    // Configurar cabeçalhos obrigatórios para o streaming SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 3. Heartbeat (Ping) a cada 15 segundos para manter o canal TCP/SSE aberto
    const heartbeatInterval = setInterval(() => {
      reply.raw.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    }, 15000);

    // 4. Timeout de Segurança de 120 segundos para evitar requisições presas (exaustão de sockets)
    const executionTimeout = setTimeout(() => {
      clearInterval(heartbeatInterval);
      agent.abortActiveRequest(); // Cancelar chamada de API Anthropic de forma graciosa

      const timeoutMsg = 'Limite de tempo esgotado na geração da resposta pela Donna (120s).';
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: timeoutMsg })}\n\n`);
      reply.raw.end();

      console.error(JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        correlationId,
        type: 'CHAT_TIMEOUT',
        userId,
        sessionId,
        message: 'Tempo limite de execução excedido (120s) - Stream abortado.'
      }));
    }, 120000);

    // Limpeza dos timers e listeners ao finalizar
    const cleanup = () => {
      clearInterval(heartbeatInterval);
      clearTimeout(executionTimeout);
    };

    try {
      // 5. Escutar eventos de tool_result da ponte para auditoria de segurança
      const onToolResult = (data: any) => {
        toolsCalledList.push(data.tool || 'pje_mcp_tool');
      };
      bridge!.on('tool_result', onToolResult);

      // 6. Executar o Agente IA em loop com streaming SSE nativo
      await agent.executeChatStream(
        history,
        userId,
        correlationId,
        (event: AgentEvent) => {
          // Escrever cada frame JSON na linha SSE
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      );

      // Limpar ponte ao finalizar turn
      bridge!.off('tool_result', onToolResult);
      cleanup();
      reply.raw.end();

      // Auditoria SIEM estruturada
      console.log(JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        correlationId,
        type: 'AUDIT_CHAT_SESSION',
        userId,
        sessionId,
        executionTimeMs: Date.now() - startTime,
        toolsCalled: toolsCalledList,
        result: 'SUCCESS'
      }));

    } catch (error) {
      cleanup();
      const errMsg = error instanceof Error ? error.message : String(error);

      // Emitir evento de erro no stream SSE e fechar a conexão
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`);
      reply.raw.end();

      console.error(JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        correlationId,
        type: 'CHAT_ERROR',
        userId,
        sessionId,
        error: errMsg,
        result: 'FAILED'
      }));
    }
  });
}
