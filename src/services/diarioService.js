import { parseISO, format } from 'date-fns';
import { supabase } from '../config/supabase.js';
import { calcularPrazoProcessual } from './deadlineService.js';
import { dispararAlerta } from './notificationService.js';
import { chamarClaude } from './donnaService.js';

/**
 * MOTOR DE DIÁRIO OFICIAL (Motor 2) — Donna Core
 * Realiza a varredura, detecção de termos, parsing de prazos em publicações e automação de cadastros.
 */

// Expressões regulares refinadas para detecção jurídica
const REGEX_CNJ = /\b\d{7}[-.\s]?\d{2}[-.\s]?\d{4}[-.\s]?\d[-.\s]?\d{2}[-.\s]?\d{4}\b/g;
const REGEX_OAB = /\b(OAB)[-.\s]?(?:[A-Z]{2})[-.\s]?\b\d{2,6}\b/gi;

// Dicionário de prazos comuns no CPC
const MAPA_PRAZOS_COMUNS = [
  { padrao: /\bcontesta(?:ção|r)\b/i, dias: 15, nome: 'Contestação' },
  { padrao: /\bapela(?:ção|r)\b/i, dias: 15, nome: 'Apelação' },
  { padrao: /\brecur(?:so|sar) adesivo\b/i, dias: 15, nome: 'Recurso Adesivo' },
  { padrao: /\breplica\b/i, dias: 15, nome: 'Réplica à Contestação' },
  { padrao: /\bimpugna(?:ção|r) à contesta(?:ção)\b/i, dias: 15, nome: 'Impugnação à Contestação' },
  { padrao: /\bembargos de declara(?:ção)\b/i, dias: 5, nome: 'Embargos de Declaração' },
  { padrao: /\bagravo de instrumento\b/i, dias: 15, nome: 'Agravo de Instrumento' },
  { padrao: /\brecurso extraordinario\b/i, dias: 15, nome: 'Recurso Extraordinário' },
  { padrao: /\brecurso especial\b/i, dias: 15, nome: 'Recurso Especial' },
  { padrao: /\bcontra-arrazoar\b/i, dias: 15, nome: 'Contrarrazões Recursais' },
  { padrao: /\bcontrarraz(?:ões|oar)\b/i, dias: 15, nome: 'Contrarrazões' },
  { padrao: /\bespecifica(?:r)? prov(?:as)?\b/i, dias: 5, nome: 'Especificação de Provas' },
  { padrao: /\bmanifestar(?:-se)?\b/i, dias: 15, nome: 'Manifestação Geral' },
  { padrao: /\bemenda(?:r)? a inicial\b/i, dias: 15, nome: 'Emenda à Petição Inicial' },
  { padrao: /\bpagamento\b/i, dias: 15, nome: 'Cumprimento de Sentença (Pagamento)' },
];

/**
 * Tenta inferir se há menção a prazo em dias no texto da publicação.
 * @param {string} texto - Corpo da publicação
 * @returns {Object|null} Objeto com dias e descrição detectados
 */
export function extrairPrazoDoTexto(texto) {
  // 1. Procurar padrões específicos do nosso dicionário
  for (const item of MAPA_PRAZOS_COMUNS) {
    if (item.padrao.test(texto)) {
      // Tentar capturar menção expressa de dias próxima ao termo
      const regexDistancia = new RegExp(`(?:${item.padrao.source}).{1,80}\\b(\\d{1,2})\\s*(?:dias|dias úteis|dias corridos)\\b`, 'i');
      const matchDistancia = texto.match(regexDistancia);
      
      if (matchDistancia) {
        return {
          dias: parseInt(matchDistancia[1], 10),
          tipo: item.nome,
        };
      }
      
      // Se não achar a distância exata, retorna o padrão do CPC
      return {
        dias: item.dias,
        tipo: item.nome,
      };
    }
  }

  // 2. Fallback: procurar menção genérica a prazos em dias (ex: "prazo de 10 dias", "em 15 dias")
  const regexPrazoGenerico = /\b(?:prazo|prazo de|manifestar em|recolher em|cumprir em)\s*(\d{1,2})\s*(?:dias|dias úteis)\b/i;
  const matchGenerico = texto.match(regexPrazoGenerico);
  
  if (matchGenerico) {
    return {
      dias: parseInt(matchGenerico[1], 10),
      tipo: 'Cumprimento de Despacho',
    };
  }

  return null;
}

/**
 * Utiliza o motor cognitivo Google Gemini para classificar e tipificar um prazo a partir de uma publicação judicial.
 * @param {string} texto - Corpo completo da publicação do diário
 * @returns {Promise<Object|null>} Objeto com dias, tipo e justificativa, ou null se não houver prazo.
 */
