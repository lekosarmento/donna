import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { MCPBridge } from '../services/pje/mcp-bridge.js';
import { PjeService } from '../services/pje/pje-service.js';
import { DonnaAgent } from '../ai/donna-agent.js';
import { ContextBuilder } from '../ai/context-builder.js';
import { pjeConfig } from '../config/pje-config.js';
import { CertificateVault } from '../security/certificate-vault.js';

// Inicialização singleton da ponte MCP e do serviço
let bridge: MCPBridge | null = null;
let pjeService: PjeService | null = null;

// Esquema de validação e sanitização do input para prevenção de injections
const chatRequestSchema = z.object({
  message: z.string()
    .min(1, { message: 'Mensagem não pode ser vazia.' })
    .max(2000, { message: 'Limite de caracteres excedido (máx 2000).' })
    // Higienização de caracteres de controle para mitigar injeção de prompt
    .transform(val => val.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')),
  sessionId: z.string().min(1, { message: 'ID da sessão é obrigatório.' }),
  userId: z.string().min(1, { message: 'ID do usuário/operador é obrigatório.' }),
});

/**
 * Plugin de rotas Fastify para interações de IA integradas ao PJe.
 */
export default async function pjeChatRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  
  // Garantir a conexão da ponte no boot das rotas
  if (!bridge) {
    // 1. Inicializar cofre de certificados em memória
    try {
      await CertificateVault.getInstance().initialize(
        pjeConfig.PJE_CERTIFICATE_PFX_PATH,
        pjeConfig.PJE_CERTIFICATE_PFX_PASSWORD
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[Vault Startup] Falha ao carregar certificado no cofre criptografado: ${errMsg}`);
    }

    // 2. Inicializar ponte e serviço
    bridge = new MCPBridge();
    bridge.connect().catch(err => {
      fastify.log.error(`[PJe Startup] Falha crítica de conexão StdIO MCP: ${err.message}`);
    });
    pjeService = new PjeService(bridge);
  }

  /**
   * POST /api/donna/chat
   * Endpoint de chat em tempo real com streaming (Server-Sent Events - SSE).
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

    // 2. Telemetria e Auditoria inicial (SIEM-ready)
    const toolsCalledList: string[] = [];
    const startTime = Date.now();

    // 3. Montar contexto de conversação usando sliding window
    const contextBuilder = new ContextBuilder();
    const history = contextBuilder.buildConversationHistory([
      { role: 'user', content: message }
    ]);

    // 4. Inicializar agente Donna para a chamada ativa
    const agent = new DonnaAgent(pjeService!);

    // Configurar cabeçalhos para o streaming Server-Sent Events (SSE)
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Evita buffering de proxies reversos como Nginx
    });

    try {
      // Escutar eventos da bridge para capturar chamadas de ferramentas durante o ciclo do agente
      const onToolResult = (data: any) => {
        toolsCalledList.push(`tool_call_${Date.now()}`);
      };
      bridge!.on('tool_result', onToolResult);

      // Executa o agente cognitivo no loop e envia chunks pelo canal raw do Fastify
      await agent.executeChat(
        history, 
        userId, 
        correlationId, 
        (chunk: string) => {
          reply.raw.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
      );

      // Limpar listener para evitar memory leak
      bridge!.off('tool_result', onToolResult);

      // Notificar término do stream
      reply.raw.write(`data: [DONE]\n\n`);
      reply.raw.end();

      // 5. Auditoria de encerramento da requisição (Sem vazar dados pessoais nos logs)
      const auditLog = {
        level: 'info',
        timestamp: new Date().toISOString(),
        correlationId,
        type: 'AUDIT_CHAT_SESSION',
        userId,
        sessionId,
        executionTimeMs: Date.now() - startTime,
        toolsCalled: toolsCalledList,
        result: 'SUCCESS'
      };
      console.log(JSON.stringify(auditLog));

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      
      // Registrar log estruturado de erro na telemetria
      const errorLog = {
        level: 'error',
        timestamp: new Date().toISOString(),
        correlationId,
        type: 'CHAT_ERROR',
        userId,
        sessionId,
        error: errMsg,
        result: 'FAILED'
      };
      console.error(JSON.stringify(errorLog));

      // Notificar o cliente SSE do erro operacional ocorrido
      reply.raw.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
      reply.raw.end();
    }
  });
}
