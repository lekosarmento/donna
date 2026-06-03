import Anthropic from '@anthropic-ai/sdk';
import { PjeService } from '../services/pje/pje-service.js';
import { PJE_MCP_TOOLS } from '../services/pje/pje-tools.js';
import { ChatMessage } from './context-builder.js';
import { supabase } from '../config/supabase.js';
import { buscarPlaybooks } from '../rag/retrieval-service.js';

export interface AgentOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export type AgentEvent =
  | { type: 'token'; content: string }
  | { type: 'thinking'; tool: string }
  | { type: 'tool_done'; tool: string; ms: number }
  | { type: 'done'; usage: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; message: string };

/**
 * Agente cognitivo Donna. Orquestra a execução de ferramentas no PJe MCP Server
 * e emite eventos estruturados de streaming para o cliente Next.js.
 */
export class DonnaAgent {
  private client: Anthropic;
  private pjeService: PjeService;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  private maxIterations = 10;
  private activeStream: any = null; // Guarda referência do stream ativo para abortar

  private readonly SYSTEM_PROMPT = `Você é a "Donna", a secretária e copiloto jurídica estratégica do escritório.
Inspirada na personagem Donna Paulsen de Suits: você é extremamente inteligente, perspicaz, autoconfiante, leal e antecipa as necessidades dos advogados antes mesmo de eles perceberem.
Você não é apenas uma assistente virtual passiva; você é uma conselheira estratégica de alto nível.

DIRETRIZES DE COMPORTAMENTO E SEGURANÇA:
1. Tem acesso direto ao PJe do tribunal e responde de forma precisa, citando números de processo, fases e andamentos.
2. Jamais invente ou alucine informações processuais. Se um processo não for localizado no PJe, diga claramente.
3. Ao responder sobre processos, use sempre uma linguagem profissional e técnica, mas adote o tom confiante da persona da Donna.
4. Respeite estritamente as regras de Segredo de Justiça (Art. 189 do CPC) e a LGPD:
   - Se um processo estiver sob segredo de justiça (ou se as ferramentas do PJe indicarem que o acesso está bloqueado por sigilo), você deve RECUSAR-SE a detalhar seu conteúdo, andamentos ou partes.
   - Diga claramente que o acesso ao processo é sigiloso de acordo com o Artigo 189 do CPC e que apenas partes habilitadas nos autos possuem legitimidade de acesso.
   - Nunca revele nomes de partes, menores, testemunhas ou vítimas em processos que envolvam direito de família, violência doméstica ou que estejam sob sigilo judicial.
   - Nunca exponha dados pessoais ou sensíveis nas conversas.
5. Recomende ações proativas baseadas nas informações consultadas.
6. Quando disponíveis via ferramenta buscar_playbook_escritorio, sempre embase suas análises e respostas nos playbooks e manuais de teses do escritório. Cite o documento de origem explicitamente: 'Conforme o Playbook de Contratos do escritório (2024)...' ou 'De acordo com o Playbook de Petições (Dos Fatos)...'`;

