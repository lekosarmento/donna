import { addDays, isSaturday, isSunday, format, parseISO, isAfter, isBefore } from 'date-fns';
import { supabase } from '../config/supabase.js';

/**
 * MOTOR DE PRAZOS (Motor 3) — Donna Core
 * Lógica de contagem de prazos processuais de acordo com o CPC/2015 e as regras do CNJ (DJEN e Domicílio).
 */

/**
 * Busca todos os feriados e suspensões forenses salvos no Supabase que podem impactar a contagem.
 * @param {string} tribunal - Sigla do Tribunal (ex: "TJPB", "TJSP")
 * @param {string} comarca - Nome da comarca (opcional)
 * @param {string} vara - Nome da vara específica (opcional)
 * @param {string} dataInicioIso - Data de início do intervalo de busca
 * @param {string} dataFimIso - Data limite projetada de busca
 * @returns {Promise<Set<string>>} Conjunto de datas ("YYYY-MM-DD") correspondentes a feriados/recessos
 */
export async function obterFeriadosEfetivos(tribunal, comarca = null, vara = null, dataInicioIso, dataFimIso) {
  const feriadosSet = new Set();

  try {
    let query = supabase
      .from('feriados_forense')
      .select('data, tribunal, abrangencia, municipio, vara_especifica, tipo')
      .gte('data', dataInicioIso)
      .lte('data', dataFimIso);

    const { data: feriados, error } = await query;

    if (error) throw error;

    for (const f of feriados) {
      const dataStr = f.data; // formato "YYYY-MM-DD"
      
      // Regras de abrangência:
      if (f.abrangencia === 'nacional') {
        feriadosSet.add(dataStr);
        continue;
      }

      if (f.abrangencia === 'estadual' && f.tribunal?.toLowerCase() === tribunal?.toLowerCase()) {
        feriadosSet.add(dataStr);
        continue;
      }

      if (
        f.abrangencia === 'municipal' && 
        f.tribunal?.toLowerCase() === tribunal?.toLowerCase() &&
        comarca && f.municipio?.toLowerCase() === comarca?.toLowerCase()
      ) {
        feriadosSet.add(dataStr);
        continue;
      }

      if (
        f.abrangencia === 'vara_especifica' &&
        f.tribunal?.toLowerCase() === tribunal?.toLowerCase() &&
        comarca && f.municipio?.toLowerCase() === comarca?.toLowerCase() &&
        vara && f.vara_especifica?.toLowerCase() === vara?.toLowerCase()
      ) {
        feriadosSet.add(dataStr);
        continue;
      }
    }
  } catch (error) {
    console.error('Erro ao buscar feriados forenses:', error.message);
  }

  return feriadosSet;
}

/**
 * Verifica se houve indisponibilidade registrada que prorroga o vencimento do prazo.
 * @param {string} tribunal - Tribunal afetado
 * @param {string} dataVencimentoIso - Data em que venceria o prazo ("YYYY-MM-DD")
 * @returns {Promise<boolean>} Retorna true se houver indisponibilidade que prorroga o prazo
 */
export async function verificarIndisponibilidadePJe(tribunal, dataVencimentoIso) {
  try {
    const inicioDia = `${dataVencimentoIso}T03:00:00.000Z`; // 00:00:00 Brasília time
    
    const parts = dataVencimentoIso.split('-');
    const nextDay = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + 1, 12, 0, 0);
    const nextDayStr = format(nextDay, 'yyyy-MM-dd');
    const fimDia = `${nextDayStr}T02:59:59.999Z`; // 23:59:59.999 Brasília time

    const { data: eventos, error } = await supabase
      .from('eventos_operacionais')
      .select('id, tipo, data_inicio, data_fim, impacto_prazos')
      .eq('tipo', 'indisponibilidade_sistema')
      .eq('tribunal', tribunal)
      .eq('impacto_prazos', true)
      .or(`data_inicio.lte.${fimDia},data_fim.gte.${inicioDia}`);

    if (error) throw error;

    return eventos && eventos.length > 0;
  } catch (error) {
    console.error('Erro ao verificar indisponibilidade do PJe:', error.message);
    return false;
  }
}

