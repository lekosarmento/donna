import Anthropic from '@anthropic-ai/sdk';
import { PjeService } from '../services/pje/pje-service.js';
import { PJE_MCP_TOOLS } from '../services/pje/pje-tools.js';
import { ChatMessage } from './context-builder.js';

export interface AgentOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Agente cognitivo Donna. Orquestra a execução de ferramentas no PJe MCP Server
 * e mantém a integridade das respostas utilizando a API da Anthropic.
 */
export class DonnaAgent {
  private client: Anthropic;
  private pjeService: PjeService;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  private maxIterations = 10; // Proteção contra loops infinitos de IA

  private readonly SYSTEM_PROMPT = `Você é a "Donna", a secretária e copiloto jurídica estratégica do escritório.
Inspirada na personagem Donna Paulsen de Suits: você é extremamente inteligente, perspicaz, autoconfiante, leal e antecipa as necessidades dos advogados antes mesmo de eles perceberem.
Você não é apenas uma assistente virtual passiva; você é uma conselheira estratégica de alto nível.

DIRETRIZES DE COMPORTAMENTO E SEGURANÇA:
1. Tem acesso direto ao PJe do tribunal e responde de forma precisa, citando números de processo, fases e andamentos.
2. Jamais invente ou alucine informações processuais. Se um processo não for localizado no PJe, diga claramente.
3. Ao responder sobre processos, use sempre uma linguagem profissional e técnica, mas adote o tom confiante da persona da Donna.
4. Respeite as regras de segredo de justiça e LGPD: nunca vaze CPFs completos nas conversas, mas informe andamentos.
5. Recomende ações proativas baseadas nas informações consultadas (ex: "Como o prazo está correndo, prepare a petição de contestação hoje").`;

  constructor(pjeService: PjeService, options?: AgentOptions) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Chave de API ANTHROPIC_API_KEY não localizada nas variáveis de ambiente.');
    }
    this.client = new Anthropic({ apiKey });
    this.pjeService = pjeService;
    this.model = options?.model || 'claude-3-5-sonnet-20241022';
    this.maxTokens = options?.maxTokens || 4000;
    this.temperature = options?.temperature || 0.2; // Baixa temperatura para maior precisão jurídica
  }

  /**
   * Executa a interação conversacional completa com suporte a loops agentics (tool-use)
   * e streams a resposta de linguagem natural final para o cliente.
   * 
   * @param {ChatMessage[]} history Histórico de conversas formatado.
   * @param {string} operadorId ID de identificação do advogado para fins de auditoria.
   * @param {string} correlationId ID de correlação para logs estruturados.
   * @param {(chunk: string) => void} onChunk Callback acionada a cada pedaço da resposta de texto final gerada.
   * @returns {Promise<string>} Resposta final em texto completo.
   */
  public async executeChat(
    history: ChatMessage[],
    operadorId: string,
    correlationId: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    // 1. Mapeamento dinâmico de tools compatíveis com o Anthropic SDK
    const tools = Object.values(PJE_MCP_TOOLS).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }));

    // Converter mensagens para o formato da Anthropic
    const messages: Anthropic.MessageParam[] = history.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    let currentIteration = 0;

    while (currentIteration < this.maxIterations) {
      currentIteration++;
      this.logStructured('debug', `Executando iteração de IA do Agente: ${currentIteration}/${this.maxIterations}`, { correlationId });

      try {
        // Enviar mensagens e obter resposta da IA (com suporte a chamadas de ferramentas)
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          system: this.SYSTEM_PROMPT,
          messages: messages,
          tools: tools,
        });

        // Adiciona a mensagem do assistente ao histórico acumulado
        messages.push({
          role: 'assistant',
          content: response.content
        });

        // Se a resposta for para usar alguma ferramenta
        if (response.stop_reason === 'tool_use') {
          const toolResults: Anthropic.Beta.Prompting.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type === 'tool_use') {
              const toolUseId = block.id;
              const toolName = block.name;
              const toolArgs = block.input as any;

              this.logStructured('info', `Executando chamada de ferramenta pela IA: ${toolName}`, {
                toolName,
                toolUseId,
                correlationId
              });

              try {
                let result: any;
                
                // Mapeia e executa a chamada no PjeService
                if (toolName === 'pje_buscar_processo') {
                  result = await this.pjeService.buscarProcesso(toolArgs.id, operadorId, correlationId);
                } else if (toolName === 'pje_listar_processos') {
                  result = await this.pjeService.listarProcessos(toolArgs.filter || '', operadorId, correlationId);
                } else if (toolName === 'pje_configurar') {
                  result = { status: 'ok', message: 'PJe configurado na sessão ativa' };
                } else {
                  throw new Error(`Ferramenta MCP desconhecida no Agente Donna: ${toolName}`);
                }

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: JSON.stringify(result)
                });

              } catch (toolError) {
                const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
                this.logStructured('error', `Erro na execução da ferramenta MCP: ${toolName}`, {
                  toolName,
                  error: errMsg,
                  correlationId
                });

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: JSON.stringify({ error: errMsg, success: false }),
                  is_error: true
                });
              }
            }
          }

          // Adicionar o resultado das ferramentas ao histórico como uma mensagem do usuário
          messages.push({
            role: 'user',
            content: toolResults as any
          });

          // Continua o loop para que a IA analise as respostas das ferramentas
          continue;
        }

        // Se a IA completou a geração da resposta textual final
        if (response.stop_reason === 'end_turn') {
          const textBlock = response.content.find(block => block.type === 'text');
          const textResponse = textBlock && textBlock.type === 'text' ? textBlock.text : '';
          
          // Como fizemos a chamada sem stream para resolver as ferramentas, simulamos o stream
          // do texto final para o cliente SSE para manter a UX rápida
          const chunkSize = 15; // caracteres
          for (let i = 0; i < textResponse.length; i += chunkSize) {
            const chunk = textResponse.substring(i, i + chunkSize);
            onChunk(chunk);
            // Pequeno delay para emular stream natural
            await new Promise(resolve => setTimeout(resolve, 10));
          }

          return textResponse;
        }

        throw new Error(`Stop reason não suportado do Anthropic SDK: ${response.stop_reason}`);

      } catch (error) {
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
