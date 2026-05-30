import { supabase } from '../config/supabase.js';
import { calcularPrazoProcessual } from '../services/deadlineService.js';
import { analisarAndamentoEstrategico } from '../services/donnaService.js';
import { dispararAlerta } from '../services/notificationService.js';
import { extrairPrazoDoTexto } from '../services/diarioService.js';

/**
 * WORKER DE SEGUNDO PLANO (Docket Worker) — Donna Core
 * Processa movimentações e publicações de diários oficiais assincronamente da fila.
 */

const REGEX_CNJ = /\b\d{7}[-.\s]?\d{2}[-.\s]?\d{4}[-.\s]?\d[-.\s]?\d{2}[-.\s]?\d{4}\b/g;
const REGEX_OAB = /\b(OAB)[-.\s]?(?:[A-Z]{2})[-.\s]?\b\d{2,6}\b/gi;

// Função auxiliar para classificar relevância do andamento
function classificarRelevanciaAndamento(titulo, descricao) {
  const texto = `${titulo} ${descricao}`.toLowerCase();
  
  if (
    texto.includes('sentença') || 
    texto.includes('decisão') || 
    texto.includes('acórdão') || 
    texto.includes('liminar') || 
    texto.includes('bloqueio') || 
    texto.includes('penhora') || 
    texto.includes('arresto') || 
    texto.includes('tutela')
  ) {
    return 'urgente';
  }
  
  if (texto.includes('audiência') || texto.includes('designada')) {
    return 'alta';
  }
  
  if (
    texto.includes('juntada') || 
    texto.includes('petição') || 
    texto.includes('conclusos')
  ) {
    return 'media';
  }
  
  return 'baixa';
}

/**
 * Processa uma única movimentação processual reservada
 */
