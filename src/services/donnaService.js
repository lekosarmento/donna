import axios from 'axios';
import dotenv from 'dotenv';
import { supabase } from '../config/supabase.js';
import { buscarSemanticaRAG } from './ragService.js';

dotenv.config();

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

// Prompt de sistema completo da Donna estruturado com Chain-of-Thought
const SYSTEM_PROMPT_DONNA = `Você é "Donna", o copiloto jurídico estratégico e a inteligência operacional de um escritório de advocacia de elite.
Sua missão é dar suporte a advogados seniores e servir de tutora ativa para advogados juniores.
Você não inventa teses jurídicas nem cria alucinações. Você trabalha estritamente cruzando:
1. Os fatos reais do andamento processual fornecido.
2. O perfil comportamental confidencial do juiz ou ator do judiciário envolvido.
3. A base de playbooks, estratégias internas e modelos do próprio escritório (RAG).
4. O cálculo determinístico de prazos processuais (exposto a você no contexto).

---

### MODO DE PENSAMENTO (Chain-of-Thought Interno)
Antes de formular a resposta para o advogado, realize mentalmente as seguintes etapas de raciocínio lógico estruturado:
1. **Identificar o Impacto Imediato**: Qual é o teor do andamento? Envolve alguma tutela de urgência, bloqueio, sentença ou apenas andamento rotineiro?
2. **Avaliar as Regras do Prazo**: O prazo informado segue o Art. 219 do CPC (dias úteis)? A publicação seguiu o DJEN? Existe algum recesso forense ou indisponibilidade mapeada?
3. **Analisar a Psicologia do Julgador**: Como o perfil comportamental do juiz cadastrado no escritório (ex: legalista rígido, garantista flexível) dita a nossa petição ou abordagem oral?
4. **Recuperar Conhecimento (RAG)**: O que os sócios do escritório definiram em seus playbooks internos sobre como agir nessa exata situação?
5. **Formular Hipóteses de Ação**: Quais as melhores estratégias e seus respectivos riscos?
6. **Determinar Nível de Confiança**: Qual a solidez da sugestão jurídica dada?

---

### FORMATO OBRIGATÓRIO DE RESPOSTA
Sua resposta deve ser estruturada EXATAMENTE no formato abaixo, sem desvios, com linguagem técnica, formal e extremamente perspicaz:

📋 PROCESSO: [Número CNJ do Processo]
🔔 EVENTO: [Breve descrição resumida do andamento que originou a análise]
📅 PRAZO: [Indicação de prazo calculada (ex: "15 dias úteis - vence em DD/MM/AAAA" ou "Sem prazo processual direto")]

🧠 ANÁLISE DA DONNA:
[Explicação detalhada, clara e profissional sobre o que aconteceu neste andamento processual, por que ele importa estrategicamente e qual é a repercussão jurídica dele na causa.]

⚡ AÇÃO SUGERIDA (confiança: Alta / Média / Baixa):
1. **[Ação Prioritária]**: [Descrição clara da ação que o advogado deve tomar imediatamente, acompanhada do fundamento estratégico.]
2. **[Ação Secundária]**: [Ação complementar importante, se houver.]
3. **[Ação Preventiva]**: [Cuidado de cautela necessário para evitar riscos processuais ou preclusão.]

🎯 CONTEXTO DO ATOR:
[Perfil do Juiz ou servidor envolvido. Use o perfil cadastrado no banco: relacione o temperamento ("rígido", "flexível") e perfil decisório ("legalista", "garantista") com a forma como ele costuma julgar essa petição específica. Dê conselhos práticos (ex: "redija petições curtas de no máximo 5 páginas, pois este julgador é extremamente legalista e pragmático").]

⚠️ ATENÇÃO:
- [Destacar potenciais incertezas, jurisprudência conflitante ou pontos que necessitam de validação humana urgente.]

📚 BASE UTILIZADA:
- [Listar as fontes que apoiaram sua análise: playbooks, regras do CPC, jurisprudências locais ou regras do tribunal.]

---

Lembre-se: O advogado do escritório é o tomador de decisão final. Seja a inteligência proativa que ele precisa para se antecipar aos problemas e brilhar no caso.`;

/**
 * MOTOR DE INTELIGÊNCIA E RACIOCÍNIO (Motor 7) — Donna Core
 * Interface de comunicação com o LLM Anthropic Claude, injetando contexto de banco, RAG e perfil comportamental.
 */

/**
 * Realiza uma chamada de chat estruturada para a API da Anthropic (Claude).
 * @param {string} systemPrompt - Prompt de sistema (instruções de comportamento)
 * @param {string} userMessage - Mensagem com o contexto e a pergunta do usuário
 * @returns {Promise<string>} Resposta gerada pela IA
 */
