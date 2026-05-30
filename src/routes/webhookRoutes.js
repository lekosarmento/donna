import { supabase } from '../config/supabase.js';

/**
 * ROTAS DE WEBHOOKS — Donna API
 * Endpoints seguros e assíncronos para ingestão em tempo real de publicações e andamentos processuais.
 */

const REGEX_CNJ = /\b\d{7}[-.\s]?\d{2}[-.\s]?\d{4}[-.\s]?\d[-.\s]?\d{2}[-.\s]?\d{4}\b/g;
const REGEX_OAB = /\b(OAB)[-.\s]?(?:[A-Z]{2})[-.\s]?\b\d{2,6}\b/gi;

export default async function webhookRoutes(fastify, options) {

  // Middleware auxiliar para verificar token Bearer
  const verificarToken = (request, reply) => {
    const authHeader = request.headers.authorization;
    const secret = process.env.DONNA_WEBHOOK_SECRET || 'donna_default_secret_2026';

    if (!authHeader || authHeader !== `Bearer ${secret}`) {
      reply.status(401).send({ error: 'Não autorizado. Token de webhook inválido ou ausente.' });
      return false;
    }
    return true;
  };

  /**
   * WEBHOOK: Ingestão de Movimentações Processuais
   * Recebe atualizações em tempo real das APIs de monitoramento (Jusbrasil/DataJud)
   * Valida, enfileira como 'pendente' e retorna 202 Accepted em milissegundos.
   */
  fastify.post('/webhooks/movimentacao', async (request, reply) => {
    if (!verificarToken(request, reply)) return;

    const { numero_cnj, data_evento, titulo, descricao, raw_payload } = request.body;

    if (!numero_cnj || !titulo) {
      return reply.status(400).send({ error: 'Parâmetros "numero_cnj" e "titulo" são obrigatórios.' });
    }

    try {
      // 1. Localizar o processo no banco para garantir que é monitorado
      const { data: processo, error: procError } = await supabase
        .from('processos')
        .select('id')
        .eq('numero_cnj', numero_cnj)
        .single();

      if (procError || !processo) {
        return reply.status(404).send({ error: `Processo CNJ ${numero_cnj} não está cadastrado no sistema Donna.` });
      }

      // 2. Gravar a movimentação na fila de processamento ('pendente')
      const { data: novaMovimentacao, error: movError } = await supabase
        .from('movimentacoes')
        .insert({
          processo_id: processo.id,
          data_evento: data_evento || new Date().toISOString(),
          titulo: titulo,
          descricao: descricao || '',
          tipo_evento: 'Ingestão Assíncrona',
          grau_relevancia: 'media',
          raw_payload: raw_payload || request.body,
          status_processamento: 'pendente',
          processado: false
        })
        .select('id')
        .single();

      if (movError) throw movError;

      // 3. Retornar resposta instantânea
      return reply.status(202).send({
        status: 'sucesso',
        mensagem: 'Movimentação recebida e agendada para análise estratégica em segundo plano.',
        movimentacao_id: novaMovimentacao.id
      });

    } catch (error) {
      fastify.log.error(`Erro no webhook de movimentação: ${error.message}`);
      return reply.status(500).send({ error: 'Erro interno ao processar webhook.', detalhes: error.message });
    }
  });

  /**
   * WEBHOOK: Ingestão de Publicações em Lote do Diário Oficial
   * Filtra publicações da carteira, agenda como 'pendente' e retorna 202 Accepted em milissegundos.
   */
  fastify.post('/webhooks/diario', async (request, reply) => {
    if (!verificarToken(request, reply)) return;

    const { publicacoes } = request.body; // Deve ser um array de publicações brutos

    if (!publicacoes || !Array.isArray(publicacoes)) {
      return reply.status(400).send({ error: 'O corpo da requisição deve conter um array "publicacoes".' });
    }

    try {
      fastify.log.info(`Recebido webhook de Diário Oficial contendo ${publicacoes.length} publicações.`);

      // 1. Carregar processos cadastrados e advogados com OAB ativa
      const { data: processosCadastrados } = await supabase
        .from('processos')
        .select('id, numero_cnj');

      const { data: advogados } = await supabase
        .from('usuarios')
        .select('id, oab')
        .not('oab', 'is', null);

      const publicacoesValidas = [];

      // 2. Filtrar apenas publicações que digam respeito a nossa carteira (CNJ ou OAB)
      for (const pub of publicacoes) {
        if (!pub.corpo) continue;

        const corpoFormatado = pub.corpo.replace(/\s+/g, ' ');
        let processoIdVinculado = null;
        let termoCasado = null;
        let responsavelEncontrado = false;

        // A. Verificar CNJ
        const numerosCnjEncontrados = corpoFormatado.match(REGEX_CNJ) || [];
        const numerosCnjLimpos = numerosCnjEncontrados.map(n => n.replace(/\D/g, ''));

        const processoEncontrado = processosCadastrados?.find(p => {
          const cnjLimpoBanco = p.numero_cnj.replace(/\D/g, '');
          return numerosCnjLimpos.includes(cnjLimpoBanco);
        });

        if (processoEncontrado) {
          processoIdVinculado = processoEncontrado.id;
          termoCasado = processoEncontrado.numero_cnj;
          responsavelEncontrado = true;
        } else {
          // B. Verificar OAB
          const oabsEncontradas = corpoFormatado.match(REGEX_OAB) || [];
          const advEncontrado = advogados?.find(a => {
            const oabLimpaBanco = a.oab.replace(/\D/g, '');
            return oabsEncontradas.some(o => o.replace(/\D/g, '').includes(oabLimpaBanco));
          });

          if (advEncontrado) {
            termoCasado = advEncontrado.oab;
            responsavelEncontrado = true;
          }
        }

        // Se houver vinculação com CNJ ou OAB do escritório, enfileira
        if (responsavelEncontrado) {
          publicacoesValidas.push({
            processo_id: processoIdVinculado,
            termo_busca: termoCasado,
            data_disponibilizacao: pub.data_disponibilizacao || new Date().toISOString().split('T')[0],
            data_publicacao: pub.data_publicacao || pub.data_disponibilizacao || new Date().toISOString().split('T')[0],
            titulo: pub.titulo || 'Publicação de Diário Oficial Identificada',
            trecho: pub.trecho || pub.corpo.substring(0, 300) + '...',
            corpo: pub.corpo,
            tipo: 'Andamento Informativo',
            url_original: pub.url_original || null,
            status_processamento: 'pendente',
            processado: false
          });
        }
      }

      let inseridos = [];

      // 3. Realizar inserção em lote (bulk insert) das válidas para máxima performance
      if (publicacoesValidas.length > 0) {
        const { data, error } = await supabase
          .from('publicacoes_diario')
          .insert(publicacoesValidas)
          .select('id');

        if (error) throw error;
        inseridos = data || [];
      }

      return reply.status(202).send({
        status: 'sucesso',
        total_recebido: publicacoes.length,
        total_carteira_identificada: publicacoesValidas.length,
        mensagem: `${publicacoesValidas.length} publicações enfileiradas para processamento assíncrono.`,
        ids_agendados: inseridos.map(i => i.id)
      });

    } catch (error) {
      fastify.log.error(`Erro no webhook de diário: ${error.message}`);
      return reply.status(500).send({ error: 'Erro interno ao processar publicações.', detalhes: error.message });
    }
  });
}