async function processarMovimentacao(mov) {
  console.log(`[Worker] Processando Movimentação ID: ${mov.id} do Processo ID: ${mov.processo_id}`);
  
  try {
    // 1. Localizar processo para obter o advogado responsável
    const { data: processo, error: procError } = await supabase
      .from('processos')
      .select('id, advogado_responsavel_id, numero_cnj')
      .eq('id', mov.processo_id)
      .single();

    if (procError || !processo) {
      throw new Error(`Processo associado não encontrado: ${procError?.message || 'Sem dados'}`);
    }

    const relevância = classificarRelevanciaAndamento(mov.titulo, mov.descricao || '');
    
    // Atualizar relevância e tipo de evento no registro
    await supabase
      .from('movimentacoes')
      .update({
        tipo_evento: relevância === 'urgente' ? 'Decisão/Urgente' : 'Andamento Rotina',
        grau_relevancia: relevância
      })
      .eq('id', mov.id);

    let prazoCalculado = null;
    let prazoSalvo = null;

    // 2. Tentar detectar prazo na descrição ou título
    const analisePrazo = extrairPrazoDoTexto(mov.descricao || mov.titulo);
    if (analisePrazo && processo.advogado_responsavel_id) {
      console.log(`[Worker] Prazo detectado na movimentação: ${analisePrazo.tipo} (${analisePrazo.dias} dias).`);
      
      const dataRef = mov.data_evento ? mov.data_evento.split('T')[0] : new Date().toISOString().split('T')[0];
      
      // Chamar motor de prazos determinístico
      const calculo = await calcularPrazoProcessual({
        processoId: processo.id,
        dataDisponibilizacao: dataRef,
        prazoDias: analisePrazo.dias
      });

      prazoCalculado = calculo;

      // Salvar no banco
      const { data: pz, error: pzErr } = await supabase
        .from('prazos')
        .insert({
          processo_id: processo.id,
          movimentacao_id: mov.id,
          descricao: `Prazo de ${analisePrazo.tipo} originado por movimentação judicial`,
          tipo_prazo: analisePrazo.tipo,
          data_publicacao: calculo.data_publicacao,
          data_inicio_contagem: calculo.data_inicio_contagem,
          prazo_dias: analisePrazo.dias,
          data_vencimento: calculo.data_vencimento,
          status: 'aberto',
          responsavel_id: processo.advogado_responsavel_id,
          observacoes: calculo.observacoes_calculo
        })
        .select('*')
        .single();

      if (pzErr) throw pzErr;
      prazoSalvo = pz;
    }

    // 3. Executar raciocínio tático estratégico se for urgente/alta relevância ou se abriu prazo
    let analiseDonna = '';
    if (relevância === 'urgente' || relevância === 'alta' || prazoSalvo) {
      console.log(`[Worker] Iniciando análise cognitiva da Donna (Claude)...`);
      analiseDonna = await analisarAndamentoEstrategico({
        processoId: processo.id,
        movimentacaoId: mov.id,
        tituloAndamento: mov.titulo,
        descricaoAndamento: mov.descricao || '',
        prazoCalculado: prazoCalculado
      });

      // Gravar tarefa tática sugerida
      await supabase
        .from('tarefas')
        .insert({
          processo_id: processo.id,
          prazo_id: prazoSalvo?.id || null,
          titulo: `Cumprir: ${mov.titulo.substring(0, 50)}`,
          descricao: `Ação operacional sugerida pela Donna para o andamento: ${mov.titulo}`,
          prioridade: relevância,
          status: 'pendente',
          responsavel_id: processo.advogado_responsavel_id,
          sugerida_por_ia: true,
          justificativa_ia: analiseDonna,
          data_vencimento: prazoSalvo?.data_vencimento ? `${prazoSalvo.data_vencimento}T18:00:00.000Z` : null
        });

      // Disparar alertas assincronamente (WhatsApp + E-mail)
      if (processo.advogado_responsavel_id) {
        console.log(`[Worker] Disparando notificações WhatsApp e E-mail...`);
        await dispararAlerta({
          usuarioId: processo.advogado_responsavel_id,
          processoId: processo.id,
          prazoId: prazoSalvo?.id || null,
          canal: 'ambos',
          titulo: `🚨 ALERTA ESTRATÉGICO: ${mov.titulo.substring(0, 40)}`,
          mensagem: `Detectamos uma movimentação de relevância *${relevância.toUpperCase()}* no processo ${processo.numero_cnj}.\n\n${analiseDonna}`
        });
      }
    }

    // 4. Concluir com sucesso
    await supabase
      .from('movimentacoes')
      .update({
        status_processamento: 'processado',
        processado: true,
        log_erro: null
      })
      .eq('id', mov.id);

    console.log(`[Worker] Movimentação ${mov.id} processada com sucesso.`);
  } catch (error) {
    console.error(`[Worker] Erro ao processar movimentação ${mov.id}:`, error.message);
    
    // Obter tentativas atuais
    const { data: currentMov } = await supabase
      .from('movimentacoes')
      .select('tentativas')
      .eq('id', mov.id)
      .single();

    const tentativas = currentMov?.tentativas || 1;
    
    if (tentativas < 3) {
      // Re-enfileirar para nova tentativa com status pendente
      await supabase
        .from('movimentacoes')
        .update({
          status_processamento: 'pendente',
          log_erro: error.message
        })
        .eq('id', mov.id);
    } else {
      // Marcar definitivamente como falha
      await supabase
        .from('movimentacoes')
        .update({
          status_processamento: 'falha',
          log_erro: `Esgotado limite de 3 tentativas. Erro final: ${error.message}`
        })
        .eq('id', mov.id);
    }
  }
}

/**
 * Processa uma única publicação de diário oficial reservada
 */
