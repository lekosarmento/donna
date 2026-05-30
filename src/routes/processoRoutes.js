import fs from 'fs';
import path from 'path';
import { supabase } from '../config/supabase.js';
import { jsonMutex } from '../config/jsonMutex.js';

/**
 * ROTAS DE PROCESSOS E ATORES — Donna API
 * CRUD e consultas analíticas para a carteira de processos e inteligência de campo de atores.
 * Persistência híbrida automatizada: Supabase (em nuvem) + Fallback Local JSON resiliente.
 */

const PROCESSOS_FILE_PATH = path.join(process.cwd(), 'src', 'config', 'processos_donna.json');
const ATORES_FILE_PATH = path.join(process.cwd(), 'src', 'config', 'atores_donna.json');
const INTERACOES_FILE_PATH = path.join(process.cwd(), 'src', 'config', 'interacoes_donna.json');

// Garante o arquivo local para o armazenamento offline
function inicializarArquivoLocal(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (err) {
    console.error(`[Donna Local DB] Erro ao inicializar arquivo ${path.basename(filePath)}:`, err.message);
  }
}

inicializarArquivoLocal(PROCESSOS_FILE_PATH);
inicializarArquivoLocal(ATORES_FILE_PATH);
inicializarArquivoLocal(INTERACOES_FILE_PATH);

async function carregarDadosLocais(filePath) {
  try {
    inicializarArquivoLocal(filePath);
    return await jsonMutex.safeRead(filePath, []);
  } catch (err) {
    console.error(`[Donna Local DB] Erro ao carregar dados de ${path.basename(filePath)}:`, err.message);
    return [];
  }
}

async function salvarDadosLocais(filePath, dados) {
  try {
    inicializarArquivoLocal(filePath);
    await jsonMutex.safeWrite(filePath, dados);
  } catch (err) {
    console.error(`[Donna Local DB] Erro ao salvar dados em ${path.basename(filePath)}:`, err.message);
  }
}

