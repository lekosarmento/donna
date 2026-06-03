import { jest } from '@jest/globals';

// Configura o ambiente de teste
process.env.NODE_ENV = 'test';

// 1. Mock do SDK da OpenAI
const mockEmbeddingsCreate = jest.fn();
jest.unstable_mockModule('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => {
      return {
        embeddings: {
          create: mockEmbeddingsCreate
        }
      };
    })
  };
});

// 2. Mock do Supabase
const mockSupabaseRpc = jest.fn();
const mockSupabaseInsert = jest.fn();
jest.unstable_mockModule('../../src/config/supabase.js', () => {
  const mockFrom = jest.fn().mockReturnValue({
    insert: mockSupabaseInsert
  });
  return {
    supabase: {
      from: mockFrom,
      rpc: mockSupabaseRpc
    }
  };
});

// Importações dinâmicas necessárias para interceptar os mocks do ESM
const { chunkLegalDocument, generateEmbeddings, processAndStorePlaybook } = await import('../../src/rag/embedding-service.js');
const { buscarPlaybooks } = await import('../../src/rag/retrieval-service.js');
const { classificarDocumento } = await import('../../src/rag/ingestor.js');
const { supabase } = await import('../../src/config/supabase.js');

describe('RAG Pipeline para Playbooks Jurídicos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Algoritmo de Chunking Jurídico Inteligente', () => {
    it('deve identificar seções principais e agrupar parágrafos sob o cabeçalho correto', () => {
      const docText = `
        CONTRATO DE PRESTAÇÃO DE SERVIÇOS
        
        DOS FATOS
        O reclamante foi contratado em 01/01/2026 para exercer funções.
        Sempre desempenhou com zelo suas atribuições diárias.
        
        DO DIREITO
        A legislação vigente assegura o direito pleiteado nesta demanda.
        O Artigo 5º da CF garante ampla defesa.
        
        DOS PEDIDOS
        Ante o exposto, requer a procedência da ação.
      `;

      const chunks = chunkLegalDocument(docText);
      
      expect(chunks.length).toBeGreaterThan(0);
      
      // Verifica se mapeou as seções do documento
      const secoesDetectadas = chunks.map(c => c.section);
      expect(secoesDetectadas).toContain('DOS FATOS');
      expect(secoesDetectadas).toContain('DO DIREITO');
      expect(secoesDetectadas).toContain('DOS PEDIDOS');

      // Primeiro chunk do Fatos deve ter o conteúdo do parágrafo
      const fatosChunk = chunks.find(c => c.section === 'DOS FATOS');
      expect(fatosChunk?.content).toContain('O reclamante foi contratado');
    });

    it('deve aplicar sliding window (overlap) se a seção exceder o limite de caracteres', () => {
      const longText = 'A '.repeat(2200); // Excede o MAX_CHARS de 2048
      const docText = `
        DOS FATOS
        ${longText}
      `;

      const chunks = chunkLegalDocument(docText);
      
      // Deve ter criado pelo menos 2 chunks devido ao tamanho
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].section).toBe('DOS FATOS');
      expect(chunks[1].section).toBe('DOS FATOS');
      
      // O segundo chunk deve conter a porção final (overlap)
      expect(chunks[1].content.length).toBeLessThan(chunks[0].content.length);
    });
  });

  describe('Classificação Heurística de Domínio Jurídico', () => {
    it('deve classificar como petição e área cível/família', () => {
      const peticaoText = `
        EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 1ª VARA DE FAMÍLIA.
        Ação de Divórcio Consensual c/c Alimentos.
        Requer a fixação de pensão alimentícia temporária.
      `;

      const res = classificarDocumento(peticaoText);
      expect(res.tipo).toBe('petição');
      expect(res.area_direito).toBe('família');
    });

    it('deve classificar como contrato e área trabalhista', () => {
      const contratoText = `
        INSTRUMENTO PARTICULAR DE CONTRATO DE TRABALHO.
        As regras seguem a Consolidação das Leis do Trabalho - CLT.
        Cláusula Primeira: O empregado exercerá funções gerais.
      `;

      const res = classificarDocumento(contratoText);
      expect(res.tipo).toBe('contrato');
      expect(res.area_direito).toBe('trabalhista');
    });

    it('deve classificar como tributário se contiver palavras-chave fiscais', () => {
      const tributarioText = `
        Parecer sobre o recolhimento do ICMS e diferencial de alíquota.
        Discussão sobre cobrança indevida de imposto.
      `;

      const res = classificarDocumento(tributarioText);
      expect(res.area_direito).toBe('tributário');
    });
  });

  describe('Geração de Embeddings e Armazenamento', () => {
    it('deve gerar embeddings em batches de 100 fragmentos na OpenAI', async () => {
      // Mock da resposta de embeddings da OpenAI
      const mockEmbedding = Array(1536).fill(0.0123);
      mockEmbeddingsCreate.mockResolvedValue({
        data: Array(5).fill(0).map(() => ({ embedding: mockEmbedding }))
      });

      const texts = ['chunk 1', 'chunk 2', 'chunk 3', 'chunk 4', 'chunk 5'];
      const embeddings = await generateEmbeddings(texts);

      expect(embeddings.length).toBe(5);
      expect(embeddings[0]).toEqual(mockEmbedding);
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    });

    it('deve chunkar, gerar embeddings e persistir playbook no Supabase', async () => {
      const mockEmbedding = Array(1536).fill(0.0123);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }]
      });
      mockSupabaseInsert.mockResolvedValue({ data: [], error: null });

      const docParams = {
        escritorioId: 'esc-123',
        documentoId: 'doc-999',
        conteudoCompleto: 'DOS FATOS\nO cliente sofreu prejuízos operacionais decorrentes da interrupção do serviço.',
        metadata: {
          nome_arquivo: 'Tese_Responsabilidade.pdf',
          tipo: 'petição' as const,
          area_direito: 'civil'
        }
      };

      const chunksIngested = await processAndStorePlaybook(docParams);
      
      expect(chunksIngested).toBe(1);
      expect(mockEmbeddingsCreate).toHaveBeenCalled();
      expect(mockSupabaseInsert).toHaveBeenCalled();
      
      // Checa se o insert recebeu a estrutura com embedding correto
      const lastInsertCall = mockSupabaseInsert.mock.calls[0][0] as any[];
      expect(lastInsertCall[0].escritorio_id).toBe('esc-123');
      expect(lastInsertCall[0].embedding).toEqual(mockEmbedding);
      expect(lastInsertCall[0].metadata.secao).toBe('DOS FATOS');
    });
  });

  describe('Retrieval & Dynamic Reranking', () => {
    it('deve consultar RPC de busca vetorial e aplicar reranking com base no contexto', async () => {
      // 1. Mock do retorno da RPC vetorial do Supabase
      const mockResults = [
        {
          id: 'chunk-1',
          conteudo: 'Fragmento de tese tributária sobre isenção de imposto.',
          metadata: { area_direito: 'tributário', tipo: 'parecer' },
          similarity: 0.70
        },
        {
          id: 'chunk-2',
          conteudo: 'Modelo de cláusula civil geral para contratos particulares.',
          metadata: { area_direito: 'civil', tipo: 'contrato' },
          similarity: 0.65
        }
      ];
      mockSupabaseRpc.mockResolvedValue({ data: mockResults, error: null });

      // 2. Mock dos embeddings para a query
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: Array(1536).fill(0.05) }]
      });

      // Busca semântica por tema tributário
      const retrieved = await buscarPlaybooks('Preciso de um parecer de imposto tributário', 'esc-123', 5);

      expect(retrieved.length).toBe(2);
      
      // O chunk 1 fala de tributário e deve subir o score devido às heurísticas
      // similarity base: 0.70. Boost de área (tributário) +0.05 + boost de termos match.
      expect(retrieved[0].id).toBe('chunk-1');
      expect(retrieved[0].score).toBeGreaterThan(0.70);

      // O chunk 2 não coincide com a área e deve reter ou receber pouca variação
      expect(retrieved[1].id).toBe('chunk-2');
    });
  });
});