  constructor(pjeService: PjeService, options?: AgentOptions) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Chave de API ANTHROPIC_API_KEY não localizada nas variáveis de ambiente.');
    }
    this.client = new Anthropic({ apiKey });
    this.pjeService = pjeService;
    this.model = options?.model || 'claude-3-5-sonnet-20241022';
    this.maxTokens = options?.maxTokens || 4000;
    this.temperature = options?.temperature || 0.2;
  }

  /**
   * Cancela graciosamente qualquer conexão de stream ativa com a Anthropic.
   */
  public abortActiveRequest(): void {
    if (this.activeStream) {
      try {
        this.activeStream.abort();
        this.logStructured('info', 'Solicitação de stream da Anthropic cancelada graciosamente.');
      } catch (err) {
        this.logStructured('warn', 'Erro ao abortar stream ativo:', { error: String(err) });
      } finally {
        this.activeStream = null;
      }
    }
  }

  /**
   * Executa a interação conversacional completa com suporte a loops agentics (tool-use)
   * e emite eventos estruturados de progresso (SSE) em tempo real.
   * 
   * @param {ChatMessage[]} history Histórico de conversas formatado.
   * @param {string} operadorId ID de identificação do advogado para fins de auditoria.
   * @param {string} correlationId ID de correlação para logs estruturados.
   * @param {(event: AgentEvent) => void} onEvent Callback que despacha os eventos estruturados de progresso do agente.
   * @returns {Promise<string>} Resposta final em texto completo.
   */
  public async executeChatStream(
    history: ChatMessage[],
    operadorId: string,
    correlationId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<string> {
    const tools = Object.values(PJE_MCP_TOOLS).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }));

    // Injetar a ferramenta de busca de playbooks corporativos/jurídicos do escritório
    tools.push({
      name: 'buscar_playbook_escritorio',
      description: 'Busca teses, modelos de contratos, pareceres e boas práticas nos playbooks e base de conhecimento internos do escritório de advocacia.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A consulta de busca contendo o tema jurídico ou tese a ser pesquisada nos manuais do escritório.'
          }
        },
        required: ['query']
      } as any
    });

    const messages: Anthropic.MessageParam[] = history.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    let currentIteration = 0;
    let accumulatedText = '';

    while (currentIteration < this.maxIterations) {
      currentIteration++;
      this.logStructured('debug', `Executando iteração de IA do Agente: ${currentIteration}/${this.maxIterations}`, { correlationId });

      try {
        // Obter stream ativo a partir do SDK da Anthropic
        const streamPromise = new Promise<Anthropic.Message>((resolve, reject) => {
          const stream = this.client.messages.stream({
            model: this.model,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            system: this.SYSTEM_PROMPT,
            messages: messages,
            tools: tools,
          });

          this.activeStream = stream;

          stream.on('text', (text) => {
            accumulatedText += text;
            onEvent({ type: 'token', content: text });
          });

          stream.on('message', (message) => {
            resolve(message);
          });

          stream.on('error', (err) => {
            reject(err);
          });
        });

        const messageResponse = await streamPromise;
        this.activeStream = null;

        // Adiciona a mensagem gerada ao histórico
        messages.push({
          role: 'assistant',
          content: messageResponse.content
        });

        // Caso a IA necessite chamar alguma ferramenta no PJe
        if (messageResponse.stop_reason === 'tool_use') {
          const toolResults: Anthropic.Beta.Prompting.ToolResultBlockParam[] = [];

          for (const block of messageResponse.content) {
            if (block.type === 'tool_use') {
              const toolUseId = block.id;
              const toolName = block.name;
              const toolArgs = block.input as any;

              // Emitir início do processamento da ferramenta
              onEvent({ type: 'thinking', tool: toolName });

              this.logStructured('info', `Executando chamada de ferramenta pela IA: ${toolName}`, {
                toolName,
                toolUseId,
                correlationId
              });

              const startTime = Date.now();

              try {
                let result: any;
                
                if (toolName === 'pje_buscar_processo') {
                  result = await this.pjeService.buscarProcesso(toolArgs.id, operadorId, correlationId);
                } else if (toolName === 'pje_listar_processos') {
                  result = await this.pjeService.listarProcessos(toolArgs.filter || '', operadorId, correlationId);
                } else if (toolName === 'pje_configurar') {
                  result = { status: 'ok', message: 'PJe configurado na sessão ativa' };
                } else if (toolName === 'buscar_playbook_escritorio') {
                  // Obter escritorio_id do operador do chat para garantir multi-tenant isolation
                  const { data: userRec } = await supabase
                    .from('usuarios')
                    .select('escritorio_id')
                    .eq('id', operadorId)
                    .single();

                  const escId = userRec?.escritorio_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910';

                  const chunks = await buscarPlaybooks(toolArgs.query, escId, 5);
                  result = chunks.map(c => ({
                    documento: c.metadata?.nome_arquivo || 'Manual Interno',
                    secao: c.metadata?.secao || 'Geral',
                    tipo: c.metadata?.tipo || 'Documento',
                    area: c.metadata?.area_direito || 'Geral',
                    conteudo: c.conteudo,
                    relevancia: c.score || c.similarity
                  }));
                } else {
                  throw new Error(`Ferramenta MCP desconhecida no Agente Donna: ${toolName}`);
                }

                const elapsedMs = Date.now() - startTime;
                
                // Emitir sucesso da ferramenta e o tempo de execução
                onEvent({ type: 'tool_done', tool: toolName, ms: elapsedMs });

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: JSON.stringify(result)
                });

              } catch (toolError) {
                const elapsedMs = Date.now() - startTime;
                const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
                
                this.logStructured('error', `Erro na execução da ferramenta MCP: ${toolName}`, {
                  toolName,
                  error: errMsg,
                  correlationId
                });

                // Emitir conclusão com erro para a UI
                onEvent({ type: 'tool_done', tool: toolName, ms: elapsedMs });

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: JSON.stringify({ error: errMsg, success: false }),
                  is_error: true
                });
              }
            }
          }

          // Alimentar histórico com o resultado para a próxima inferência do Claude
          messages.push({
            role: 'user',
            content: toolResults as any
          });

          continue;
        }

        // Caso a iteração do loop tenha finalizado normalmente
        if (messageResponse.stop_reason === 'end_turn' || messageResponse.stop_reason === 'stop_sequence') {
          onEvent({
            type: 'done',
            usage: {
              input_tokens: messageResponse.usage.input_tokens,
              output_tokens: messageResponse.usage.output_tokens
            }
          });

          return accumulatedText;
        }

        throw new Error(`Stop reason inesperado do Anthropic SDK: ${messageResponse.stop_reason}`);

      } catch (error) {
        this.activeStream = null;
        this.handleAnthropicErrors(error, correlationId);
      }
    }

    throw new Error('Limite de iterações excedido: O agente Donna entrou em loop infinito de ferramentas.');
  }

  private handleAnthropicErrors(error: any, correlationId: string): never {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    this.logStructured('error', 'Erro durante chamada ao modelo Claude da Anthropic.', { error: errorMsg, correlationId });

    if (error instanceof Anthropic.RateLimitError) {
      throw new Error('Limite de requisições excedido com a API da Anthropic. Por favor, tente novamente em breve.');
    }
    
    if (error instanceof Anthropic.APIConnectionError) {
      throw new Error('Falha de conexão com os servidores da Anthropic. Verifique a internet e tente novamente.');
    }
    
    if (error instanceof Anthropic.InternalServerError) {
      throw new Error('Erro interno nos servidores da Anthropic. Tente novamente mais tarde.');
    }

    if (error instanceof Anthropic.BadRequestError) {
      throw new Error(`Requisição inválida enviada à Anthropic: ${errorMsg}`);
    }

    throw new Error(`Erro na comunicação cognitiva da Donna: ${errorMsg}`);
  }

  private logStructured(level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata: any = {}): void {
    const logObj = {
      level,
      timestamp: new Date().toISOString(),
      correlationId: metadata.correlationId || 'DONNA-AGENT',
      message,
      ...metadata
    };
    console.log(JSON.stringify(logObj));
  }
}