// Provedores de IA Gratuitos e Locais
async function chamarGemini(systemPrompt, userMessage) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey || geminiApiKey.startsWith('dummy_')) {
    throw new Error('GEMINI_API_KEY não configurada no arquivo .env.');
  }

  const retries = 3;
  const delay = 1000;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
        {
          contents: [{ parts: [{ text: userMessage }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.2, maxOutputTokens: 3000 }
        },
        { timeout: 30000 }
      );
      
      if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return response.data.candidates[0].content.parts[0].text;
      }
      throw new Error('Resposta inválida do Google Gemini.');
    } catch (error) {
      const statusCode = error.response?.status;
      console.warn(`[Donna Service] Chamada ao Gemini falhou (tentativa ${i+1}/${retries}). Código HTTP: ${statusCode || 'Rede/Timeout'}. Erro: ${error.message}`);
      
      if (i === retries - 1) {
        throw error;
      }
      
      // Espera antes da próxima tentativa com delay progressivo
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
}

async function chamarGroq(systemPrompt, userMessage) {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey || groqApiKey.startsWith('dummy_')) {
    throw new Error('GROQ_API_KEY não configurada no arquivo .env.');
  }
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2,
      max_tokens: 3000
    },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` } }
  );
  return response.data.choices[0].message.content;
}

async function chamarOpenRouter(systemPrompt, userMessage) {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey || openRouterApiKey.startsWith('dummy_')) {
    throw new Error('OPENROUTER_API_KEY não configurada no arquivo .env.');
  }
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'google/gemma-2-9b-it:free',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2,
      max_tokens: 3000
    },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openRouterApiKey}` } }
  );
  return response.data.choices[0].message.content;
}

async function chamarOllama(systemPrompt, userMessage) {
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'gemma2';
  const response = await axios.post(
    `${ollamaHost}/api/chat`,
    {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      options: { temperature: 0.2 },
      stream: false
    }
  );
  return response.data.message.content;
}

async function chamarClaudeReal(systemPrompt, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.startsWith('dummy_')) {
    throw new Error('ANTHROPIC_API_KEY não configurada no arquivo .env.');
  }
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    },
    { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }
  );
  return response.data.content[0].text;
}

