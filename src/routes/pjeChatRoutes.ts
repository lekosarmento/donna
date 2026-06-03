import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { MCPBridge } from '../services/pje/mcp-bridge.js';
import { PjeService } from '../services/pje/pje-service.js';
import { DonnaAgent, AgentEvent } from '../ai/donna-agent.js';
import { ContextBuilder } from '../ai/context-builder.js';
import { pjeConfig } from '../config/pje-config.js';
import { CertificateVault } from '../security/certificate-vault.js';
import { supabase } from '../config/supabase.js';
// DT-04: preHandler de autenticação JWT
import { requireAuth } from '../middleware/auth.js';

let bridge: MCPBridge | null = null;
let pjeService: PjeService | null = null;

// Esquema de validação e sanitização do input para prevenção de injections
const chatRequestSchema = z.object({
  message: z.string()
    .min(1, { message: 'Mensagem não pode ser vazia.' })
    .max(2000, { message: 'Limite de caracteres excedido (máx 2000).' })
    .transform(val => val.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''))
    .refine(val => {
      const injectionTerms = [
        'ignore as instruções',
        'ignore anterior',
        'ignore previous',
        'system override',
        'jailbreak',
        'instruções do sistema',
        'você agora é',
        'you are now a'
      ];
      const lowerVal = val.toLowerCase();
      return !injectionTerms.some(term => lowerVal.includes(term));
    }, { message: 'Donna identificou instruções de controle de sistema ou bypass não autorizados.' }),
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
   * GET /api/pje/processo/:numero
   * Busca dados de um processo específico pelo número CNJ via MCP Server.
   */
  fastify.get('/api/pje/processo/:numero', async (request, reply) => {
    const { numero } = request.params as { numero: string };
    const correlationId = (request.headers['x-correlation-id'] as string) || `PJE-GET-${Date.now()}`;
    const operadorId = (request.headers['x-user-id'] as string) || 'da39b5b2-3864-44df-be9b-e7b8c2d82910';

    const cnjRegex = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
    if (!cnjRegex.test(numero)) {
      return reply.status(400).send({ error: 'Formato do número CNJ do processo inválido.' });
    }

    try {
      if (!pjeService) {
        return reply.status(503).send({ error: 'Serviço PJe não inicializado.' });
      }

      const processo = await pjeService.buscarProcesso(numero, operadorId, correlationId);
      
      return reply.send({
        ...processo,
        ...((processo as any).bloqueado ? {} : {
          ultimaMovimentacao: processo.movimentos && processo.movimentos.length > 0
            ? processo.movimentos[0]
            : { data: new Date().toLocaleDateString('pt-BR'), descricao: 'Processo consultado via barramento PJe.' },
          proximoPrazo: (processo as any).segredoJustica 
            ? 'Não divulgado (Segredo de Justiça)' 
            : '15 dias úteis para manifestação.'
        })
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[PJe API] Erro ao obter processo ${numero}: ${errMsg}`);
      return reply.status(500).send({ error: 'Erro ao consultar processo judicial.', detalhes: errMsg });
    }
  });

  /**
   * POST /api/donna/chat
   * Endpoint de chat em tempo real com streaming Server-Sent Events (SSE).
   * DT-04: Protegido por requireAuth — request.user é garantido neste ponto.
   */
  fastify.post('/api/donna/chat', { preHandler: [requireAuth] }, async (request, reply) => {
    const correlationId = request.headers['x-correlation-id'] as string || `CHAT-${Date.now()}`;
    
    // 1. Validação de Input com Zod (Fail-Fast)
    const bodyParse = chatRequestSchema.safeParse(request.body);
    if (!bodyParse.success) {
      const errorMsg = bodyParse.error.issues.map(i => i.message).join(', ');
      return reply.status(400).send({ error: 'Parâmetros de chat inválidos', detalhes: errorMsg });
    }

    const { message, sessionId } = bodyParse.data;
    // DT-04 FIX: userId e escritorio_id vêm EXCLUSIVAMENTE do JWT verificado.
    // request.user é injetado pelo requireAuth preHandler — nunca pode ser forjado via body.
    const userId = request.user!.id;
    const escritorioId = request.user!.escritorio_id;
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

    // 5. Salvar mensagem do usuário assincronamente (não bloqueia o streaming)
    Promise.resolve().then(async () => {
      try {
        // Usar escritorio_id do JWT (DT-04) — nunca um fallback hardcoded
        const extEscritorioId = escritorioId;

        // Garantir que a sessão existe
        const { data: sessionExists } = await supabase
          .from('chat_sessions')
          .select('id')
          .eq('id', sessionId)
          .single();

        if (!sessionExists) {
          await supabase.from('chat_sessions').insert({
            id: sessionId,
            escritorio_id: extEscritorioId,
            usuario_id: userId,
            titulo: message.substring(0, 40) + (message.length > 40 ? '...' : '')
          });
        }

        // Inserir a mensagem do usuário
        await supabase.from('chat_messages').insert({
          escritorio_id: extEscritorioId,
          session_id: sessionId,
          role: 'user',
          content: message,
          metadata: { timestamp: new Date().toISOString() }
        });
      } catch (err) {
        console.error('[Supabase Chat Persistence] Erro ao gravar mensagem do usuário:', err);
      }
    });

    try {
      // 6. Escutar eventos de tool_result da ponte para auditoria de segurança
      const onToolResult = (data: any) => {
        toolsCalledList.push(data.tool || 'pje_mcp_tool');
      };
      bridge!.on('tool_result', onToolResult);

      let respostaDonnaAcumulada = '';
      let metadadosFinais: any = {};

      // 7. Executar o Agente IA em loop com streaming SSE nativo
      await agent.executeChatStream(
        history,
        userId,
        correlationId,
        (event: AgentEvent) => {
          // Acumular tokens da Donna e metadados finais
          if (event.type === 'token') {
            respostaDonnaAcumulada += event.content;
          } else if (event.type === 'done') {
            metadadosFinais.usage = event.usage;
          } else if (event.type === 'thinking') {
            if (!metadadosFinais.tools) metadadosFinais.tools = [];
            metadadosFinais.tools.push(event.tool);
          }
          // Escrever cada frame JSON na linha SSE
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      );

      // Limpar ponte ao finalizar turn
      bridge!.off('tool_result', onToolResult);
      cleanup();
      reply.raw.end();

      // 8. Salvar resposta da Donna assincronamente
      if (respostaDonnaAcumulada) {
        Promise.resolve().then(async () => {
          try {
            // Usar escritorio_id do JWT (DT-04)
            const extEscritorioId = escritorioId;

            await supabase.from('chat_messages').insert({
              escritorio_id: extEscritorioId,
              session_id: sessionId,
              role: 'assistant',
              content: respostaDonnaAcumulada,
              metadata: {
                ...metadadosFinais,
                timestamp: new Date().toISOString(),
                correlationId
              }
            });

            // Atualizar carimbo da sessão
            await supabase
              .from('chat_sessions')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', sessionId);
          } catch (err) {
            console.error('[Supabase Chat Persistence] Erro ao gravar resposta da Donna:', err);
          }
        });
      }

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