export default async function processoRoutes(fastify, options) {
  
  /**
   * POST: Cadastrar novo processo na carteira
   */
  fastify.post('/processos', async (request, reply) => {
    const { 
      numero_cnj, tribunal, comarca, vara, juiz_id, classe, assunto, 
      rito, fase_processual, cliente_id, advogado_responsavel_id, prioridade, observacoes 
    } = request.body;

    if (!numero_cnj || !tribunal || !cliente_id) {
      return reply.status(400).send({ error: 'Os campos "numero_cnj", "tribunal" e "cliente_id" são obrigatórios.' });
    }

    try {
      try {
        const { data, error } = await supabase
          .from('processos')
          .insert({
            numero_cnj,
            tribunal,
            comarca,
            vara,
            juiz_id: juiz_id || null,
            classe: classe || null,
            assunto: assunto || null,
            rito: rito || null,
            fase_processual: fase_processual || null,
            cliente_id,
            advogado_responsavel_id: advogado_responsavel_id || null,
            prioridade: prioridade || 'media',
            observacoes: observacoes || null
          })
          .select('*')
          .single();

        if (!error && data) {
          return reply.status(21).send(data);
        }
      } catch (err) {
        console.warn('[Donna Processes] Falha ao cadastrar processo no Supabase, salvando localmente...', err.message);
      }

      // Fallback local em JSON
      const localProcesso = {
        id: `local-proc-${Date.now()}`,
        numero_cnj,
        tribunal,
        comarca,
        vara,
        juiz_id: juiz_id || null,
        classe: classe || assunto || 'Ação',
        assunto: assunto || null,
        rito: rito || null,
        fase_processual: fase_processual || 'Instrução',
        cliente_id,
        advogado_responsavel_id: advogado_responsavel_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
        prioridade: prioridade || 'media',
        status: 'ativo',
        observacoes: observacoes || null,
        created_at: new Date().toISOString()
      };

      await jsonMutex.safeUpdate(PROCESSOS_FILE_PATH, (processos) => {
        processos.push(localProcesso);
        return processos;
      }, []);

      return reply.status(201).send(localProcesso);

    } catch (error) {
      console.error('Erro ao cadastrar processo:', error.message);
      return reply.status(500).send({ error: 'Erro ao cadastrar processo.', detalhes: error.message });
    }
  });

  /**
   * GET: Listar todos os processos da carteira
   */
  fastify.get('/processos', async (request, reply) => {
    try {
      try {
        const { data, error } = await supabase
          .from('processos')
          .select(`
            id,
            numero_cnj,
            tribunal,
            comarca,
            vara,
            prioridade,
            status,
            created_at,
            clientes (id, nome),
            usuarios (id, nome)
          `)
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          return reply.send(data);
        }
      } catch (err) {
        console.warn('[Donna Processes] Falha ao listar processos do Supabase, carregando local...', err.message);
      }

      // Fallback: carregar lista local
      const processosLocais = await carregarDadosLocais(PROCESSOS_FILE_PATH);
      const output = processosLocais.map(p => ({
        id: p.id,
        numero_cnj: p.numero_cnj,
        tribunal: p.tribunal,
        comarca: p.comarca,
        vara: p.vara,
        prioridade: p.prioridade,
        status: p.status,
        created_at: p.created_at,
        clientes: { id: p.cliente_id, nome: String(p.cliente_id).startsWith('local-cli') ? 'Cliente Local' : 'Banco do Brasil S.A.' },
        usuarios: { id: p.advogado_responsavel_id, nome: 'Dr. Roberto Silva' }
      })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return reply.send(output);

    } catch (error) {
      console.error('Erro ao listar processos:', error.message);
      return reply.status(500).send({ error: 'Erro ao obter processos.', detalhes: error.message });
    }
  });

  /**
   * GET: Visualizar processo em detalhes
   */
  fastify.get('/processos/:id', async (request, reply) => {
    const { id } = request.params;

    if (String(id).startsWith('local-proc-')) {
      const processos = await carregarDadosLocais(PROCESSOS_FILE_PATH);
      const proc = processos.find(p => p.id === id);
      if (proc) {
        return reply.send({
          ...proc,
          clientes: { id: proc.cliente_id, nome: 'Banco do Brasil S.A.' },
          usuarios: { id: proc.advogado_responsavel_id, nome: 'Dr. Roberto Silva' },
          atores_judiciario: { nome: proc.juiz_id || 'Dr. João Carlos de Albuquerque' },
          movimentacoes: [],
          prazos: []
        });
      }
    }

    try {
      // Carregar processo
      const { data: processo, error: procError } = await supabase
        .from('processos')
        .select(`
          *,
          clientes (*),
          usuarios (*),
          atores_judiciario (*)
        `)
        .eq('id', id)
        .single();

      if (procError || !processo) {
        // Se falhou no banco, verifica se existe localmente
        const processos = await carregarDadosLocais(PROCESSOS_FILE_PATH);
        const proc = processos.find(p => p.id === id);
        if (proc) {
          return reply.send({
            ...proc,
            clientes: { id: proc.cliente_id, nome: 'Banco do Brasil S.A.' },
            usuarios: { id: proc.advogado_responsavel_id, nome: 'Dr. Roberto Silva' },
            atores_judiciario: { nome: 'Dr. João Carlos de Albuquerque' },
            movimentacoes: [],
            prazos: []
          });
        }
        return reply.status(404).send({ error: 'Processo não encontrado.' });
      }

      // Carregar movimentações
      const { data: movimentacoes } = await supabase
        .from('movimentacoes')
        .select('*')
        .eq('processo_id', id)
        .order('data_evento', { ascending: false });

      // Carregar prazos
      const { data: prazos } = await supabase
        .from('prazos')
        .select('*')
        .eq('processo_id', id)
        .order('data_vencimento', { ascending: true });

      return reply.send({
        ...processo,
        movimentacoes: movimentacoes || [],
        prazos: prazos || []
      });
    } catch (error) {
      console.error('Erro ao buscar processo detalhado:', error.message);
      return reply.status(500).send({ error: 'Erro ao buscar detalhes.', detalhes: error.message });
    }
  });

  /**
   * POST: Cadastrar/Atualizar perfil de Ator do Judiciário
   */
  fastify.post('/atores', async (request, reply) => {
    const { 
      id, tipo, nome, nome_usual, tribunal, comarca, vara, cargo_atual,
      telefone_gabinete, telefone_secretaria, telefone_direto, whatsapp, email_gabinete, email_direto,
      horario_atendimento, melhor_forma_contato, observacoes_contato,
      perfil_decisorio, temperamento, estilo_audiencia, receptividade_acordos,
      pontos_positivos, pontos_atencao, preferencias_processuais, historico_decisoes_relevantes,
      notas_estrategicas, atualizado_por, fonte_informacao_perfil, grau_confianca_perfil, escritorio_id
    } = request.body;

    const targetEscritorioId = escritorio_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910';

    if (!tipo || !nome || !tribunal) {
      return reply.status(400).send({ error: 'Os campos "tipo", "nome" e "tribunal" são obrigatórios.' });
    }

    try {
      try {
        let result;
        if (id && !String(id).startsWith('local-')) {
          // Atualizar existente
          const { data, error } = await supabase
            .from('atores_judiciario')
            .update({
              tipo, nome, nome_usual, tribunal, comarca, vara, cargo_atual,
              telefone_gabinete, telefone_secretaria, telefone_direto, whatsapp, email_gabinete, email_direto,
              horario_atendimento, melhor_forma_contato, observacoes_contato,
              perfil_decisorio, temperamento, estilo_audiencia, receptividade_acordos,
              pontos_positivos, pontos_atencao, preferencias_processuais, historico_decisoes_relevantes,
              notas_estrategicas, atualizado_por,
              fonte_informacao_perfil: fonte_informacao_perfil || 'experiencia_socio',
              grau_confianca_perfil: grau_confianca_perfil || 3,
              ultima_atualizacao_perfil: new Date().toISOString().split('T')[0]
            })
            .eq('id', id)
            .select('*')
            .single();

          if (error) throw error;
          result = data;
        } else {
          // Criar novo
          const { data, error } = await supabase
            .from('atores_judiciario')
            .insert({
              escritorio_id: targetEscritorioId,
              tipo, nome, nome_usual, tribunal, comarca, vara, cargo_atual,
              telefone_gabinete, telefone_secretaria, telefone_direto, whatsapp, email_gabinete, email_direto,
              horario_atendimento, melhor_forma_contato, observacoes_contato,
              perfil_decisorio, temperamento, estilo_audiencia, receptividade_acordos,
              pontos_positivos: pontos_positivos || [],
              pontos_atencao: pontos_atencao || [],
              preferencias_processuais, historico_decisoes_relevantes,
              notas_estrategicas, atualizado_por,
              fonte_informacao_perfil: fonte_informacao_perfil || 'experiencia_socio',
              grau_confianca_perfil: grau_confianca_perfil || 3
            })
            .select('*')
            .single();

          if (error) throw error;
          result = data;
        }

        return reply.send(result);
      } catch (err) {
        console.warn('[Donna Actors] Falha ao interagir no Supabase, salvando localmente...', err.message);
      }

      // Persistência local do perfil comportamental do juiz sob transação segura
      let localAtor;
      await jsonMutex.safeUpdate(ATORES_FILE_PATH, (atores) => {
        if (id && String(id).startsWith('local-')) {
          const idx = atores.findIndex(a => a.id === id);
          if (idx !== -1) {
            atores[idx] = {
              ...atores[idx],
              tipo, nome, nome_usual, tribunal, comarca, vara, cargo_atual,
              telefone_gabinete, telefone_secretaria, telefone_direto, whatsapp, email_gabinete, email_direto,
              horario_atendimento, melhor_forma_contato, observacoes_contato,
              perfil_decisorio, temperamento, estilo_audiencia, receptividade_acordos,
              pontos_positivos: pontos_positivos || [],
              pontos_atencao: pontos_atencao || [],
              preferencias_processuais, historico_decisoes_relevantes,
              notas_estrategicas, atualizado_por,
              fonte_informacao_perfil: fonte_informacao_perfil || 'experiencia_socio',
              grau_confianca_perfil: grau_confianca_perfil || 3,
              updated_at: new Date().toISOString()
            };
            localAtor = atores[idx];
          }
        }

        if (!localAtor) {
          localAtor = {
            id: `local-ator-${Date.now()}`,
            escritorio_id: targetEscritorioId,
            tipo, nome, nome_usual, tribunal, comarca, vara, cargo_atual,
            telefone_gabinete, telefone_secretaria, telefone_direto, whatsapp, email_gabinete, email_direto,
            horario_atendimento, melhor_forma_contato, observacoes_contato,
            perfil_decisorio, temperamento, estilo_audiencia, receptividade_acordos,
            pontos_positivos: pontos_positivos || [],
            pontos_atencao: pontos_atencao || [],
            preferencias_processuais, historico_decisoes_relevantes,
            notas_estrategicas, atualizado_por,
            fonte_informacao_perfil: fonte_informacao_perfil || 'experiencia_socio',
            grau_confianca_perfil: grau_confianca_perfil || 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          atores.push(localAtor);
        }
        return atores;
      }, []);

      return reply.send(localAtor);

    } catch (error) {
      console.error('Erro ao salvar ator do judiciário:', error.message);
      return reply.status(500).send({ error: 'Erro ao registrar perfil comportamental.', detalhes: error.message });
    }
  });

  /**
   * GET: Obter inteligência de campo de um Ator e suas interações históricas
   */
  fastify.get('/atores/:id', async (request, reply) => {
    const { id } = request.params;

    if (String(id).startsWith('local-ator-')) {
      const atores = await carregarDadosLocais(ATORES_FILE_PATH);
      const ator = atores.find(a => a.id === id);
      if (ator) {
        const interacoes = (await carregarDadosLocais(INTERACOES_FILE_PATH)).filter(i => i.ator_id === id);
        return reply.send({
          ...ator,
          historico_interacoes: interacoes
        });
      }
    }

    try {
      const { data: ator, error: atorError } = await supabase
        .from('atores_judiciario')
        .select('*')
        .eq('id', id)
        .single();

      if (atorError || !ator) {
        // Fallback local
        const atores = await carregarDadosLocais(ATORES_FILE_PATH);
        const atorLocal = atores.find(a => a.id === id);
        if (atorLocal) {
          const interacoes = (await carregarDadosLocais(INTERACOES_FILE_PATH)).filter(i => i.ator_id === id);
          return reply.send({
            ...atorLocal,
            historico_interacoes: interacoes
          });
        }
        return reply.status(404).send({ error: 'Perfil comportamental do ator não localizado.' });
      }

      // Buscar histórico de interações com o escritório (memória tática de campo)
      const { data: interacoes } = await supabase
        .from('interacoes_ator')
        .select(`
          *,
          processos (numero_cnj),
          usuarios (nome)
        `)
        .eq('ator_id', id)
        .order('data_interacao', { ascending: false });

      return reply.send({
        ...ator,
        historico_interacoes: interacoes || []
      });
    } catch (error) {
      console.error('Erro ao obter ator do judiciário:', error.message);
      return reply.status(500).send({ error: 'Erro ao obter dados estratégicos.', detalhes: error.message });
    }
  });

  /**
   * POST: Registrar nova interação tática de campo com ator (Audiência, ligação, despacho oral)
   */
  fastify.post('/atores/:id/interacoes', async (request, reply) => {
    const { id } = request.params;
    const { processo_id, tipo, descricao, resultado, aprendizado, registrado_por } = request.body;

    if (!tipo || !descricao) {
      return reply.status(400).send({ error: 'Os campos "tipo" e "descricao" são obrigatórios.' });
    }

    try {
      try {
        const { data, error } = await supabase
          .from('interacoes_ator')
          .insert({
            ator_id: id,
            processo_id: processo_id || null,
            tipo,
            descricao,
            resultado: resultado || null,
            aprendizado: aprendizado || null,
            registrado_por: registrado_por || null
          })
          .select('*')
          .single();

        if (!error && data) {
          return reply.status(21).send(data);
        }
      } catch (err) {
        console.warn('[Donna Actors] Falha ao registrar interacao no Supabase, salvando localmente...', err.message);
      }

      // Persistência local da interação
      const localInteracao = {
        id: `local-int-${Date.now()}`,
        ator_id: id,
        processo_id: processo_id || null,
        tipo,
        descricao,
        resultado: resultado || null,
        aprendizado: aprendizado || null,
        registrado_por: registrado_por || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
        data_interacao: new Date().toISOString()
      };

      await jsonMutex.safeUpdate(INTERACOES_FILE_PATH, (interacoes) => {
        interacoes.push(localInteracao);
        return interacoes;
      }, []);

      return reply.status(201).send(localInteracao);

    } catch (error) {
      console.error('Erro ao registrar interação com ator:', error.message);
      return reply.status(500).send({ error: 'Erro ao registrar interação.', detalhes: error.message });
    }
  });
}