async function processarDiario(pub) {
  console.log(`[Worker] Processando Publicação Diário ID: ${pub.id}`);
  
  try {
    // 1. Resolver processoId e responsavelId se ainda não vinculados
    let processoIdVinculado = pub.processo_id;
    let responsavelIdVinculado = null;
    let termoCasado = pub.termo_busca;

    const corpoFormatado = pub.corpo.replace(/\s+/g, ' ');

    // Carregar dados de monitoramento se necessário
    const { data: processosCadastrados } = await supabase
      .from('processos')
      .select('id, numero_cnj, advogado_responsavel_id');

    const { data: advogados } = await supabase
      .from('usuarios')
      .select('id, nome, oab')
      .not('oab', 'is', null);

    if (processoIdVinculado) {
      const proc = processosCadastrados?.find(p => p.id === processoIdVinculado);
      if (proc) responsavelIdVinculado = proc.advogado_responsavel_id;
    } else {
      // Tentar casar por CNJ no texto
      const numerosCnjEncontrados = corpoFormatado.match(REGEX_CNJ) || [];
      const numerosCnjLimpos = numerosCnjEncontrados.map(n => n.replace(/\D/g, ''));

      const processoEncontrado = processosCadastrados?.find(p => {
        const cnjLimpoBanco = p.numero_cnj.replace(/\D/g, '');
        return numerosCnjLimpos.includes(cnjLimpoBanco);
      });

      if (processoEncontrado) {
        processoIdVinculado = processoEncontrado.id;
        responsavelIdVinculado = processoEncontrado.advogado_responsavel_id;
        termoCasado = processoEncontrado.numero_cnj;
      } else {
        // Tentar casar por OAB
        const oabsEncontradas = corpoFormatado.match(REGEX_OAB) || [];
        const advEncontrado = advogados?.find(a => {
          const oabLimpaBanco = a.oab.replace(/\D/g, '');
          return oabsEncontradas.some(o => o.replace(/\D/g, '').includes(oabLimpaBanco));
        });

        if (advEncontrado) {
          responsavelIdVinculado = advEncontrado.id;
          termoCasado = advEncontrado.oab;
        }
      }
    }

    // Se a publicação não possui vinculação com nossa carteira jurídica, ignoramos de forma limpa
    if (!processoIdVinculado && !responsavelIdVinculado) {
      console.log(`[Worker] Publicação ${pub.id} sem vinculação com carteira ou OABs ativas. Ignorando...`);
      await supabase
        .from('publicacoes_diario')
        .update({
          status_processamento: 'processado',
          processado: true,
          log_erro: 'Sem vinculação identificada com carteira/OABs'
        })
        .eq('id', pub.id);
      return;
    }

    // 2. Extrair e computar prazo se houver processo e responsável
    const analisePrazo = extrairPrazoDoTexto(pub.corpo);
    let prazoSalvo = null;
    let calculoPrazo = null;

    if (processoIdVinculado && analisePrazo && responsavelIdVinculado) {
      console.log(`[Worker] Prazo de ${analisePrazo.dias} dias identificado no diário.`);
      
      calculoPrazo = await calcularPrazoProcessual({
        processoId: processoIdVinculado,
        dataDisponibilizacao: pub.data_disponibilizacao,
        prazoDias: analisePrazo.dias
      });

      // Gravar prazo aberto
      const { data: pz, error: prazoError } = await supabase
        .from('prazos')
        .insert({
          processo_id: processoIdVinculado,
          publicacao_id: pub.id,
          descricao: `Prazo de ${analisePrazo.tipo} decorrente de publicação no DJe/DJEN`,
          tipo_prazo: analisePrazo.tipo,
          data_publicacao: calculoPrazo.data_publicacao,
          data_inicio_contagem: calculoPrazo.data_inicio_contagem,
          prazo_dias: analisePrazo.dias,
          data_vencimento: calculoPrazo.data_vencimento,
          status: 'aberto',
          responsavel_id: responsavelIdVinculado,
          observacoes: calculoPrazo.observacoes_calculo
        })
        .select('*')
        .single();

      if (prazoError) throw prazoError;
      prazoSalvo = pz;
    }

    // Atualizar publicação com os dados vinculados e datas corretas calculadas
    const updatePayload = {
      status_processamento: 'processado',
      processado: true,
      processo_id: processoIdVinculado,
      termo_busca: termoCasado,
      tipo: analisePrazo?.tipo || 'Andamento Informativo',
      prazo_identificado: analisePrazo?.dias || null,
      log_erro: null
    };

    if (calculoPrazo) {
      updatePayload.data_publicacao = calculoPrazo.data_publicacao;
      updatePayload.data_inicio_prazo = calculoPrazo.data_inicio_contagem;
    }

    await supabase
      .from('publicacoes_diario')
      .update(updatePayload)
      .eq('id', pub.id);

    // 3. Disparar notificações de novo prazo se cadastrado
    if (prazoSalvo && responsavelIdVinculado && calculoPrazo) {
      const proc = processosCadastrados?.find(p => p.id === processoIdVinculado);
      const mensagemWhats = `Um novo prazo de *${analisePrazo.tipo}* (${analisePrazo.dias} dias úteis) foi aberto automaticamente para você!\n\n• *Processo*: ${proc?.numero_cnj || 'Monitorado'}\n• *Publicação*: ${calculoPrazo.data_publicacao}\n• *Início Contagem*: ${calculoPrazo.data_inicio_contagem}\n• *Vencimento*: *${calculoPrazo.data_vencimento}*\n\n_Donna analisou o teor e já organizou sua agenda forense. Revise o despacho no painel!_`;

      console.log(`[Worker] Disparando notificações de novo prazo do diário...`);
      await dispararAlerta({
        usuarioId: responsavelIdVinculado,
        processoId: processoIdVinculado,
        prazoId: prazoSalvo.id,
        canal: 'ambos',
        titulo: `Prazo Aberto: ${analisePrazo.tipo}`,
        mensagem: mensagemWhats
      });
    }

    console.log(`[Worker] Publicação de Diário ${pub.id} processada com sucesso.`);
  } catch (error) {
    console.error(`[Worker] Erro ao processar diário ${pub.id}:`, error.message);
    
    // Obter tentativas atuais
    const { data: currentPub } = await supabase
      .from('publicacoes_diario')
      .select('tentativas')
      .eq('id', pub.id)
      .single();

    const tentativas = currentPub?.tentativas || 1;
    
    if (tentativas < 3) {
      await supabase
        .from('publicacoes_diario')
        .update({
          status_processamento: 'pendente',
          log_erro: error.message
        })
        .eq('id', pub.id);
    } else {
      await supabase
        .from('publicacoes_diario')
        .update({
          status_processamento: 'falha',
          log_erro: `Esgotado limite de 3 tentativas. Erro final: ${error.message}`
        })
        .eq('id', pub.id);
    }
  }
}

