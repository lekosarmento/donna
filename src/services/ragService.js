import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { supabase } from '../config/supabase.js';

dotenv.config();

/**
 * MOTOR DE RECUPERAÇÃO SEMÂNTICA (Motor 6 - RAG) — Donna Core
 * Pipeline para gerar embeddings e realizar busca semântica.
 * Banco vetorial híbrido: pgvector no Supabase + Banco Vetorial local em JSON com similaridade por cosseno.
 */

const CONHECIMENTO_FILE_PATH = path.join(process.cwd(), 'src', 'config', 'base_conhecimento.json');

// Garante o arquivo local para o Vector DB offline
function inicializarArquivoConhecimento() {
  try {
    const dir = path.dirname(CONHECIMENTO_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(CONHECIMENTO_FILE_PATH)) {
      fs.writeFileSync(CONHECIMENTO_FILE_PATH, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[Donna Local RAG] Erro ao inicializar base de conhecimento:', err.message);
  }
}

inicializarArquivoConhecimento();

function carregarConhecimentoLocal() {
  try {
    inicializarArquivoConhecimento();
    const data = fs.readFileSync(CONHECIMENTO_FILE_PATH, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('[Donna Local RAG] Erro ao carregar conhecimento local:', err.message);
    return [];
  }
}

function salvarConhecimentoLocal(documentos) {
  try {
    inicializarArquivoConhecimento();
    fs.writeFileSync(CONHECIMENTO_FILE_PATH, JSON.stringify(documentos, null, 2), 'utf8');
  } catch (err) {
    console.error('[Donna Local RAG] Erro ao salvar conhecimento local:', err.message);
  }
}

function calcularSimilaridadeCosseno(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Gera o embedding de 1536 dimensões para um determinado texto usando a API do Gemini.
 * @param {string} texto - Conteúdo para vetorização
 * @returns {Promise<number[]>} Array com 1536 números flutuantes (o embedding)
 */
export async function gerarEmbedding(texto) {
  if (!texto || typeof texto !== 'string') {
    throw new Error('Texto inválido fornecido para geração de embedding.');
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey || geminiApiKey.startsWith('dummy_')) {
    console.log('[RAG Service] Usando vetor simulado de 1536 dimensões (Modo Demo)...');
    return new Array(1536).fill(0).map(() => Math.random() * 0.1);
  }

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${geminiApiKey}`,
      {
        content: {
          parts: [{ text: texto.trim().replace(/\n/g, ' ') }]
        },
        outputDimensionality: 1536
      }
    );

    const geminiVector = response.data?.embedding?.values;
    if (!geminiVector) {
      throw new Error('Resposta de embedding vazia do Gemini.');
    }
    
    return geminiVector;
  } catch (error) {
    console.error('Erro ao chamar API de Embeddings do Gemini (gemini-embedding-2):', error.response?.data || error.message);
    return new Array(1536).fill(0).map(() => Math.random() * 0.1);
  }
}

/**
 * Insere um novo documento/playbook na Base de Conhecimento, gerando o embedding automaticamente.
 */
export async function inserirNaBaseConhecimento({
  tipo,
  titulo,
  conteudo,
  tags = [],
  area_direito,
  tribunal = null,
  autorId = null,
  aprovado = false,
}) {
  try {
    console.log(`Gerando embedding para o documento: "${titulo}"...`);
    const embedding = await gerarEmbedding(conteudo);

    try {
      const { data, error } = await supabase
        .from('base_conhecimento')
        .insert({
          tipo,
          titulo,
          conteudo,
          tags,
          area_direito,
          tribunal,
          autor_id: autorId,
          embedding,
          aprovado,
        })
        .select('id, tipo, titulo, area_direito, aprovado')
        .single();

      if (!error && data) {
        console.log(`Documento "${titulo}" inserido com sucesso no Supabase! ID: ${data.id}`);
        return data;
      }
    } catch (err) {
      console.warn('[Donna RAG] Falha ao inserir playbook no Supabase, salvando localmente...', err.message);
    }

    // Persistência local no JSON Vector DB offline
    const localDoc = {
      id: `local-doc-${Date.now()}`,
      tipo,
      titulo,
      conteudo,
      tags,
      area_direito,
      tribunal,
      autor_id: autorId,
      embedding,
      aprovado,
      created_at: new Date().toISOString()
    };

    const conhecimento = carregarConhecimentoLocal();
    conhecimento.push(localDoc);
    salvarConhecimentoLocal(conhecimento);

    console.log(`Documento "${titulo}" inserido com sucesso na base vetorial JSON local! ID: ${localDoc.id}`);
    return {
      id: localDoc.id,
      tipo: localDoc.tipo,
      titulo: localDoc.titulo,
      area_direito: localDoc.area_direito,
      aprovado: localDoc.aprovado
    };
  } catch (error) {
    console.error('Erro ao inserir documento na base de conhecimento:', error.message);
    throw error;
  }
}

/**
 * Realiza a busca semântica (RAG) por documentos relevantes na base de conhecimento.
 */
export async function buscarSemanticaRAG({
  query,
  matchThreshold = 0.25,
  matchCount = 4,
  filtroTipo = null,
  filtroArea = null,
}) {
  try {
    console.log(`Iniciando busca semântica por: "${query.substring(0, 50)}..."`);
    const embedding = await gerarEmbedding(query);

    try {
      const { data: resultados, error } = await supabase.rpc('buscar_conhecimento', {
        query_embedding: embedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        filtro_tipo: filtroTipo,
        filtro_area: filtroArea,
      });

      if (!error && resultados && resultados.length > 0) {
        console.log(`Busca semântica no Supabase retornou ${resultados.length} documentos.`);
        return resultados;
      }
    } catch (err) {
      console.warn('[Donna RAG] Falha na busca semântica no Supabase, buscando local...', err.message);
    }

    // Similaridade de Cosseno local em Javascript
    const documentos = carregarConhecimentoLocal();
    console.log(`Realizando similaridade cosseno local entre ${documentos.length} documentos...`);

    const resultadosLocais = documentos
      .map(doc => {
        const similarity = calcularSimilaridadeCosseno(embedding, doc.embedding);
        return {
          id: doc.id,
          tipo: doc.tipo,
          titulo: doc.titulo,
          conteudo: doc.conteudo,
          area_direito: doc.area_direito,
          similaridade: similarity
        };
      })
      .filter(doc => doc.similaridade >= matchThreshold)
      .sort((a, b) => b.similaridade - a.similaridade)
      .slice(0, matchCount);

    console.log(`Busca semântica local retornou ${resultadosLocais.length} documentos.`);
    return resultadosLocais;
  } catch (error) {
    console.error('Erro na busca RAG no Supabase:', error.message);
    return [];
  }
}