export async function extrairPrazoComIA(texto) {
  // 1. Filtragem rápida por Regex como crivo de alta velocidade para evitar desperdício de tokens
  const contemIndicativoPrazo = /dias|prazo|contestar|apelar|manifestar|especificar|recurso|embargos|intimado|intimação|notificação/i.test(texto);
  if (!contemIndicativoPrazo) {
    return null;
  }

  // 2. Chamada cognitiva estruturada
  const systemPrompt = `Você é um analista jurídico sênior altamente preciso especializado em direito processual civil brasileiro (CPC/15).
Sua tarefa é analisar o texto de uma publicação de Diário Oficial ou intimação judicial e classificar se ela abre algum prazo processual direto de manifestação ou recurso para o advogado intimado.

Você deve responder ESTREITAMENTE em formato JSON puro, sem textos explicativos antes ou depois.
O JSON deve seguir exatamente a seguinte estrutura de propriedades:
{
  "tem_prazo": boolean, // true se houver um prazo processual direto aberto por esta publicação, false caso contrário
  "tipo_prazo": string, // Nome correto do prazo processual (Ex: "Contestação", "Apelação Cível", "Especificação de Provas", "Embargos de Declaração", "Réplica à Contestação", "Manifestação Geral", "Recurso Ordinário", "Recurso Adesivo", ou "Cumprimento de Despacho" se genérico)
  "prazo_dias": number, // O prazo processual em dias conforme o CPC/15 ou determinação expressa do juiz no texto. Se for prazo em dobro, ou omitido mas implícito (ex: apelação de 15 dias), retorne o número de dias correto. Se for andamento informativo sem prazo, retorne 0.
  "inicia_contagem": boolean, // true se a publicação abre a contagem efetiva do prazo, false se é apenas um ato meramente informativo ou decisão sem prazo aberto.
  "justificativa_ia": string // Um breve resumo técnico-jurídico (máximo 1 parágrafo) justificando seu raciocínio (Ex: "O magistrado abriu prazo comum de 5 dias para especificação de provas").
}`;

  const userMessage = `Analise a publicação abaixo e preencha as propriedades do JSON conforme as instruções. Lembre-se de retornar apenas o JSON puro, sem markdown extra além do bloco JSON:

### PUBLICAÇÃO JUDICIAL A ANALISAR:
"${texto}"`;

  try {
    const resposta = await chamarClaude(systemPrompt, userMessage);
    
    // Tenta isolar o bloco JSON da resposta
    const matchJson = resposta.match(/\{[\s\S]*\}/);
    if (matchJson) {
      const parsed = JSON.parse(matchJson[0]);
      if (parsed.tem_prazo && parsed.prazo_dias > 0) {
        return {
          dias: parsed.prazo_dias,
          tipo: parsed.tipo_prazo || 'Cumprimento de Despacho',
          justificativa: parsed.justificativa_ia || ''
        };
      }
    }
  } catch (err) {
    console.warn('[Diário Service] Erro ao classificar prazo com IA, adotando fallback de Regex:', err.message);
  }

  // Fallback: se a IA falhar ou retornar sem prazo, adota o parser de Regex tradicional para garantir resiliência
  return extrairPrazoDoTexto(texto);
}

/**
 * Processa e faz o parsing de um lote de publicações brutas do Diário Oficial.
 * Identifica processos cadastrados, associa OABs, detecta prazos e abre os prazos automaticamente.
 * 
 * @param {Array<Object>} publicacoesBrutas - Array de objetos contendo corpo, data_disponibilizacao e fonte
 * @returns {Promise<Array<Object>>} Lista de publicações que casaram com termos de processos/OABs monitorados
 */
