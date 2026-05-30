import { supabase } from '../config/supabase.js';
import { calcularPrazoProcessual } from '../services/deadlineService.js';

/**
 * ROTAS DE PRAZOS E CALENDÁRIO — Donna API
 * Operações de gerenciamento de prazos processuais e alimentação do calendário forense.
 */

export default async function prazoRoutes(fastify, options) {
  
  /**
   * GET: Listar prazos monitorados
   * Permite filtros por status, advogado responsável e ordenação por vencimento.
   */
  fastify.get('/prazos', async (request, reply) => {
    const { status, responsavel_id } = request.query;

    try {
      let query = supabase
        .from('prazos')
        .select(`
          *,
          processos (numero_cnj, tribunal, comarca, vara),
          usuarios (nome)
        `);

      if (status) {
        query = query.eq('status', status);
      }
      
      if (responsavel_id) {
        query = query.eq('responsavel_id', responsavel_id);
      }

      const { data, error } = await query.order('data_vencimento', { ascending: true });

      if (error) throw error;
      return reply.send(data);
    } catch (error) {
      console.error('Erro ao buscar prazos:', error.message);
      return reply.status(500).send({ error: 'Erro ao buscar prazos.', detalhes: error.message });
    }
  });

  /**
   * POST: Simular/Calcular prazo processual na hora
   * Útil para validações de advogados em tempo real na interface
   */
  fastify.post('/prazos/calcular', async (request, reply) => {
    const { processo_id, data_disponibilizacao, prazo_dias } = request.body;

    if (!processo_id || !data_disponibilizacao || !prazo_dias) {
      return reply.status(400).send({ 
        error: 'Os campos "processo_id", "data_disponibilizacao" e "prazo_dias" são obrigatórios.' 
      });
    }

    try {
      console.log(`Simulando prazo de ${prazo_dias} dias para processo ${processo_id} a partir de D0 = ${data_disponibilizacao}...`);
      
      const resultado = await calcularPrazoProcessual({
        processoId: processo_id,
        dataDisponibilizacao: data_disponibilizacao,
        prazoDias: parseInt(prazo_dias, 10)
      });

      return reply.send(resultado);
    } catch (error) {
      console.error('Erro ao calcular prazo simulado:', error.message);
      return reply.status(500).send({ error: 'Erro no cálculo do prazo.', detalhes: error.message });
    }
  });

  /**
   * POST: Marcar prazo como cumprido (baixa no sistema)
   */
  fastify.post('/prazos/:id/cumprir', async (request, reply) => {
    const { id } = request.params;
    const { observacoes_cumprimento } = request.body || {};

    try {
      // 1. Dar baixa no prazo
      const { data: prazo, error: prazoErr } = await supabase
        .from('prazos')
        .update({ 
          status: 'cumprido',
          observacoes: observacoes_cumprimento 
            ? `Cumprido: ${observacoes_cumprimento}` 
            : 'Marcado como cumprido via painel Donna.'
        })
        .eq('id', id)
        .select('id, processo_id')
        .single();

      if (prazoErr || !prazo) {
        return reply.status(404).send({ error: 'Prazo processual não localizado.' });
      }

      // 2. Localizar tarefas atreladas e dar baixa também
      const { error: tarefaErr } = await supabase
        .from('tarefas')
        .update({ 
          status: 'concluida',
          concluida_em: new Date().toISOString()
        })
        .eq('prazo_id', id);

      if (tarefaErr) {
        console.error('Aviso: erro ao concluir tarefas associadas ao prazo:', tarefaErr.message);
      }

      return reply.send({ status: 'sucesso', mensagem: 'Prazo e tarefas associadas foram dados como cumpridos com sucesso!' });
    } catch (error) {
      console.error('Erro ao dar baixa em prazo:', error.message);
      return reply.status(500).send({ error: 'Erro ao concluir prazo.', detalhes: error.message });
    }
  });

  /**
   * POST: Alimentar calendário forense (Cadastrar Feriados / Suspensões)
   */
  fastify.post('/feriados', async (request, reply) => {
    const { data, descricao, tribunal, abrangencia, municipio, vara_especifica, fonte, tipo } = request.body;

    if (!data || !descricao || !abrangencia) {
      return reply.status(400).send({ error: 'Os campos "data", "descricao" e "abrangencia" são obrigatórios.' });
    }

    try {
      const { data: novoFeriado, error } = await supabase
        .from('feriados_forense')
        .insert({
          data,
          descricao,
          tribunal: tribunal || 'nacional',
          abrangencia,
          municipio: municipio || null,
          vara_especifica: vara_especifica || null,
          fonte: fonte || null,
          tipo: tipo || 'feriado'
        })
        .select('*')
        .single();

      if (error) throw error;
      return reply.status(21).send(novoFeriado);
    } catch (error) {
      console.error('Erro ao registrar feriado forense:', error.message);
      return reply.status(500).send({ error: 'Erro ao salvar feriado.', detalhes: error.message });
    }
  });
}