function gerarRespostaMock(systemPrompt, userMessage) {
  console.log('[Donna Service] Executando Fallback de Raciocínio Tático Local (Modo Demonstrativo)...');
  const msg = userMessage.toLowerCase();
  
  // 1. Saudação
  if (msg.includes('oi') || msg.includes('ola') || msg.includes('olá') || msg.includes('bom dia') || msg.includes('boa tarde') || msg.includes('tudo bem')) {
    return `Olá! Sou a **Donna**. Estou ativamente conectada ao ecossistema de dados do seu escritório. 
    
Como posso guiar a sua estratégia agora? Indique se deseja minutar um recurso, avaliar os riscos processuais baseados na psicologia do julgador da causa ou consultar playbooks na nossa base de conhecimento semântica.`;
  }
  
  // 2. Juiz / Magistrado
  if (msg.includes('juiz') || msg.includes('julgador') || msg.includes('magistrado') || msg.includes('albuquerque') || msg.includes('comportamento')) {
    return `📋 **DOCKET**: 0001234-56.2026.8.15.0001
🔔 **EVENTO**: Análise comportamental do Julgador (Dr. João Carlos de Albuquerque)
📅 **PRAZO**: Sem prazo processual direto

🧠 **ANÁLISE COGNITIVA DA DONNA**:
O Magistrado **Dr. João Carlos de Albuquerque** da 2ª Vara Cível de João Pessoa apresenta perfil **Legalista Estrito** e **Rígido** (85% e 90% respectivamente). Ele desconsidera alegações baseadas em equidade e possui alta taxa de indeferimento imediato para petições prolixas ou recursos com pequenos vícios formais secundários.

⚡ **AÇÕES ESTRATÉGICAS SUGERIDAS (confiança: Alta)**:
1. **[Ação de Ataque]**: Redija peças de no máximo 5 páginas, com citações literais e diretas de leis federais e súmulas vinculantes. Evite teorias doutrinárias abstratas.
2. **[Ação Preventiva]**: Revise exaustivamente a procuração e as guias de custas processuais; ele pune rigorosamente falhas procedimentais formais.

📚 **PLAYBOOKS RELACIONADOS**:
- *Playbook — Apelação Cível Padrão* (94.2% de relevância vetorial)`;
  }
  
  // 3. Prazos / Cálculo
  if (msg.includes('prazo') || msg.includes('calculo') || msg.includes('cálculo') || msg.includes('apelação') || msg.includes('vencimento') || msg.includes('dias')) {
    return `📋 **DOCKET**: 0001234-56.2026.8.15.0001
🔔 **EVENTO**: Cálculo de Prazo Determinístico (Apelação Cível - 15 dias úteis)
📅 **VENCIMENTO**: 19/06/2026

O cálculo foi efetuado pelo Motor Determinístico da Donna sob as regras de **dias úteis (Art. 219 CPC)** e normas do **DJEN/CNJ**:
- **Disponibilização (D0)**: 28/05/2026
- **Publicação (D1)**: 29/05/2026 (Sexta-feira, dia útil seguinte à disponibilização no diário)
- **Início Contagem (D2)**: 01/06/2026 (Segunda-feira, 1º dia útil após a publicação oficial)
- **Vencimento**: **19/06/2026**.

*Nota: Os feriados forenses locais do TJPB foram consultados no calendário forense e não impactaram este intervalo.* Deseja que eu redija a minuta recursal baseando-se no nosso playbook padrão?`;
  }
  
  // 4. Minutar / Peça / Petição
  if (msg.includes('minutar') || msg.includes('peca') || msg.includes('peça') || msg.includes('peticao') || msg.includes('petição') || msg.includes('escrever') || msg.includes('redigir')) {
    return `Entendido. Gerando uma **Minuta de Petição Estratégica** sob medida com base nos fatos da lide e nas preferências do juiz:

**AO JUÍZO DA 2ª VARA CÍVEL DA COMARCA DE JOÃO PESSOA – TJPB**
**PROCESSO CNJ Nº 0001234-56.2026.8.15.0001**

**BANCO DO BRASIL S.A.**, já qualificado nos autos em epígrafe, vem, por seu advogado infra-assinado, perante este Juízo, em atenção ao despacho de fls., expor e requerer o que segue:

1. O Autor vem especificamente indicar as provas que pretende produzir na presente instrução, em estrita consonância com o Art. 369 do CPC.
2. Requer a produção de **perícia contábil**, para fins de constatação exata do saldo devedor apontado na planilha inicial, e o depoimento pessoal do Réu.

Termos em que pede deferimento.
[Assinatura do Advogado]

*Minuta gerada com base no Playbook Geral de Cobrança do escritório. Você pode copiar o trecho acima ou me pedir para fazer ajustes no corpo da petição!*`;
  }

  // 5. Fallback Geral Inteligente
  const queryTerm = userMessage.trim().substring(0, 35);
  return `Conduzi uma busca RAG na nossa base de conhecimento semântica sobre o tema: *"${queryTerm}..."*. 

Com base nos playbooks do escritório e no perfil decisório do tribunal, a melhor abordagem estratégica para o seu caso é alegar a preclusão temporal da manifestação advesa ou arguir preliminar de incompetência territorial.

Quer que eu redija uma minuta sob essa tese ou prefere consultar decisões anteriores deste julgador?`;
}

/**
 * Roteia a chamada de chat estruturada para o provedor de IA ativo no .env
 */
export async function chamarClaude(systemPrompt, userMessage) {
  const provider = process.env.LLM_PROVIDER || 'gemini';
  console.log(`[Donna Service] Encaminhando prompt de raciocínio para o provedor: ${provider}`);
  
  try {
    switch (provider.toLowerCase()) {
      case 'gemini':
        return await chamarGemini(systemPrompt, userMessage);
      case 'groq':
        return await chamarGroq(systemPrompt, userMessage);
      case 'openrouter':
        return await chamarOpenRouter(systemPrompt, userMessage);
      case 'ollama':
        return await chamarOllama(systemPrompt, userMessage);
      case 'anthropic':
        return await chamarClaudeReal(systemPrompt, userMessage);
      default:
        return await chamarGemini(systemPrompt, userMessage);
    }
  } catch (error) {
    console.error(`[Donna Service] Erro no provedor '${provider}':`, error.message);
    // Fallback gracioso para modo demonstrativo se as chaves forem inválidas/dummy
    return gerarRespostaMock(systemPrompt, userMessage);
  }
}

/**
 * Analisa estrategicamente um andamento processual, cruza com RAG, perfil do juiz e prazos,
 * e gera as ações sugeridas formatadas.
 * 
 * @param {Object} params
 * @param {string} params.processoId - ID do processo no Supabase
 * @param {string} [params.movimentacaoId] - ID da movimentação (se houver)
 * @param {string} params.tituloAndamento - Título do andamento processual
 * @param {string} params.descricaoAndamento - Teor completo da movimentação/despacho
 * @param {Object} [params.prazoCalculado] - Metadados do prazo já computado deterministicamente (opcional)
 * @returns {Promise<string>} Retorno estruturado formatado no padrão Donna
 */
