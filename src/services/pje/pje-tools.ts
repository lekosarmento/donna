import { z } from 'zod';

/**
 * Interface compatível com o formato de ferramentas (tools) do Anthropic SDK.
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Mapeamento das ferramentas do PJe MCP Server compatíveis com a API da Anthropic.
 */
export const PJE_MCP_TOOLS: Record<string, AnthropicTool> = {
  pje_configurar: {
    name: 'pje_configurar',
    description: 'Configura a conexão base com o PJE de destino.',
    input_schema: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'URL base da API do PJE (Ex: https://pje.tjpb.jus.br)' },
        appName: { type: 'string', description: 'Identificador legível da aplicação cliente' },
      },
      required: ['baseUrl'],
    },
  },
  pje_listar_processos: {
    name: 'pje_listar_processos',
    description: 'Consulta processos cadastrados no PJe aplicando paginação e filtros opcionais.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Termo de filtro textual ou estruturado (JSON)' },
        page: { type: 'number', description: 'Número da página a ser retornada' },
        size: { type: 'number', description: 'Quantidade de itens por página' },
      },
    },
  },
  pje_buscar_processo: {
    name: 'pje_buscar_processo',
    description: 'Busca os metadados, partes e andamentos completos de um processo específico pelo número CNJ ou ID.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Número único de 20 dígitos CNJ ou ID interno do processo' },
      },
      required: ['id'],
    },
  },
  pje_listar_orgaos_julgadores: {
    name: 'pje_listar_orgaos_julgadores',
    description: 'Retorna a lista de varas, instâncias e órgãos julgadores habilitados.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
};

#region Schemas de Validação Zod para Respostas da API do PJe

export const pjeParteSchema = z.object({
  tipo: z.enum(['ATIVO', 'PASSIVO', 'Autor', 'Réu', 'Terceiro']),
  nome: z.string(),
  cpfCnpj: z.string().optional(),
});

export const pjeMovimentoSchema = z.object({
  data: z.string(),
  descricao: z.string(),
  tipo: z.string().optional(),
});

export const pjeProcessoSchema = z.object({
  numeroProcesso: z.string(),
  classe: z.string(),
  assunto: z.string(),
  orgaoJulgador: z.string(),
  partes: z.array(pjeParteSchema),
  movimentos: z.array(pjeMovimentoSchema).optional().default([]),
});

export const pjeListarProcessosSchema = z.object({
  status: z.enum(['ok', 'error', 'in-progress']).optional().default('ok'),
  result: z.array(pjeProcessoSchema).or(pjeProcessoSchema), // Trata retorno de lista ou item único
});

export type PjeParte = z.infer<typeof pjeParteSchema>;
export type PjeMovimento = z.infer<typeof pjeMovimentoSchema>;
export type PjeProcesso = z.infer<typeof pjeProcessoSchema>;

#endregion

/**
 * Sanitize e mascara documentos de identificação pessoal (CPF/CNPJ) e informações de terceiros
 * não relacionados de acordo com a LGPD (Lei 13.709/2018 - Princípios de Minimização e Finalidade).
 * 
 * @param {PjeProcesso} processo O objeto bruto do processo retornado pelo PJe.
 * @returns {PjeProcesso} O objeto do processo com dados pessoais mascarados.
 */
export function sanitizeProcessoLGPD(processo: PjeProcesso): PjeProcesso {
  const sanitizeDocument = (doc?: string): string | undefined => {
    if (!doc) return undefined;
    const cleanDoc = doc.replace(/\D/g, '');
    if (cleanDoc.length === 11) {
      // CPF: Mascarar os 6 primeiros dígitos (Ex: ***.***.345-00)
      return `***.***.${cleanDoc.substring(6, 9)}-${cleanDoc.substring(9, 11)}`;
    } else if (cleanDoc.length === 14) {
      // CNPJ: Ocultar o radical (Ex: **.***.***/0001-99)
      return `**.***.***/${cleanDoc.substring(8, 12)}-${cleanDoc.substring(12, 14)}`;
    }
    return '***.***.***-**'; // Fallback seguro se o formato for indefinido
  };

  const partesSanitizadas = processo.partes.map((parte) => {
    const isAdvocateOrPublic = parte.tipo === 'Autor' || parte.tipo === 'Réu' || parte.tipo === 'ATIVO' || parte.tipo === 'PASSIVO';
    return {
      tipo: parte.tipo,
      // Se não for parte direta (ex: testemunhas ou terceiros expostos), podemos ocultar sobrenomes ou manter apenas iniciais
      nome: isAdvocateOrPublic ? parte.nome : anonymizeThirdPartyName(parte.nome),
      cpfCnpj: parte.cpfCnpj ? sanitizeDocument(parte.cpfCnpj) : undefined,
    };
  });

  return {
    ...processo,
    partes: partesSanitizadas,
  };
}

/**
 * Anonimiza ou reduz o nome de terceiros expostos em andamentos judiciais para conformidade com a LGPD.
 */
function anonymizeThirdPartyName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  // Retorna apenas o primeiro nome e as iniciais dos sobrenomes (Ex: "Maria Silva Santos" -> "Maria S. S.")
  return `${parts[0]} ${parts.slice(1).map(p => `${p.charAt(0).toUpperCase()}.`).join(' ')}`;
}