/**
 * Loop principal do Worker
 */
export async function iniciarWorker() {
  console.log('🤖 Fila de Workers assíncronos da Donna inicializada com sucesso.');
  
  const tick = async () => {
    try {
      // 1. Buscar e processar uma movimentação pendente
      const { data: movs, error: movErr } = await supabase.rpc('obter_e_reservar_movimentacao');
      
      if (movErr) {
        console.error('[Worker] Erro ao obter movimentação da fila:', movErr.message);
      } else if (movs && movs.length > 0) {
        await processarMovimentacao(movs[0]);
        // Se processou um item, agendar imediatamente sem esperar para esvaziar a fila mais rápido
        setTimeout(tick, 100);
        return;
      }

      // 2. Buscar e processar uma publicação de diário pendente
      const { data: pubs, error: pubErr } = await supabase.rpc('obter_e_reservar_diario');
      
      if (pubErr) {
        console.error('[Worker] Erro ao obter publicação do diário da fila:', pubErr.message);
      } else if (pubs && pubs.length > 0) {
        await processarDiario(pubs[0]);
        // Se processou um item, agendar imediatamente sem esperar
        setTimeout(tick, 100);
        return;
      }
      
    } catch (err) {
      console.error('[Worker] Erro inesperado no tick do worker:', err.message);
    }

    // Se a fila estava vazia, dorme por 5 segundos antes de re-verificar
    setTimeout(tick, 5000);
  };

  // Disparar o tick recursivo inicial
  tick();
}
