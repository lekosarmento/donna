import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import crypto from 'crypto';
import path from 'path';
import { supabase } from '../config/supabase.js';
import { processAndStorePlaybook } from './embedding-service.js';

export default async function ragIngestorRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

  fastify.post('/api/playbooks/ingest', async (request, reply) => {
    // 1. Validar Token JWT
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Token Bearer ausente ou inválido.' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // 2. Autenticar usuário no Supabase auth
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return reply.status(401).send({ error: 'Autenticação inválida ou expirada.' });
    }
    
    // 3. Obter escritório do usuário
    const { data: userRecord, error: dbError } = await supabase
      .from('usuarios')
      .select('escritorio_id')
      .eq('id', authData.user.id)
      .single();
      
    if (dbError || !userRecord) {
      return reply.status(403).send({ error: 'Usuário não vinculado a um escritório no banco de dados.' });
    }
    
    const escritorioId = userRecord.escritorio_id;

    // 4. Configurar headers SSE (Server-Sent Events)
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const sendProgress = (progress: number, status: string, message: string, extra = {}) => {
      reply.raw.write(`data: ${JSON.stringify({ progress, status, message, ...extra })}\n\n`);
    };

    try {
      sendProgress(10, 'uploading', 'Recebendo arquivo e processando upload...');

      // 5. Obter arquivo multipart
      const fileData = await request.file();
      if (!fileData) {
        sendProgress(0, 'error', 'Nenhum arquivo enviado no corpo do formulário.');
        reply.raw.end();
        return;
      }

      const buffer = await fileData.toBuffer();
      
      // Validação de segurança (Path Traversal & Extensão)
      const rawFilename = fileData.filename || 'upload.bin';
      const normalizedOriginalName = path.normalize(path.basename(rawFilename)).replace(/^(\.\.(\/|\\|$))+/, '');
      const extension = normalizedOriginalName.split('.').pop()?.toLowerCase();

      // Mapeamento seguro de arquivo (Anti-Path Traversal) - UUID ao invés do nome original
      const safeFilename = `${crypto.randomUUID()}.${extension}`;

      // Limite de tamanho
      const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
      if (buffer.length > MAX_FILE_SIZE) {
        throw new Error('O arquivo excede o tamanho máximo permitido de 15MB.');
      }

      sendProgress(30, 'extracting', `Extraindo texto do arquivo original ${normalizedOriginalName}...`);

      let text = '';
      if (extension === 'pdf') {
        const pdfParse = require('pdf-parse');
        const parsed = await pdfParse(buffer);
        text = parsed.text;
      } else if (extension === 'docx') {
        const mammoth = require('mammoth');
        const parsed = await mammoth.extractRawText({ buffer });
        text = parsed.value;
      } else if (extension === 'txt') {
        text = buffer.toString('utf-8');
      } else {
        throw new Error(`Extensão de arquivo não suportada: .${extension}. Use PDF, DOCX ou TXT.`);
      }

      if (!text.trim()) {
        throw new Error('O arquivo enviado está vazio ou não contém texto extraível.');
      }

      sendProgress(50, 'classifying', 'Classificando tipo de documento e área jurídica...');

      // 6. Classificação Heurística de Domínio Jurídico
      const { tipo, area_direito } = classificarDocumento(text);
      sendProgress(60, 'chunking', `Documento identificado como ${tipo.toUpperCase()} (${area_direito.toUpperCase()}). Iniciando chunking...`);

      // 7. Processar chunks, embeddings e persistir
      const documentoId = crypto.randomUUID(); // ID do documento em processamento
      
      sendProgress(75, 'embeddings', 'Gerando embeddings vetoriais via OpenAI (text-embedding-3-small)...');
      
      const chunksCount = await processAndStorePlaybook({
        escritorioId,
        documentoId,
        conteudoCompleto: text,
        metadata: {
          nome_arquivo: normalizedOriginalName,
          safe_filename: safeFilename,
          tipo,
          area_direito,
          extensao: extension,
          tamanho_bytes: buffer.length
        }
      });

      sendProgress(100, 'success', 'Ingestão concluída e playbook indexado com sucesso no banco vetorial!', {
        chunksCount,
        documentoId,
        tipo,
        area_direito
      });
      
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      sendProgress(0, 'error', `Falha no processamento do documento: ${errMsg}`);
    } finally {
      reply.raw.end();
    }
  });
}

export function classificarDocumento(text: string): { tipo: 'petição' | 'parecer' | 'contrato'; area_direito: string } {
  const lower = text.toLowerCase();
  let tipo: 'petição' | 'parecer' | 'contrato' = 'parecer';
  let area_direito = 'civil';

  // 1. Identificar tipo por termos estruturais
  if (lower.includes('contrato') || lower.includes('cláusula') || lower.includes('instrumento particular') || lower.includes('rescisão')) {
    tipo = 'contrato';
  } else if (
    lower.includes('excelentíssimo') || 
    lower.includes('exmo') || 
    lower.includes('douto juízo') || 
    lower.includes('petição inicial') || 
    lower.includes('contestação') ||
    lower.includes('recurso')
  ) {
    tipo = 'petição';
  }

  // 2. Identificar área por domínios jurídicos
  if (lower.includes('tributário') || lower.includes('imposto') || lower.includes('fisco') || lower.includes('icms') || lower.includes('tributo')) {
    area_direito = 'tributário';
  } else if (lower.includes('trabalhista') || lower.includes('reclamante') || lower.includes('reclamado') || lower.includes('empregado') || lower.includes('clt') || lower.includes('vínculo empregatício')) {
    area_direito = 'trabalhista';
  } else if (lower.includes('família') || lower.includes('divórcio') || lower.includes('pensão alimentícia') || lower.includes('guarda') || lower.includes('casamento')) {
    area_direito = 'família';
  } else if (lower.includes('consumidor') || lower.includes('cdc') || lower.includes('vício do produto') || lower.includes('danos morais')) {
    area_direito = 'consumidor';
  }

  return { tipo, area_direito };
}
