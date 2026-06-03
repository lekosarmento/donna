import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import crypto from 'crypto';
import { getLocalDb } from '../config/sqlite-db.js';
import { supabase } from '../config/supabase.js';
import { ScraperService } from '../judges/scraper-service.js';
import { ProfileBuilder } from '../judges/profile-builder.js';

export default async function judgeRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

  /**
   * GET /api/magistrados
   * Retorna todos os magistrados com suporte a busca textual por nome ou comarca
   */
  fastify.get('/api/magistrados', async (request, reply) => {
    const { q } = request.query as { q?: string };
    const db = getLocalDb();

    try {
      let queryStr = 'SELECT * FROM atores_judiciario WHERE tipo IN ("juiz", "desembargador", "ministro")';
      const params: string[] = [];

      if (q) {
        queryStr += ' AND (nome LIKE ? OR comarca LIKE ? OR tribunal LIKE ?)';
        const likeTerm = `%${q}%`;
        params.push(likeTerm, likeTerm, likeTerm);
      }

      queryStr += ' ORDER BY nome ASC';
      const rows = db.prepare(queryStr).all(params) as any[];

      // Mapeia e decodifica campos estruturados JSON (pontos positivos/atencao)
      const mapped = rows.map(r => ({
        ...r,
        pontos_positivos: r.pontos_positivos ? JSON.parse(r.pontos_positivos) : [],
        pontos_atencao: r.pontos_atencao ? JSON.parse(r.pontos_atencao) : []
      }));

      return reply.send(mapped);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Erro ao listar magistrados', detalhes: errMsg });
    }
  });

  /**
   * GET /api/magistrados/:id
   * Retorna os detalhes de um magistrado
   */
  fastify.get('/api/magistrados/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getLocalDb();

    try {
      const row = db.prepare('SELECT * FROM atores_judiciario WHERE id = ?').get(id) as any;
      if (!row) {
        return reply.status(404).send({ error: 'Magistrado não localizado.' });
      }

      return reply.send({
        ...row,
        pontos_positivos: row.pontos_positivos ? JSON.parse(row.pontos_positivos) : [],
        pontos_atencao: row.pontos_atencao ? JSON.parse(row.pontos_atencao) : []
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Erro ao obter magistrado', detalhes: errMsg });
    }
  });

  /**
   * POST /api/magistrados
   * Cadastra um novo magistrado (Dossier)
   */
  fastify.post('/api/magistrados', async (request, reply) => {
    const {
      nome, tipo, tribunal, comarca, vara, cargo_atual,
      telefone_gabinete, email_gabinete, horario_atendimento,
      perfil_decisorio, temperamento, estilo_audiencia, preferencias_processuais,
      escritorio_id
    } = request.body as any;

    if (!nome || !tribunal || !tipo) {
      return reply.status(400).send({ error: 'Nome, tipo e tribunal são obrigatórios.' });
    }

    const db = getLocalDb();
    const id = crypto.randomUUID();
    const targetEscritorioId = escritorio_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910';

    try {
      // Inserir localmente no SQLite
      db.prepare(`
        INSERT INTO atores_judiciario (
          id, escritorio_id, tipo, nome, tribunal, comarca, vara, cargo_atual,
          telefone_gabinete, email_gabinete, horario_atendimento,
          perfil_decisorio, temperamento, estilo_audiencia, preferencias_processuais,
          pontos_positivos, pontos_atencao, sync_pending
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        id,
        targetEscritorioId,
        tipo,
        nome,
        tribunal,
        comarca || '',
        vara || '',
        cargo_atual || 'Magistrado',
        telefone_gabinete || '',
        email_gabinete || '',
        horario_atendimento || '',
        perfil_decisorio || 'outro',
        temperamento || 'rigido',
        estilo_audiencia || '',
        preferencias_processuais || '',
        JSON.stringify([]),
        JSON.stringify([])
      );

      // Tenta persistir no Supabase assincronamente se online
      supabase.from('atores_judiciario').insert({
        id,
        escritorio_id: targetEscritorioId,
        tipo,
        nome,
        tribunal,
        comarca: comarca || '',
        vara: vara || '',
        cargo_atual: cargo_atual || 'Magistrado',
        telefone_gabinete: telefone_gabinete || '',
        email_gabinete: email_gabinete || '',
        horario_atendimento: horario_atendimento || '',
        perfil_decisorio: perfil_decisorio || 'outro',
        temperamento: temperamento || 'rigido',
        estilo_audiencia: estilo_audiencia || '',
        preferencias_processuais: preferencias_processuais || '',
        pontos_positivos: [],
        pontos_atencao: [],
        ativo: true
      }).then(({ error }) => {
        if (!error) {
          db.prepare('UPDATE atores_judiciario SET sync_pending = 0 WHERE id = ?').run(id);
        }
      }).catch(err => {
        console.warn(`[JudgeRoutes] Falha no sync inicial do magistrado no Supabase: ${err}`);
      });

      return reply.status(201).send({ id, nome, tipo, tribunal, status: 'criado' });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Erro ao cadastrar magistrado', detalhes: errMsg });
    }
  });

  /**
   * POST /api/magistrados/:id/ingest
   * Dispara a coleta respeitosa de jurisprudência/decisões do magistrado
   */
  fastify.post('/api/magistrados/:id/ingest', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getLocalDb();

    try {
      const row = db.prepare('SELECT nome FROM atores_judiciario WHERE id = ?').get(id) as any;
      if (!row) {
        return reply.status(404).send({ error: 'Magistrado não localizado para ingestão.' });
      }

      // Executa o scraper de coleta (delay de 2s interno)
      const novasDecisoes = await ScraperService.scrapeDecisoesMagistrado(row.nome, id, 100);

      // Retorna as métricas da ingestão
      const totalDecisoes = (
        db.prepare('SELECT count(*) as count FROM raw_decisoes_magistrados WHERE magistrado_id = ?').get(id) as any
      ).count;

      return reply.send({
        success: true,
        novas_decisoes: novasDecisoes,
        total_decisoes_salvas: totalDecisoes,
        mensagem: `Coleta concluída. Total de ${totalDecisoes} decisões indexadas no banco local.`
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Erro no pipeline de ingestão do magistrado', detalhes: errMsg });
    }
  });

  /**
   * POST /api/magistrados/:id/profile
   * Processa a análise cognitiva do perfil do juiz via Claude com base nas decisões
   */
  fastify.post('/api/magistrados/:id/profile', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const perfil = await ProfileBuilder.gerarPerfilMagistrado(id);
      return reply.send({
        success: true,
        perfil
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: 'Falha ao processar perfil cognitivo', detalhes: errMsg });
    }
  });

  /**
   * GET /api/magistrados/:id/timeline
   * Retorna os snapshots de perfil ao longo do tempo (timeline) e as estatísticas acumuladas de resultados
   */
  fastify.get('/api/magistrados/:id/timeline', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getLocalDb();

    try {
      // 1. Obter snapshots históricos
      const timeline = db.prepare(`
        SELECT perfil_decisorio, temperamento, grau_confianca, decisoes_analisadas, data_registro
        FROM historico_perfis_magistrados
        WHERE magistrado_id = ?
        ORDER BY data_registro ASC, created_at ASC
      `).all(id) as any[];

      // 2. Calcular estatísticas de resultados decisórios do juiz para o gráfico de pizza
      const outcomes = db.prepare(`
        SELECT resultado, count(*) as total
        FROM raw_decisoes_magistrados
        WHERE magistrado_id = ?
        GROUP BY resultado
      `).all(id) as any[];

      const totalDecisoes = outcomes.reduce((acc, curr) => acc + curr.total, 0);

      // Mapeia e normaliza para percentuais de alta fidelidade
      const estatisticas = {
        total: totalDecisoes,
        procedente: 0,
        improcedente: 0,
        parcial: 0,
        outro: 0,
        procedente_pct: 0,
        improcedente_pct: 0,
        parcial_pct: 0,
        outro_pct: 0
      };

      for (const item of outcomes) {
        if (item.resultado in estatisticas) {
          (estatisticas as any)[item.resultado] = item.total;
        }
      }

      if (totalDecisoes > 0) {
        estatisticas.procedente_pct = Math.round((estatisticas.procedente / totalDecisoes) * 100);
        estatisticas.improcedente_pct = Math.round((estatisticas.improcedente / totalDecisoes) * 100);
        estatisticas.parcial_pct = Math.round((estatisticas.parcial / totalDecisoes) * 100);
        estatisticas.outro_pct = 100 - (estatisticas.procedente_pct + estatisticas.improcedente_pct + estatisticas.parcial_pct);
      }

      return reply.send({
        timeline,
        estatisticas
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Erro ao obter timeline e estatísticas', detalhes: errMsg });
    }
  });
}
