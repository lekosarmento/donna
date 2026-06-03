import { OpenAI } from 'openai';
import { supabase } from '../config/supabase.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_openai_api_key'
});

export interface PlaybookChunk {
  id?: string;
  escritorio_id: string;
  documento_id: string;
  chunk_index: number;
  conteudo: string;
  embedding: number[];
  metadata: any;
}

/**
 * Divide o texto do documento jurídico em chunks respeitando a estrutura das seções principais
 * (Dos Fatos, Do Direito, etc.) com tamanho máximo e overlap controlado.
 */
export function chunkLegalDocument(
  text: string
): Array<{ content: string; section: string; index: number }> {
  const lines = text.split('\n');
  const sections: Array<{ title: string; paragraphs: string[] }> = [];
  
  let currentTitle = 'INTRODUÇÃO / GERAL';
  let currentParagraphs: string[] = [];

  const sectionRegex = /^(?:[I|V|X|L|C]+\.?\s*)?(DOS\s+FATOS|DO\s+DIREITO|DOS\s+PEDIDOS|DA\s+TUTELA|DA\s+PRELIMINAR|DO\s+OBJETO|DAS\s+OBRIGAÇÕES|DA\s+RESCISÃO|DAS\s+PENALIDADES|DISPOSIÇÕES\s+GERAIS|PARECER|DO\s+HISTÓRICO|DA\s+FUNDAMENTAÇÃO|DO\s+CONTRATO|DO\s+CABIMENTO|DA\s+TEMPESTIVIDADE)/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detecta cabeçalhos estruturais para segmentação por assunto
    if (trimmed.length < 100 && sectionRegex.test(trimmed)) {
      if (currentParagraphs.length > 0) {
        sections.push({ title: currentTitle, paragraphs: currentParagraphs });
      }
      currentTitle = trimmed.toUpperCase();
      currentParagraphs = [];
    } else {
      currentParagraphs.push(trimmed);
    }
  }

  if (currentParagraphs.length > 0) {
    sections.push({ title: currentTitle, paragraphs: currentParagraphs });
  }

  if (sections.length === 0 && text.trim().length > 0) {
    sections.push({ title: 'GERAL', paragraphs: text.split('\n\n').map(p => p.trim()).filter(Boolean) });
  }

  const finalChunks: Array<{ content: string; section: string; index: number }> = [];
  let overallIndex = 0;

  const MAX_CHARS = 2048; // ~512 tokens
  const OVERLAP_CHARS = 200; // ~50 tokens

  for (const sec of sections) {
    let currentChunk = '';
    
    // Divide parágrafos individualmente longos antes de juntá-los em chunks
    const processedParagraphs: string[] = [];
    for (const p of sec.paragraphs) {
      if (p.length > MAX_CHARS) {
        processedParagraphs.push(...splitLongParagraph(p, MAX_CHARS, OVERLAP_CHARS));
      } else {
        processedParagraphs.push(p);
      }
    }
    
    for (const p of processedParagraphs) {
      if ((currentChunk + '\n\n' + p).length > MAX_CHARS) {
        if (currentChunk.trim().length > 0) {
          finalChunks.push({
            content: currentChunk.trim(),
            section: sec.title,
            index: overallIndex++
          });
        }
        
        // Aplica sliding window / overlap
        if (currentChunk.length > OVERLAP_CHARS) {
          const overlapStart = currentChunk.length - OVERLAP_CHARS;
          currentChunk = currentChunk.substring(overlapStart) + '\n\n' + p;
        } else {
          currentChunk = p;
        }
      } else {
        if (currentChunk === '') {
          currentChunk = p;
        } else {
          currentChunk += '\n\n' + p;
        }
      }
    }

    if (currentChunk.trim().length > 0) {
      finalChunks.push({
        content: currentChunk.trim(),
        section: sec.title,
        index: overallIndex++
      });
    }
  }

  return finalChunks;
}

/**
 * Divide parágrafos longos em partes menores respeitando limites e tentando manter palavras intactas.
 */
function splitLongParagraph(p: string, max: number, overlap: number): string[] {
  const subChunks: string[] = [];
  let start = 0;
  while (start < p.length) {
    // Para que caiba com o overlap na junção, o tamanho de cada pedaço subsequente deve ser menor
    const limit = start === 0 ? max : (max - overlap - 10);
    let end = start + limit;
    if (end > p.length) {
      end = p.length;
    } else {
      const lastSpace = p.lastIndexOf(' ', end);
      if (lastSpace > start + limit - 200) {
        end = lastSpace;
      }
    }
    subChunks.push(p.substring(start, end).trim());
    if (end === p.length) break;
    start = end - overlap;
  }
  return subChunks;
}

/**
 * Gera vetores de embeddings na OpenAI para uma lista de textos (chunks) em lotes (batch) de 100.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch
      });
      
      embeddings.push(...response.data.map(item => item.embedding));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Erro ao chamar a API de Embeddings da OpenAI: ${errMsg}`);
    }
  }
  
  return embeddings;
}

/**
 * Ingesta e processa o documento completo: faz o chunking, gera embeddings, e salva no Supabase.
 */
export async function processAndStorePlaybook(params: {
  escritorioId: string;
  documentoId: string;
  conteudoCompleto: string;
  metadata: {
    nome_arquivo: string;
    tipo: 'petição' | 'parecer' | 'contrato';
    area_direito: string;
    [key: string]: any;
  };
}): Promise<number> {
  const { escritorioId, documentoId, conteudoCompleto, metadata } = params;
  
  // 1. Chunking inteligente
  const chunks = chunkLegalDocument(conteudoCompleto);
  if (chunks.length === 0) return 0;
  
  // 2. Geração dos embeddings na OpenAI
  const textList = chunks.map(c => c.content);
  const embeddings = await generateEmbeddings(textList);
  
  // 3. Salvar no Supabase
  const insertRows: PlaybookChunk[] = chunks.map((c, i) => ({
    escritorio_id: escritorioId,
    documento_id: documentoId,
    chunk_index: c.index,
    conteudo: c.content,
    embedding: embeddings[i],
    metadata: {
      ...metadata,
      secao: c.section
    }
  }));

  const { error } = await supabase.from('playbook_chunks').insert(insertRows);
  if (error) {
    throw new Error(`Erro ao persistir playbook_chunks no Supabase: ${error.message}`);
  }
  
  return chunks.length;
}
