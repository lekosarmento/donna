import Anthropic from '@anthropic-ai/sdk';
import { getLocalDb } from '../config/sqlite-db.js';
import { supabase } from '../config/supabase.js';

export interface PerfilCognitivo {
  perfil_decisorio: 'legalista' | 'garantista' | 'pragmatico' | 'outro';
  temperamento: 'rigido' | 'flexivel' | 'imprevisivel' | 'colaborativo';
  estilo_audiencia: string;
  receptividade_acordos: string;
  preferencias_processuais: string;
  pontos_positivos: string[];
  pontos_atencao: string[];
  grau_confianca: number; // 1 a 5
  decisoes_analisadas: number;
}

export class ProfileBuilder {
  private static anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || 'dummy_api_key'
  });

  /**
   * Constrói o perfil cognitivo de um magistrado com base nas decisões brutas salvas no SQLite.
   * Envia as decisões para o Claude 3.5 Sonnet para análise qualitativa e salva o resultado no banco.
   * 
   * @param magistradoId ID do magistrado a ser analisado
   */
  public static async gerarPerfilMagistrado(magistradoId: string): Promise<PerfilCognitivo> {
    const db = getLocalDb();

    // 1. Carregar magistrado do SQLite
    const magistrado = db.prepare('SELECT * FROM atores_judiciario WHERE id = ?').get(magistradoId) as any;
    if (!magistrado) {
      throw new Error(`Magistrado com ID ${magistradoId} não foi localizado.`);
    }

    // 2. Carregar decisões do SQLite
    const decisoes = db.prepare(`
      SELECT * FROM raw_decisoes_magistrados 
      WHERE magistrado_id = ? 
      ORDER BY data_decisao DESC
    `).all(magistradoId) as any[];

    const totalDecisoes = decisoes.length;

    // Nunca gera perfil com menos de 10 decisões (confiança insuficiente)
    if (totalDecisoes < 10) {
      throw new Error(`Amostragem insuficiente para gerar perfil. O magistrado possui apenas ${totalDecisoes} decisões cadastradas (mínimo exigido: 10).`);
    }

    // 3. Selecionar lote de no máximo 20 decisões relevantes para a análise do Claude
    const batchDecisoes = decisoes.slice(0, 20);

    // 4. Calcular o Grau de Confiança estatístico
    const grauConfianca = this.calcularGrauConfianca(decisoes);

    // 5. Chamar a IA Claude 3.5 Sonnet para análise qualitativa (ou usar fallback inteligente se offline/sem chave)
    let analiseIa: any;
    
    if (process.env.ANTHROPIC_API_KEY && process.env.NODE_ENV !== 'test') {
      try {
        analiseIa = await this.chamarClaudeParaAnalise(magistrado.nome, batchDecisoes);
      } catch (err) {
        console.warn(`[ProfileBuilder] Falha na chamada ao Claude, utilizando gerador heurístico como fallback: ${err}`);
        analiseIa = this.gerarPerfilHeuristico(magistrado.nome, decisoes);
      }
    } else {
      // Fallback em ambiente de teste ou sem chave de API
      analiseIa = this.gerarPerfilHeuristico(magistrado.nome, decisoes);
    }

    const perfil: PerfilCognitivo = {
      perfil_decisorio: analiseIa.perfil_decisorio || 'legalista',
      temperamento: analiseIa.temperamento || 'rigido',
      estilo_audiencia: analiseIa.estilo_audiencia || 'Pontual e objetivo.',
      receptividade_acordos: analiseIa.receptividade_acordos || 'Baixa receptividade.',
      preferencias_processuais: analiseIa.preferencias_processuais || 'Prefere petições objetivas.',
      pontos_positivos: analiseIa.pontos_positivos || ['Extremamente técnico'],
      pontos_atencao: analiseIa.pontos_atencao || ['Formalismo excessivo'],
      grau_confianca: grauConfianca,
      decisoes_analisadas: totalDecisoes
    };

    // 6. Atualizar a tabela atores_judiciario localmente com o novo perfil
    db.prepare(`
      UPDATE atores_judiciario 
      SET perfil_decisorio = ?,
          temperamento = ?,
          estilo_audiencia = ?,
          receptividade_acordos = ?,
          pontos_positivos = ?,
          pontos_atencao = ?,
          preferencias_processuais = ?,
          grau_confianca_perfil = ?,
          ultima_atualizacao_perfil = (date('now')),
          updated_at = (datetime('now', 'localtime')),
          sync_pending = 1
      WHERE id = ?
    `).run(
      perfil.perfil_decisorio,
      perfil.temperamento,
      perfil.estilo_audiencia,
      perfil.receptividade_acordos,
      JSON.stringify(perfil.pontos_positivos),
      JSON.stringify(perfil.pontos_atencao),
      perfil.preferencias_processuais,
      perfil.grau_confianca,
      magistradoId
    );

    // 7. Salvar um snapshot na tabela historico_perfis_magistrados localmente
    db.prepare(`
      INSERT INTO historico_perfis_magistrados (
        id, magistrado_id, perfil_decisorio, temperamento, grau_confianca, decisoes_analisadas
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      magistradoId,
      perfil.perfil_decisorio,
      perfil.temperamento,
      perfil.grau_confianca,
      perfil.decisoes_analisadas
    );

    // 8. Opcional: Atualizar assincronamente o Supabase se online
    supabase.from('atores_judiciario').upsert({
      id: magistrado.id,
      escritorio_id: magistrado.escritorio_id,
      perfil_decisorio: perfil.perfil_decisorio,
      temperamento: perfil.temperamento,
      estilo_audiencia: perfil.estilo_audiencia,
      receptividade_acordos: perfil.receptividade_acordos,
      pontos_positivos: perfil.pontos_positivos,
      pontos_atencao: perfil.pontos_atencao,
      preferencias_processuais: perfil.preferencias_processuais,
      grau_confianca_perfil: perfil.grau_confianca,
      ultima_atualizacao_perfil: new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString()
    }).then(({ error }) => {
      if (error) {
        console.warn(`[ProfileBuilder] Erro de sync assíncrono com Supabase ao salvar perfil: ${error.message}`);
      } else {
        // Se sincronizou com sucesso, limpa a pendência local
        db.prepare('UPDATE atores_judiciario SET sync_pending = 0 WHERE id = ?').run(magistradoId);
      }
    }).catch(err => {
      console.warn(`[ProfileBuilder] Exceção na sincronização com Supabase: ${err}`);
    });

    return perfil;
  }

  /**
   * Invoca a API da Anthropic Claude para analisar qualitativamente o lote de decisões.
   */
  private static async chamarClaudeParaAnalise(nomeJuiz: string, decisoes: any[]): Promise<any> {
    const promptDecisoes = decisoes.map((d, index) => {
      return `Decisão #${index + 1}:
- Processo: ${d.numero_processo}
- Data: ${d.data_decisao}
- Tipo: ${d.tipo_decisao}
- Resultado: ${d.resultado}
- Área: ${d.area}
- Conteúdo: ${d.conteudo_decisao}`;
    }).join('\n\n---\n\n');

    const promptSystem = `Você é um analista jurídico sênior especializado em jurimetria cognitiva e psicologia judicial brasileira.
Sua tarefa é analisar uma série de decisões judiciais proferidas pelo magistrado ${nomeJuiz} e preencher um dossier cognitivo estruturado em formato JSON.

O JSON deve seguir EXATAMENTE a estrutura abaixo:
{
  "perfil_decisorio": "legalista" | "garantista" | "pragmatico",
  "temperamento": "rigido" | "flexivel" | "imprevisivel" | "colaborativo",
  "estilo_audiencia": "String descrevendo o comportamento estimado e postura do magistrado em audiência",
  "receptividade_acordos": "String descrevendo a abertura dele para conciliação ou acordo",
  "preferencias_processuais": "String descrevendo regras de escrita e instrução recomendadas ao advogado (ex: prefere petições curtas)",
  "pontos_positivos": ["Frase 1", "Frase 2"],
  "pontos_atencao": ["Frase 1", "Frase 2"]
}

Diretrizes para classificação:
- "legalista": Foco literal na lei e códigos, formalista, valoriza prazos peremptórios e ritos rígidos.
- "garantista": Foco em direitos fundamentais, devido processo legal, proteção de hipossuficientes, mitigador de excessos.
- "pragmatico": Foco nos efeitos econômicos e sociais da decisão, flexibilizador de formalismos se isso trouxer justiça material, celeridade.
- "rigido": Punições duras por falhas formais, muito pontual, seco.
- "flexivel": Concede prazos de emenda sem rigor excessivo, acolhe pedidos de redesignação com justificativa razoável.

Responda APENAS o JSON puro, sem introduções ou explicações.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      temperature: 0.1,
      system: promptSystem,
      messages: [
        {
          role: 'user',
          content: `Analise estas decisões judiciais de ${nomeJuiz} para gerar o dossier cognitivo:\n\n${promptDecisoes}`
        }
      ]
    });

    const contentText = response.content[0].type === 'text' ? response.content[0].text : '';
    try {
      // Extrai o JSON caso venha com markdown wrapping
      const cleanJsonStr = contentText.substring(
        contentText.indexOf('{'),
        contentText.lastIndexOf('}') + 1
      );
      return JSON.parse(cleanJsonStr);
    } catch (parseErr) {
      throw new Error(`Erro ao interpretar o resultado de análise do Claude: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
    }
  }

  /**
   * Calcula estatisticamente o Grau de Confiança de 1 a 5 estrelas.
   * Grau de Confiança = f(quantidade de decisões analisadas, variância temporal)
   */
  public static calcularGrauConfianca(decisoes: any[]): number {
    const total = decisoes.length;
    if (total < 10) return 1;

    // 1. Pontuação base por quantidade
    let score = 1;
    if (total >= 10 && total <= 25) score = 1;
    else if (total <= 50) score = 2;
    else if (total <= 75) score = 3;
    else if (total <= 100) score = 4;
    else score = 5;

    // 2. Ajuste por variância temporal (amplitude das datas)
    const datas = decisoes.map(d => new Date(d.data_decisao).getTime()).filter(t => !isNaN(t));
    if (datas.length >= 2) {
      const maxDate = Math.max(...datas);
      const minDate = Math.min(...datas);
      const diffDays = (maxDate - minDate) / (1000 * 60 * 60 * 24);

      if (diffDays > 730) {
        // Amostragem robusta de mais de 2 anos: acrescenta confiabilidade temporal (+1)
        score += 1;
      } else if (diffDays < 90) {
        // Amostragem concentrada em menos de 3 meses: reduz confiança devido a sazonalidade (-1)
        score -= 1;
      }
    }

    // Garante limites entre 1 e 5
    return Math.max(1, Math.min(score, 5));
  }

  /**
   * Gerador de fallback estruturado caso a API do Claude esteja offline.
   * Analisa estatísticas básicas locais (tipo de decisão, resultados) para estimar um perfil coerente.
   */
  private static gerarPerfilHeuristico(nomeJuiz: string, decisoes: any[]): any {
    // Conta os resultados das decisões
    const contagem = decisoes.reduce((acc, curr) => {
      acc[curr.resultado] = (acc[curr.resultado] || 0) + 1;
      return acc;
    }, { procedente: 0, improcedente: 0, parcial: 0, outro: 0 } as Record<string, number>);

    const total = decisoes.length;
    const taxaProcedente = contagem.procedente / total;
    const taxaImprocedente = contagem.improcedente / total;

    let perfil: 'legalista' | 'garantista' | 'pragmatico' = 'legalista';
    let temperamento: 'rigido' | 'flexivel' | 'imprevisivel' | 'colaborativo' = 'rigido';
    let estilo_audiencia = '';
    let receptividade_acordos = '';
    let preferencias_processuais = '';
    let pontos_positivos: string[] = [];
    let pontos_atencao: string[] = [];

    // Se o juiz indefere muito, possui viés legalista estrito
    if (taxaImprocedente > 0.5) {
      perfil = 'legalista';
      temperamento = 'rigido';
      estilo_audiencia = 'Rigoroso com horários. Costuma indeferir perguntas repetitivas ou impertinentes de pronto.';
      receptividade_acordos = 'Reduzida abertura para conciliações se as partes não trouxerem proposta líquida.';
      preferencias_processuais = 'Exige respeito milimétrico aos prazos de emenda e petições curtas (máx. 5 páginas).';
      pontos_positivos = ['Muito célere no julgamento', 'Previsibilidade decisória elevada'];
      pontos_atencao = ['Rigidez excessiva com vícios formais de petição', 'Baixa tolerância a atrasos'];
    } 
    // Se o juiz defere muito, tende ao garantismo cível/social
    else if (taxaProcedente > 0.45) {
      perfil = 'garantista';
      temperamento = 'flexivel';
      estilo_audiencia = 'Pacífico e aberto aos argumentos dos advogados. Permite debates fundamentados.';
      receptividade_acordos = 'Estimula a mediação ativa no início e no término da instrução.';
      preferencias_processuais = 'Valoriza muito a instrução probatória bem justificada e perícias minuciosas.';
      pontos_positivos = ['Acessível para despachos orais', 'Preocupação social evidente nas decisões'];
      pontos_atencao = ['Prazos de julgamento mais lentos devido à análise detalhada', 'Pode converter feitos em diligência frequentemente'];
    } 
    // Caso intermediário, considerado pragmático
    else {
      perfil = 'pragmatico';
      temperamento = 'colaborativo';
      estilo_audiencia = 'Foco em conciliação objetiva. Conduz o depoimento com pragmatismo.';
      receptividade_acordos = 'Elevada receptividade. Tenta compor acordo amigável em quase todas as oportunidades.';
      preferencias_processuais = 'Recomenda-se focar na utilidade prática e nos efeitos econômicos da tutela requerida.';
      pontos_positivos = ['Focado em resolver o conflito real das partes', 'Flexibilidade de ritos para atingir eficiência'];
      pontos_atencao = ['Decisões baseadas em equidade podem desagradar legalistas puros', 'Decide liminares de forma ponderada e demorada'];
    }

    return {
      perfil_decisorio: perfil,
      temperamento,
      estilo_audiencia,
      receptividade_acordos,
      preferencias_processuais,
      pontos_positivos,
      pontos_atencao
    };
  }
}