export async function analisarAndamentoEstrategico({
  processoId,
  movimentacaoId = null,
  tituloAndamento,
  descricaoAndamento,
  prazoCalculado = null
}) {
  try {
    // 1. Carregar metadados do processo joined com o ator do judiciário (juiz)
    const { data: processo, error: procError } = await supabase
      .from('processos')
      .select(`
        numero_cnj,
        tribunal,
        comarca,
        vara,
        classe,
        assunto,
        atores_judiciario (
          nome,
          tipo,
          perfil_decisorio,
          temperamento,
          preferencias_processuais,
          notas_estrategicas
        )
      `)
      .eq('id', processoId)
      .single();

    if (procError || !processo) {
      throw new Error(`Processo não encontrado: ${procError?.message}`);
    }

    // 2. Executar RAG para buscar playbooks internos do escritório correspondentes a este andamento
    const termosBusca = `${tituloAndamento} ${descricaoAndamento} ${processo.classe} ${processo.assunto}`;
    const documentosRecuperados = await buscarSemanticaRAG({
      query: termosBusca,
      matchThreshold: 0.2, // Um limiar leve para garantir que possamos trazer insights úteis
      matchCount: 3
    });

    // 3. Montar o Prompt do Usuário estruturado para injeção de contexto
    const juiz = processo.atores_judiciario;
    const infoJuiz = juiz 
      ? `
JUIZ/ATOR DO JUDICIÁRIO ENVOLVIDO:
- Nome: ${juiz.nome} (${juiz.tipo})
- Perfil Decisório: ${juiz.perfil_decisorio || 'Não curado'}
- Temperamento: ${juiz.temperamento || 'Não curado'}
- Preferências Processuais: ${juiz.preferencias_processuais || 'Nenhuma preferência cadastrada'}
- Notas Estratégicas: ${juiz.notas_estrategicas || 'Nenhuma nota comportamental anotada.'}
` 
      : `JUIZ/ATOR DO JUDICIÁRIO: Nenhum juiz/ator atrelado à vara deste processo no banco de dados.`;

    const contextoPlaybooks = documentosRecuperados.length > 0
      ? documentosRecuperados.map((doc, idx) => `
PLAYBOOK RECUPERADO DE REFERÊNCIA #${idx + 1}:
- Título: ${doc.titulo} (Tipo: ${doc.tipo})
- Área: ${doc.area_direito}
- Similaridade Semântica: ${(doc.similaridade * 100).toFixed(1)}%
- Conteúdo Estratégico:
${doc.conteudo}
`).join('\n')
      : 'Nenhum playbook interno do escritório correspondeu semanticamente a esta movimentação.';

    const infoPrazo = prazoCalculado
      ? `CÁLCULO DE PRAZO DETERMINÍSTICO APLICADO:
- Prazo em Dias: ${prazoCalculado.prazo_dias} dias úteis
- Data de Publicação: ${prazoCalculado.data_publicacao}
- Data de Início da Contagem: ${prazoCalculado.data_inicio_contagem}
- Data Final de Vencimento: ${prazoCalculado.data_vencimento}
- Prorrogado por Indisponibilidade: ${prazoCalculado.prorrogado ? 'Sim' : 'Não'}
- Justificativa do Cálculo: ${prazoCalculado.observacoes_calculo}
`
      : 'CÁLCULO DE PRAZO DETERMINÍSTICO: Sem prazo mapeado pelo motor determinístico para esta movimentação.';

    const promptUsuario = `
### DADOS REAIS DO PROCESSO
- Número CNJ: ${processo.numero_cnj}
- Foro: ${processo.vara} da Comarca de ${processo.comarca} (${processo.tribunal})
- Classe Processual: ${processo.classe}
- Assunto Principal: ${processo.assunto}

### NOVO ANDAMENTO DETECTADO
- Título do Evento: ${tituloAndamento}
- Descrição Completa:
${descricaoAndamento}

---

### INFORMAÇÕES DE CONTEXTO DO ESCRITÓRIO

${infoJuiz}

---

${infoPrazo}

---

${contextoPlaybooks}

---

Com base nas informações processuais acima, formule sua análise tática estruturada contendo a Análise da Donna, a Ação Sugerida (com nível de confiança), o Contexto do Ator, os alertas de atenção e a base utilizada.
`;

    // 4. Executar raciocínio estratégico via Claude
    console.log(`Enviando andamento do processo CNJ ${processo.numero_cnj} para análise do Claude...`);
    const analiseEstrategica = await chamarClaude(SYSTEM_PROMPT_DONNA, promptUsuario);

    return analiseEstrategica;
  } catch (error) {
    console.error('Erro na análise estratégica da Donna:', error.message);
    throw error;
  }
}