/**
 * Retorna o próximo dia útil a partir de uma data fornecida, levando em conta finais de semana e feriados.
 * @param {Date} data - Data inicial
 * @param {Set<string>} feriadosSet - Set com datas de feriados ("YYYY-MM-DD")
 * @returns {Date} Próximo dia útil
 */
export function proximoDiaUtil(data, feriadosSet) {
  let tempDate = addDays(data, 1);
  tempDate.setHours(12, 0, 0, 0); // Garante meio-dia constante para eliminar timezone drift
  
  while (true) {
    const dataStr = format(tempDate, 'yyyy-MM-dd');
    const eFimDeSemana = isSaturday(tempDate) || isSunday(tempDate);
    const eFeriado = feriadosSet.has(dataStr);

    if (!eFimDeSemana && !eFeriado) {
      break;
    }
    
    tempDate = addDays(tempDate, 1);
    tempDate.setHours(12, 0, 0, 0);
  }
  
  return tempDate;
}

/**
 * Calcula o vencimento de um prazo processual utilizando a matriz de regras do CPC/15 e Domicílio Eletrônico (Res. 455/22).
 * 
 * @param {Object} params
 * @param {string} params.processoId - ID do processo no banco de dados
 * @param {string} params.dataReferencia - Data base de disponibilização ou envio ("YYYY-MM-DD")
 * @param {number} params.prazoDias - Prazo processual (em dias)
 * @param {string} params.canalPublicacao - Canal ('djen', 'domicilio', 'outro')
 * @param {string} params.tipoComunicacao - Tipo ('citacao', 'intimacao', 'outra_comunicacao')
 * @param {string} params.statusConfirmacao - Status ('confirmado', 'nao_confirmado', 'nao_aplicavel')
 * @param {string} params.naturezaDestinatario - Destinatário ('pj_privado', 'pj_publico', 'pf', 'nao_aplicavel')
 * @returns {Promise<Object>} Objeto com cálculo detalhado e trilha de auditoria
 */