export async function processarPublicacoesDiario(publicacoesBrutas) {
  const publicacoesProcessadas = [];

  try {
    // 1. Carregar do banco todos os termos, OABs e processos monitorados ativamente
    const { data: processosCadastrados } = await supabase
      .from('processos')
      .select('id, numero_cnj, advogado_responsavel_id');

    const { data: advogados } = await supabase
      .from('usuarios')
      .select('id, nome, oab')
      .not('oab', 'is', null);

    for (const pub of publicacoesBrutas) {
      const corpo = pub.corpo;
      const dataDisponibilizacaoStr = pub.data_disponibilizacao; // Formato "YYYY-MM-DD"
      
      let processoIdVinculado = null;
      let responsavelIdVinculado = null;
      let termoCasado = null;

      // Sanitizar texto para facilitar regex
      const corpoFormatado = corpo.replace(/\s+/g, ' ');

      // A. Verificar se casa com algum processo cadastrado pelo número CNJ
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
        // B. Se não achou por processo, tentar casar com a OAB de algum advogado monitorado
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

      // Se a publicação não tem nenhuma relação com nossa carteira, ignoramos
      if (!processoIdVinculado && !responsavelIdVinculado) {
        continue;
      }

      // C. Tentar analisar prazo no texto de forma híbrida e cognitiva com o Gemini
      const analisePrazo = await extrairPrazoComIA(corpo);
      
      // 2. Gravar a publicação identificada no banco de dados
      const { data: novaPub, error: insertError } = await supabase
        .from('publicacoes_diario')
        .insert({
          processo_id: processoIdVinculado,
          termo_busca: termoCasado,
          data_disponibilizacao: dataDisponibilizacaoStr,
          data_publicacao: pub.data_publicacao || null, // Se não enviado, o trigger/motor calcula
          titulo: pub.titulo || 'Publicação de Diário Oficial Identificada',
          trecho: pub.trecho || corpo.substring(0, 300) + '...',
          corpo: corpo,
          tipo: analisePrazo?.tipo || 'Andamento Informativo',
          url_original: pub.url_original || null,
          prazo_identificado: analisePrazo?.dias || null,
          processado: false
        })
        .select('*')
        .single();

      if (insertError) {
        console.error('Erro ao gravar publicação identificada:', insertError.message);
        continue;
      }

      // D. Se houver processo E prazo identificado, agendar no Motor de Prazos
      if (processoIdVinculado && analisePrazo && responsavelIdVinculado) {
        try {
          console.log(`Abrindo prazo de ${analisePrazo.dias} dias para o processo ${processoIdVinculado}...`);
          
          // Chamar o Motor de Prazos deterministicamente
          const calculoPrazo = await calcularPrazoProcessual({
            processoId: processoIdVinculado,
            dataDisponibilizacao: dataDisponibilizacaoStr,
            prazoDias: analisePrazo.dias
          });

          // Gravar o prazo aberto no banco
          const { data: prazoSalvo, error: prazoError } = await supabase
            .from('prazos')
            .insert({
              processo_id: processoIdVinculado,
              publicacao_id: novaPub.id,
              descricao: `Prazo de ${analisePrazo.tipo} decorrente de publicação no DJe/DJEN`,
              tipo_prazo: analisePrazo.tipo,
              data_publicacao: calculoPrazo.data_publicacao,
              data_inicio_contagem: calculoPrazo.data_inicio_contagem,
              prazo_dias: analisePrazo.dias,
              data_vencimento: calculoPrazo.data_vencimento,
              status: 'aberto',
              responsavel_id: responsavelIdVinculado,
              observacoes: analisePrazo.justificativa || calculoPrazo.observacoes_calculo
            })
            .select('*')
            .single();

          if (prazoError) throw prazoError;

          // Atualizar a publicação com datas corretas calculadas
          await supabase
            .from('publicacoes_diario')
            .update({
              data_publicacao: calculoPrazo.data_publicacao,
              data_inicio_prazo: calculoPrazo.data_inicio_contagem,
              processado: true
            })
            .eq('id', novaPub.id);

          // Disparar Alerta Instantâneo para o Advogado Responsável (WhatsApp + Email)
          const mensagemWhats = `Um novo prazo de *${analisePrazo.tipo}* (${analisePrazo.dias} dias úteis) foi aberto automaticamente para você!\n\n• *Processo*: ${processoEncontrado?.numero_cnj || 'Monitorado'}\n• *Publicação*: ${calculoPrazo.data_publicacao}\n• *Início Contagem*: ${calculoPrazo.data_inicio_contagem}\n• *Vencimento*: *${calculoPrazo.data_vencimento}*\n\n_Donna analisou o teor e já organizou sua agenda forense. Revise o despacho no painel!_`;

          await dispararAlerta({
            usuarioId: responsavelIdVinculado,
            processoId: processoIdVinculado,
            prazoId: prazoSalvo.id,
            canal: 'ambos',
            titulo: `Prazo Aberto: ${analisePrazo.tipo}`,
            mensagem: mensagemWhats
          });

        } catch (calcErr) {
          console.error(`Erro ao processar cálculo/cadastro de prazo da publicação ${novaPub.id}:`, calcErr.message);
        }
      }

      publicacoesProcessadas.push(novaPub);
    }
  } catch (error) {
    console.error('Erro no processamento das publicações diárias:', error.message);
  }

  return publicacoesProcessadas;
}
