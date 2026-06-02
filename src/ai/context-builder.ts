import { PjeProcesso } from '../services/pje/pje-tools.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface ContextBuilderOptions {
  maxTokens?: number;
  maxMessages?: number;
}

/**
 * Utilitário de alto nível para montagem e filtragem do contexto da conversa com a Donna.
 * Implementa janela deslizante baseada em estimativa de tokens e separação rígida de dados processuais.
 */
export class ContextBuilder {
  private readonly maxTokens: number;
  private readonly maxMessages: number;
  private readonly CHAR_TO_TOKEN_RATIO = 4; // Estimativa conservadora (4 caracteres por token)

  constructor(options?: ContextBuilderOptions) {
    this.maxTokens = options?.maxTokens || 120000; // Limite padrão para Claude-3-Sonnet
    this.maxMessages = options?.maxMessages || 15;  // Janela deslizante de até 15 mensagens
  }

  /**
   * Constrói o histórico formatado de mensagens de diálogo, respeitando o tamanho máximo de tokens
   * e aplicando a janela deslizante.
   * 
   * @param {ChatMessage[]} history Histórico completo bruto das interações da sessão.
   * @returns {ChatMessage[]} Histórico filtrado e seguro para envio na API da Anthropic.
   */
  public buildConversationHistory(history: ChatMessage[]): ChatMessage[] {
    const formattedHistory: ChatMessage[] = history.map(msg => ({
      role: msg.role,
      content: msg.content.trim()
    }));

    // 1. Janela Deslizante: Limitar número máximo bruto de mensagens
    let windowed = formattedHistory.slice(-this.maxMessages);
    
    // 2. Validação de Limite de Tokens: Remover mensagens mais antigas até caber no orçamento
    let estimatedTokens = this.calculateHistoryTokens(windowed);
    
    while (estimatedTokens > this.maxTokens && windowed.length > 1) {
      windowed.shift(); // Remove a mensagem mais antiga do topo da janela
      estimatedTokens = this.calculateHistoryTokens(windowed);
    }

    return windowed;
  }

  /**
   * Constrói a injeção de contexto estruturado de processos e dados jurídicos de forma apartada.
   * Promove o princípio de minimização de dados da LGPD isolando metadados úteis do corpo de diálogos comuns.
   * 
   * @param {PjeProcesso} processo Dados do processo sanitizados.
   * @returns {string} Texto formatado em blocos estruturados legíveis para a IA.
   */
  public buildProcessContext(processo: PjeProcesso): string {
    const partesText = processo.partes
      .map(p => `- [${p.tipo}] Nome: ${p.nome} | CPF/CNPJ: ${p.cpfCnpj || 'Não Informado'}`)
      .join('\n');

    const andamentosText = processo.movimentos
      .slice(0, 10) // Limita aos últimos 10 andamentos para evitar estouro de contexto
      .map(m => `- Data: ${m.data} | Descrição: ${m.descricao}`)
      .join('\n');

    return `
=== CONTEXTO PROCESSUAL ISOLADO (PJe TJPB) ===
Processo CNJ: ${processo.numeroProcesso}
Classe Processual: ${processo.classe}
Assunto Principal: ${processo.assunto}
Órgão Julgador: ${processo.orgaoJulgador}

PARTES E ADVOGADOS CADASTRADOS:
${partesText}

ÚLTIMOS 10 ANDAMENTOS PROCESSUAIS REGISTRADOS:
${andamentosText}
==============================================
`;
  }

  private calculateHistoryTokens(messages: ChatMessage[]): number {
    return messages.reduce((acc, msg) => {
      return acc + Math.ceil(msg.content.length / this.CHAR_TO_TOKEN_RATIO);
    }, 0);
  }
}