export async function calcularPrazoProcessual({
  processoId,
  dataReferencia,
  prazoDias,
  canalPublicacao = 'djen',
  tipoComunicacao = 'intimacao',
  statusConfirmacao = 'nao_aplicavel',
  naturezaDestinatario = 'nao_aplicavel'
}) {
  // 1. Buscar metadados do processo
  const { data: processo, error: procError } = await supabase
    .from('processos')
    .select('tribunal, comarca, vara')
    .eq('id', processoId)
    .single();

  if (procError || !processo) {
    throw new Error(`Processo não encontrado ou erro de conexão: ${procError?.message}`);
  }

  const { tribunal, comarca, vara } = processo;
  
  // Converter data de referência ajustando para meio-dia (12:00:00) para eliminar timezone drift
  const parts = dataReferencia.split('-');
  const baseDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
  
  // Projetar feriados
  const projecaoDias = Math.max(prazoDias * 3 + 30, 90);
  const dataFimProjetada = format(addDays(baseDate, projecaoDias), 'yyyy-MM-dd');
  
  const feriadosSet = await obterFeriadosEfetivos(
    tribunal, 
    comarca, 
    vara, 
    dataReferencia, 
    dataFimProjetada
  );

  const auditLogs = [];
  let d0Date, d1Date, d2Date;
  let statusCalculo = 'ativo';
  let alertaCritico = null;

  // Injetar log da data de recebimento inicial
  auditLogs.push({
    etapa: 'recebimento',
    descricao: `Recebimento da comunicação via canal "${canalPublicacao}" (${tipoComunicacao}).`,
    valor_base: dataReferencia,
    valor_resultado: dataReferencia,
    fonte_regra: 'Resolução CNJ 455/2022'
  });

  // =========================================================================
  // EXECUÇÃO DAS MATRIZES DE REGRAS JURÍDICAS
  // =========================================================================

  if (canalPublicacao === 'djen') {
    // ----------------------------------------------------
    // REGIME 1: DJEN
    // ----------------------------------------------------
    d0Date = baseDate;
    
    // D1 (Publicação) = 1º dia útil após Disponibilização
    d1Date = proximoDiaUtil(d0Date, feriadosSet);
    const d1Str = format(d1Date, 'yyyy-MM-dd');
    auditLogs.push({
      etapa: 'publicacao',
      descricao: 'Data da publicação oficial calculada (1º dia útil seguinte à disponibilização no DJEN).',
      valor_base: dataReferencia,
      valor_resultado: d1Str,
      fonte_regra: 'CPC/15 Art. 224, §1º / Regras DJEN 2025'
    });

    // D2 (Início da Contagem) = 1º dia útil após Publicação
    d2Date = proximoDiaUtil(d1Date, feriadosSet);
    const d2Str = format(d2Date, 'yyyy-MM-dd');
    auditLogs.push({
      etapa: 'inicio_contagem',
      descricao: 'Início efetivo do prazo processual (1º dia útil após a data de publicação).',
      valor_base: d1Str,
      valor_resultado: d2Str,
      fonte_regra: 'CPC/15 Art. 224, §2º'
    });

  } else if (canalPublicacao === 'domicilio') {
    // ----------------------------------------------------
    // REGIME 2: DOMICÍLIO JUDICIAL ELETRÔNICO
    // ----------------------------------------------------
    
    if (tipoComunicacao === 'citacao') {
      // 2.1 CITAÇÕES ELETRÔNICAS
      if (statusConfirmacao === 'confirmado') {
        // Citação Confirmada dentro dos 3 dias úteis
        d0Date = baseDate;
        
        // Regra CPC Art. 231, IX: Prazo inicia-se no 5º dia útil seguinte à confirmação.
        let tempDate = d0Date;
        for (let i = 0; i < 5; i++) {
          tempDate = proximoDiaUtil(tempDate, feriadosSet);
        }
        d2Date = tempDate;
        const d2Str = format(d2Date, 'yyyy-MM-dd');
        
        auditLogs.push({
          etapa: 'confirmacao',
          descricao: 'Citação eletrônica confirmada ativamente no Domicílio.',
          valor_base: dataReferencia,
          valor_resultado: dataReferencia,
          fonte_regra: 'Art. 246, §1º-A do CPC'
        });
        
        auditLogs.push({
          etapa: 'inicio_contagem',
          descricao: 'Início da contagem no 5º dia útil após confirmação.',
          valor_base: dataReferencia,
          valor_resultado: d2Str,
          fonte_regra: 'Art. 231, IX do CPC / Res. CNJ 455/2022'
        });
        
      } else {
        // Citação NÃO Confirmada
        if (naturezaDestinatario === 'pj_privado') {
          // PJ PRIVADO: PRAZO NÃO INICIA AUTOMATICAMENTE!
          statusCalculo = 'bloqueado';
          alertaCritico = `Atenção Crítica: Citação não confirmada no Domicílio Eletrônico pela Pessoa Jurídica Privada. O prazo não se inicia automaticamente. O tribunal expedirá citação física convencional (oficial de justiça ou correios), e o escritório deverá justificar a inércia na primeira oportunidade sob pena de multa de até 5% sobre o valor da causa por ato atentatório à dignidade da justiça (Art. 246, §1º-C do CPC).`;
          
          auditLogs.push({
            etapa: 'bloqueado',
            descricao: 'Citação eletrônica não confirmada por PJ Privada. Contagem automática suspensa.',
            valor_base: dataReferencia,
            valor_resultado: null,
            fonte_regra: 'Art. 246, §1º-B e §1º-C do CPC'
          });
          
          return {
            processo_id: processoId,
            tribunal,
            comarca,
            vara,
            data_referencia: dataReferencia,
            prazo_dias: prazoDias,
            data_vencimento: null,
            status: 'suspenso',
            prorrogado: false,
            observacoes_calculo: alertaCritico,
            auditLogs,
            alerta_critico: alertaCritico
          };
          
        } else {
          // PJ PÚBLICA ou PF (Citação não confirmada)
          // Intimação/leitura presumida após 10 dias corridos do envio
          d0Date = addDays(baseDate, 10);
          d0Date.setHours(12, 0, 0, 0);
          
          // D1 = próximo dia útil após leitura ficta
          const d1DateReal = proximoDiaUtil(d0Date, feriadosSet);
          const d1Str = format(d1DateReal, 'yyyy-MM-dd');
          
          auditLogs.push({
            etapa: 'leitura_presumida',
            descricao: 'Citação presumida/tácita automática gerada após 10 dias corridos de inércia do destinatário.',
            valor_base: dataReferencia,
            valor_resultado: d1Str,
            fonte_regra: 'Lei 11.419/06 Art. 5º, §3º / Res. CNJ 455/22'
          });

          d2Date = proximoDiaUtil(d1DateReal, feriadosSet);
          const d2Str = format(d2Date, 'yyyy-MM-dd');
          
          auditLogs.push({
            etapa: 'inicio_contagem',
            descricao: 'Início do prazo processual (1º dia útil subsequente à citação presumida).',
            valor_base: d1Str,
            valor_resultado: d2Str,
            fonte_regra: 'CPC/15 Art. 224, §2º'
          });
        }
      }
      
    } else {
      // 2.2 INTIMAÇÕES E OUTRAS COMUNICAÇÕES
      if (statusConfirmacao === 'confirmado') {
        // Intimação Confirmada
        d0Date = baseDate;
        d2Date = proximoDiaUtil(d0Date, feriadosSet);
        const d2Str = format(d2Date, 'yyyy-MM-dd');
        
        auditLogs.push({
          etapa: 'confirmacao',
          descricao: 'Intimação confirmada ativamente no Domicílio Eletrônico.',
          valor_base: dataReferencia,
          valor_resultado: dataReferencia,
          fonte_regra: 'Resolução CNJ 455/2022'
        });
        
        auditLogs.push({
          etapa: 'inicio_contagem',
          descricao: 'Início do prazo processual (1º dia útil subsequente à confirmação).',
          valor_base: dataReferencia,
          valor_resultado: d2Str,
          fonte_regra: 'CPC/15 Art. 224, §2º'
        });
        
      } else {
        // Intimação NÃO Confirmada -> Regra tácita de 10 dias corridos
        d0Date = addDays(baseDate, 10);
        d0Date.setHours(12, 0, 0, 0);
        
        const d1DateReal = proximoDiaUtil(d0Date, feriadosSet);
        const d1Str = format(d1DateReal, 'yyyy-MM-dd');
        
        auditLogs.push({
          etapa: 'leitura_presumida',
          descricao: 'Intimação presumida/tácita automática gerada após 10 dias corridos de inércia.',
          valor_base: dataReferencia,
          valor_resultado: d1Str,
          fonte_regra: 'Lei 11.419/06 Art. 5º, §3º / Res. CNJ 455/2022'
        });

        d2Date = proximoDiaUtil(d1DateReal, feriadosSet);
        const d2Str = format(d2Date, 'yyyy-MM-dd');
        
        auditLogs.push({
          etapa: 'inicio_contagem',
          descricao: 'Início do prazo processual (1º dia útil subsequente à leitura ficta).',
          valor_base: d1Str,
          valor_resultado: d2Str,
          fonte_regra: 'CPC/15 Art. 224, §2º'
        });
      }
    }

  } else {
    // ----------------------------------------------------
    // REGIME 3: OUTROS / INTIMAÇÃO PESSOAL PJe
    // ----------------------------------------------------
    d0Date = baseDate;
    d2Date = proximoDiaUtil(d0Date, feriadosSet);
    const d2Str = format(d2Date, 'yyyy-MM-dd');
    
    auditLogs.push({
      etapa: 'leitura_sistema',
      descricao: 'Comunicação pessoal lida no portal eletrônico do PJe.',
      valor_base: dataReferencia,
      valor_resultado: dataReferencia,
      fonte_regra: 'Art. 5º da Lei 11.419/06'
    });
    
    auditLogs.push({
      etapa: 'inicio_contagem',
      descricao: 'Início da contagem do prazo (1º dia útil subsequente).',
      valor_base: dataReferencia,
      valor_resultado: d2Str,
      fonte_regra: 'CPC/15 Art. 224, §2º'
    });
  }

  // =========================================================================
  // PROCESSAMENTO DA CONTAGEM EM DIAS ÚTEIS (CPC Art. 219)
  // =========================================================================

  let dataAtual = d2Date;
  let diasContados = 1; // D2 já é o dia útil 1
  
  while (diasContados < prazoDias) {
    dataAtual = proximoDiaUtil(dataAtual, feriadosSet);
    diasContados++;
  }

  let dataVencimentoStr = format(dataAtual, 'yyyy-MM-dd');
  let dataVencimentoFinalDate = dataAtual;
  let prorrogadoPorIndisponibilidade = false;
  let motivoProrrogacao = '';

  // 5. Verificar Indisponibilidade do PJe no dia do Vencimento (Resolução CNJ 455/2022)
  let checarIndisponibilidade = true;
  while (checarIndisponibilidade) {
    const houveIndisponibilidade = await verificarIndisponibilidadePJe(tribunal, dataVencimentoStr);
    
    if (houveIndisponibilidade) {
      prorrogadoPorIndisponibilidade = true;
      const novoVencimento = proximoDiaUtil(dataVencimentoFinalDate, feriadosSet);
      const novoVencimentoStr = format(novoVencimento, 'yyyy-MM-dd');
      
      motivoProrrogacao = `Sistema PJe do tribunal ${tribunal} apresentou indisponibilidade relevante no dia ${dataVencimentoStr} (Resolução CNJ 455/2022). Prazo prorrogado para o próximo dia útil.`;
      
      auditLogs.push({
        etapa: 'suspensao_indisponibilidade',
        descricao: `Prorrogação automática por indisponibilidade sistêmica registrada no tribunal ${tribunal}.`,
        valor_base: dataVencimentoStr,
        valor_resultado: novoVencimentoStr,
        fonte_regra: 'Resolução CNJ 455/2022 (Art. 3º)'
      });
      
      dataVencimentoFinalDate = novoVencimento;
      dataVencimentoStr = novoVencimentoStr;
    } else {
      checarIndisponibilidade = false;
    }
  }

  // Identificar feriados considerados no intervalo
  const feriadosConsiderados = Array.from(feriadosSet).filter(f => {
    const parts = f.split('-');
    const fd = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
    return (isAfter(fd, baseDate) || f === dataReferencia) && (isBefore(fd, dataVencimentoFinalDate) || f === dataVencimentoStr);
  });

  for (const f of feriadosConsiderados) {
    auditLogs.push({
      etapa: 'feriado_ignorado',
      descricao: `Feriado ou suspensão forense detectado e pulado na contagem oficial: "${f}".`,
      valor_base: f,
      valor_resultado: f,
      fonte_regra: 'CPC/15 Art. 219 (Dias úteis)'
    });
  }

  // Adicionar log consolidado final
  auditLogs.push({
    etapa: 'consolidado',
    descricao: `Cálculo final homologado com prazo de ${prazoDias} dias úteis.`,
    valor_base: dataReferencia,
    valor_resultado: dataVencimentoStr,
    fonte_regra: 'CPC/15 Art. 219'
  });

  return {
    processo_id: processoId,
    tribunal,
    comarca,
    vara,
    data_referencia: dataReferencia,
    prazo_dias: prazoDias,
    data_vencimento: dataVencimentoStr,
    status: 'ativo',
    prorrogado: prorrogadoPorIndisponibilidade,
    observacoes_calculo: prorrogadoPorIndisponibilidade 
      ? motivoProrrogacao 
      : 'Cálculo dinâmico baseado na regra do Domicílio Judicial Eletrônico e diretrizes do CNJ.',
    auditLogs,
    alerta_critico: null
  };
}
