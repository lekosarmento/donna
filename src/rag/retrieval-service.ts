import { supabase } from '../config/supabase.js';
import { generateEmbeddings } from './embedding-service.js';

export interface RetrievedChunk {
  id: string;
  escritorio_id: string;
  documento_id: string;
  chunk_index: number;
  conteudo: string;
  metadata: any;
  similarity: number;
  score?: number; // Score final após reranking
}

/**
 * Busca por similaridade cosseno nos chunks de playbooks de um escritório e aplica rerank.
 */
export async function buscarPlaybooks(
  query: string,
  escritorioId: string,
  topK = 5
): Promise<RetrievedChunk[]> {
  try {
    // 1. Gerar o embedding da query
    const queryEmbeddings = await generateEmbeddings([query]);
    if (queryEmbeddings.length === 0) return [];
    const queryEmbedding = queryEmbeddings[0];

    // 2. Chamar a RPC do Supabase para busca de similaridade cosseno
    const { data: matchedChunks, error } = await supabase.rpc('match_playbook_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25, // Limiar mínimo de similaridade semântica
      match_count: topK * 2,  // Recupera o dobro para reranking local
      filter_escritorio_id: escritorioId
    });

    if (error) {
      throw new Error(`Erro ao invocar RPC match_playbook_chunks no Supabase: ${error.message}`);
    }

    const chunks = (matchedChunks || []) as RetrievedChunk[];

    // 3. Reranking dinâmico e contextual
    const queryLower = query.toLowerCase();
    
    const reranked = chunks.map((chunk) => {
      let score = chunk.similarity;
      const metadata = chunk.metadata || {};

      // Heurística de Rerank 1: Correspondência de Área do Direito
      if (metadata.area_direito) {
        const area = String(metadata.area_direito).toLowerCase();
        if (queryLower.includes(area)) {
          score += 0.05; // Pequeno boost para chunks da mesma área jurídica
        }
      }

      // Heurística de Rerank 2: Correspondência de Tipo do Documento
      if (metadata.tipo) {
        const tipo = String(metadata.tipo).toLowerCase();
        if (queryLower.includes(tipo)) {
          score += 0.03;
        }
      }

      // Heurística de Rerank 3: Densidade de palavras-chave da busca no fragmento
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);
      const contentLower = chunk.conteudo.toLowerCase();
      let matchCount = 0;
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          matchCount++;
        }
      }
      if (queryWords.length > 0) {
        score += (matchCount / queryWords.length) * 0.02;
      }

      return {
        ...chunk,
        score: Math.min(score, 1.0) // Clampa em 1.0
      };
    });

    // Ordena pelo score reranked final e limita ao topK solicitado
    return reranked
      .sort((a, b) => (b.score || b.similarity) - (a.score || a.similarity))
      .slice(0, topK);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[RAG Retrieval] Falha crítica de recuperação semântica: ${errorMsg}`);
    return [];
  }
}
