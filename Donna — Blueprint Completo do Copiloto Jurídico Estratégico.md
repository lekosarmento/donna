# Donna — Blueprint Completo do Copiloto Jurídico Estratégico

## Visão Geral

A Donna é um sistema de inteligência jurídica operacional que combina monitoramento processual em tempo real, base de conhecimento semântica, inteligência sobre atores do judiciário e raciocínio estratégico assistido por IA. O nome é uma referência proposital à personagem de Suits: uma secretária que antecipa problemas, ensina advogados juniores, conhece cada juiz e promotor pelo perfil e age proativamente — não apenas reativa.[^1][^2]

A Donna não inventa direito. Ela combina **dados reais + regras determinísticas + LLM para raciocínio**, sempre com grau de confiança explícito na resposta.[^1]

***

## Arquitetura Geral

A arquitetura é organizada em 7 motores independentes que trocam dados entre si via barramento central:

```
┌─────────────────────────────────────────────────────────────┐
│                        DONNA CORE                           │
│                                                             │
│  [Motor 1]     [Motor 2]     [Motor 3]     [Motor 4]        │
│  Processos  +  Diário     +  Prazos     +  Radar           │
│  & Mvtos       Oficial       & Agenda      Operacional      │
│                                                             │
│  [Motor 5]     [Motor 6]     [Motor 7]                      │
│  Atores     +  RAG Base  +  Estratégia                     │
│  Judiciário    Conhecimento   & Ensino                      │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  Barramento: n8n + Supabase + pgvector + LLM               │
└─────────────────────────────────────────────────────────────┘
```

***

## Motor 1 — Processos e Movimentações

**Objetivo:** Capturar e organizar todos os eventos processuais relevantes da carteira.

**Fontes de dados:**
- API de monitoramento processual (Jusbrasil, JUDIT ou similar)[^3][^4]
- API Pública do DataJud (CNJ) — metadados e movimentações de processos em 90+ tribunais[^5][^6]
- Webhook de movimentações com entrega diária ou em tempo real[^4][^7]

**Tabelas principais:**

```sql
processos (
  id UUID PRIMARY KEY,
  numero_cnj TEXT UNIQUE,
  tribunal TEXT,
  vara TEXT,
  juiz_id UUID REFERENCES atores_judiciario(id),
  classe TEXT,
  assunto TEXT,
  rito TEXT,
  fase_processual TEXT,
  cliente_id UUID REFERENCES clientes(id),
  advogado_responsavel_id UUID REFERENCES usuarios(id),
  prioridade TEXT CHECK (prioridade IN ('urgente','alta','media','baixa')),
  status TEXT,
  api_monitor_id TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

movimentacoes (
  id UUID PRIMARY KEY,
  processo_id UUID REFERENCES processos(id),
  data_evento TIMESTAMPTZ,
  titulo TEXT,
  descricao TEXT,
  tipo_evento TEXT,
  grau_relevancia TEXT,
  raw_payload JSONB,
  processado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Classificação automática de relevância:**

| Tipo de evento | Nível | Ação sugerida |
|---|---|---|
| Sentença, decisão, acórdão | Urgente | Avisar imediatamente, abrir prazo |
| Intimação, citação | Urgente | Verificar teor e prazo |
| Liminar, tutela, cautelar | Urgente | Avisar cliente e responsável |
| Bloqueio, penhora, arresto | Urgente | Acionar responsável |
| Audiência designada | Alta | Registrar no calendário |
| Juntada de petição | Média | Verificar se é própria ou adversária |
| Conclusos ao juiz | Média | Agendar revisão em 10 dias |
| Distribuição, remessa | Baixa | Registrar apenas |
| Movimentos administrativos | Baixa | Armazenar sem alerta |

***

## Motor 2 — Diário Oficial

**Objetivo:** Varrer publicações diárias que mencionem clientes, partes, advogados e processos monitorados.

**Fontes de dados:**
- API de Diários Oficiais (cobertura nacional: diários judiciais, executivos e administrativos)[^8][^9]
- Busca textual por nome, CPF/CNPJ, OAB, número do processo e expressões booleanas[^9]

**Funcionamento:**
1. Toda manhã, disparar busca no diário com os termos cadastrados para cada cliente/processo.
2. Retornar trechos relevantes com data de publicação.
3. Identificar se a publicação **inicia contagem de prazo**.
4. Encaminhar para o Motor 3 (Prazos) com o dado capturado.

**Tabela:**

```sql
publicacoes_diario (
  id UUID PRIMARY KEY,
  processo_id UUID REFERENCES processos(id),
  data_disponibilizacao DATE,
  data_publicacao DATE,  -- dia útil seguinte à disponibilização
  data_inicio_prazo DATE, -- dia útil após a publicação
  titulo TEXT,
  trecho TEXT,
  corpo TEXT,
  tipo TEXT,
  url_original TEXT,
  prazo_identificado INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

***

## Motor 3 — Prazos e Calendário Forense

**Objetivo:** Calcular prazos processuais com precisão, respeitando dias úteis, feriados, recessos, suspensões e indisponibilidade do sistema.

**Regras do CPC implementadas:**

- Prazos contados **em dias úteis** (art. 219 CPC)[^10]
- Publicação no DJe: data oficial é o **dia útil seguinte à disponibilização**[^11][^10]
- Contagem inicia no **primeiro dia útil após a publicação**[^10][^11]
- Sábados, domingos e feriados são excluídos (art. 216 CPC)[^10]
- Indisponibilidade do PJe entre 6h e 23h prorroga o prazo para o próximo dia útil[^12]
- Novas regras CNJ (vigentes desde 16/05/2025): todos os prazos computados com base exclusivamente nas publicações no DJEN[^13][^11]

**Fontes para feriados:**
- Calendários oficiais dos tribunais (Ex.: JFRN, TJRS, TJPB, etc.)[^14][^15]
- Lei Federal nº 5.010/66 (recesso judiciário)[^15]
- Atos administrativos locais dos fóruns
- Comunicados de indisponibilidade do PJe[^16][^12]

**Tabelas:**

```sql
prazos (
  id UUID PRIMARY KEY,
  processo_id UUID REFERENCES processos(id),
  movimentacao_id UUID REFERENCES movimentacoes(id),
  publicacao_id UUID REFERENCES publicacoes_diario(id),
  descricao TEXT,
  tipo_prazo TEXT,
  data_publicacao DATE,
  data_inicio_contagem DATE,
  prazo_dias INTEGER,
  data_vencimento DATE,
  dias_uteis_restantes INTEGER,
  status TEXT CHECK (status IN ('aberto','cumprido','vencido','suspenso','prorrogado')),
  responsavel_id UUID REFERENCES usuarios(id),
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

feriados_forense (
  id UUID PRIMARY KEY,
  data DATE,
  descricao TEXT,
  tribunal TEXT,
  abrangencia TEXT CHECK (abrangencia IN ('nacional','estadual','municipal','vara_especifica')),
  fonte TEXT,
  tipo TEXT CHECK (tipo IN ('feriado','recesso','suspensao','indisponibilidade'))
)
```

**Alerta de prazos (escalonado):**

| Momento | Canal | Mensagem |
|---|---|---|
| Abertura | WhatsApp + Painel | "Prazo aberto: X dias para [ato]" |
| 5 dias antes | WhatsApp | "Prazo vence em 5 dias úteis" |
| 2 dias antes | WhatsApp + E-mail | "ATENÇÃO: prazo vence em 2 dias" |
| 1 dia antes | WhatsApp + E-mail + Liga | "URGENTE: prazo amanhã" |
| Dia do vencimento | WhatsApp a cada 2h | "Prazo hoje — confirme cumprimento" |

***

## Motor 4 — Radar Operacional

**Objetivo:** Monitorar continuamente o ambiente externo que afeta a rotina forense: indisponibilidade de sistemas, mudanças de expediente, notícias locais, avisos de fórum e cartório.

**Fontes:**
- Páginas de comunicados dos tribunais (ex.: TRT, TJPB, JFPB)[^17][^16]
- Avisos de indisponibilidade do PJe[^16]
- Notícias de sites jurídicos regionais
- Comunicados de cartórios (quando cadastrados manualmente)

**Tabela:**

```sql
eventos_operacionais (
  id UUID PRIMARY KEY,
  tipo TEXT CHECK (tipo IN (
    'indisponibilidade_sistema',
    'mudanca_expediente',
    'aviso_forum',
    'aviso_cartorio',
    'recesso_nao_previsto',
    'mudanca_rotina',
    'noticia_relevante'
  )),
  tribunal TEXT,
  vara TEXT,
  titulo TEXT,
  descricao TEXT,
  data_inicio TIMESTAMPTZ,
  data_fim TIMESTAMPTZ,
  impacto_prazos BOOLEAN DEFAULT FALSE,
  fonte_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Fluxo de reação:**
1. Radar detecta indisponibilidade publicada no site do tribunal.
2. Sistema cruza com prazos com vencimento no período afetado.
3. Donna emite alerta: "PJe esteve indisponível [X horas]. Os seguintes prazos podem ter sido prorrogados: [lista]. Recomendo emitir certidão de indisponibilidade e revisar cada um."[^12][^16]

***

## Motor 5 — Atores do Judiciário (Inteligência de Campo)

**Objetivo:** Armazenar o perfil comportamental, contatos e padrões de cada ator do judiciário com quem o escritório se relaciona: juízes, promotores, defensores, servidores, oficiais e registradores.

Este é o diferencial mais sensível da Donna. Nenhuma plataforma do mercado oferece isso porque exige curadoria manual contínua — mas é exatamente onde mora o valor estratégico.[^18][^1]

**Tabela:**

```sql
atores_judiciario (
  id UUID PRIMARY KEY,
  tipo TEXT CHECK (tipo IN (
    'juiz','desembargador','ministro',
    'promotor','defensor_publico',
    'servidor_cartorio','oficial_justica',
    'registrador','tabeliao','perito'
  )),
  nome TEXT NOT NULL,
  nome_usual TEXT,
  tribunal TEXT,
  comarca TEXT,
  vara TEXT,
  cargo_atual TEXT,

  -- Contatos
  telefone_gabinete TEXT,
  telefone_secretaria TEXT,
  telefone_direto TEXT,
  whatsapp TEXT,
  email_gabinete TEXT,
  email_direto TEXT,
  horario_atendimento TEXT,
  melhor_forma_contato TEXT,
  observacoes_contato TEXT,

  -- Perfil comportamental (curadoria manual)
  perfil_decisorio TEXT,  -- "legalista", "garantista", "ativista", "conservador", "pragmático"
  temperamento TEXT,  -- "rígido", "flexível", "imprevisível", "colaborativo"
  estilo_audiencia TEXT,
  receptividade_acordos TEXT,
  pontos_positivos TEXT[],
  pontos_atencao TEXT[],
  preferencias_processuais TEXT,  -- ex: "prefere petições curtas", "exige triplicata"
  historico_decisoes_relevantes TEXT,
  notas_estrategicas TEXT,

  -- Metadados
  ativo BOOLEAN DEFAULT TRUE,
  ultima_atualizacao_perfil DATE,
  atualizado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Tabela de interações com atores:**

```sql
interacoes_ator (
  id UUID PRIMARY KEY,
  ator_id UUID REFERENCES atores_judiciario(id),
  processo_id UUID REFERENCES processos(id),
  data_interacao TIMESTAMPTZ,
  tipo TEXT,  -- "audiência", "despacho oral", "ligação", "petição respondida"
  descricao TEXT,
  resultado TEXT,
  aprendizado TEXT,  -- o que ficou de lição estratégica para o próximo caso
  registrado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Como a Donna usa esse dado:**

Quando uma nova movimentação é detectada em um processo, a Donna consulta o perfil do juiz daquela vara e complementa o raciocínio estratégico:

> "Despacho de saneamento publicado no processo X. O Juiz [Nome] tem perfil **legalista e rígido** — historicamente exige que vícios formais sejam corrigidos no prazo exato sem tolerância. Sugestão: cumprir integralmente o despacho, sem deixar nenhum ponto sem resposta. Não há histórico de concessão de prazo adicional nesse perfil."

***

## Motor 6 — Base de Conhecimento (RAG)

**Objetivo:** Armazenar e recuperar conhecimento semântico do escritório: playbooks, estratégias por tipo de caso, modelos de peças, doutrinas aplicadas, jurisprudências usadas e ensinamentos dos sócios.

**Tecnologia:** PostgreSQL + pgvector (busca vetorial diretamente no Supabase, sem banco vetorial separado).[^19][^20]

**Tabelas:**

```sql
base_conhecimento (
  id UUID PRIMARY KEY,
  tipo TEXT CHECK (tipo IN (
    'playbook','modelo_peca','jurisprudencia',
    'doutrina','estrategia','licao_aprendida',
    'rotina_forum','protocolo_interno'
  )),
  titulo TEXT,
  conteudo TEXT,
  tags TEXT[],
  area_direito TEXT,
  tribunal TEXT,
  autor_id UUID REFERENCES usuarios(id),
  embedding VECTOR(1536),  -- gerado pelo LLM
  aprovado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

fontes_documentais (
  id UUID PRIMARY KEY,
  titulo TEXT,
  tipo TEXT,  -- lei, regulamento, jurisprudência, artigo
  corpo TEXT,
  url TEXT,
  data_publicacao DATE,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Como funciona o RAG na Donna:**

1. Advogado faz pergunta estratégica ou a Donna detecta uma situação relevante.
2. Sistema gera embedding da pergunta/situação.
3. pgvector busca os 5 documentos mais semanticamente próximos da base.[^20]
4. LLM recebe: contexto do processo + perfil do juiz + documentos recuperados + regras de prazo.
5. LLM gera resposta estruturada com justificativa e ação sugerida.
6. Resposta é exibida com grau de confiança e fontes.

***

## Motor 7 — Estratégia e Ensino

**Objetivo:** Transformar dados operacionais em inteligência ativa, sugerir próximos passos, raciocinar sobre risco processual e treinar advogados juniores.

**Raciocínio em camadas (chain-of-thought interno):**

```
ENTRADA: evento processual + contexto do processo

PASSO 1: Identificar tipo de evento e impacto imediato
PASSO 2: Verificar prazo associado (determinístico)
PASSO 3: Consultar perfil do juiz/promotor (Motor 5)
PASSO 4: Recuperar playbooks e estratégias similares (Motor 6 RAG)
PASSO 5: Verificar indisponibilidades ativas (Motor 4)
PASSO 6: Gerar hipóteses de ação (1 a 3 opções)
PASSO 7: Classificar confiança e destacar incertezas
PASSO 8: Formatar resposta estruturada

SAÍDA: Fato → Regra aplicada → Ação sugerida → Grau de confiança
```

**Formato de resposta da Donna:**

```
📋 PROCESSO: [número CNJ]
🔔 EVENTO: [descrição do andamento]
📅 PRAZO: [X dias úteis — vence em DD/MM/AAAA]

🧠 ANÁLISE DA DONNA:
[Explicação em linguagem clara do que aconteceu e por quê importa]

⚡ AÇÃO SUGERIDA (confiança: Alta/Média/Baixa):
1. [Ação prioritária]
2. [Ação secundária]
3. [Ação de precaução, se aplicável]

🎯 CONTEXTO DO ATOR:
[Perfil do juiz/promotor relevante para esse momento]

⚠️ ATENÇÃO:
[Incertezas, pontos que precisam de validação humana]

📚 BASE UTILIZADA:
[Referências usadas: playbook, jurisprudência, regra CPC]
```

**Módulo de ensino:**

Quando um advogado junior executa uma tarefa, a Donna pode:
- Explicar **por que** aquele prazo é contado daquela forma[^10]
- Mostrar o fundamento legal da ação sugerida
- Apresentar como casos similares foram conduzidos no passado
- Alertar sobre erros comuns naquele tipo de situação

***

## Banco de Dados Completo

### Entidades principais

| Tabela | Descrição |
|---|---|
| `usuarios` | Advogados, estagiários, secretários do escritório |
| `clientes` | Pessoas físicas e jurídicas atendidas |
| `processos` | Carteira processual monitorada |
| `movimentacoes` | Histórico de andamentos |
| `publicacoes_diario` | Publicações capturadas no DJe/DJEN[^8][^9] |
| `prazos` | Prazos abertos, calculados e monitorados[^10] |
| `feriados_forense` | Calendário forense por tribunal[^15][^14] |
| `eventos_operacionais` | Radar: indisponibilidades, mudanças de rotina[^16] |
| `atores_judiciario` | Juízes, promotores, servidores — perfil e contatos |
| `interacoes_ator` | Histórico de experiências com cada ator |
| `base_conhecimento` | RAG: playbooks, modelos, estratégias[^19][^20] |
| `fontes_documentais` | Legislação, jurisprudência e doutrina |
| `tarefas` | Ações sugeridas ou criadas para cumprimento |
| `alertas_enviados` | Log de notificações disparadas |
| `regras_alerta` | Critérios configuráveis por advogado ou processo |
| `sessoes_donna` | Histórico de conversas e raciocínios da IA |

***

## Stack Tecnológica

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Backend | Node.js + Fastify | Leveza e integração fácil com n8n[^21] |
| Banco relacional | Supabase / PostgreSQL | Já usado em projetos similares, fácil integração[^21] |
| Banco vetorial | pgvector (extensão Postgres) | Sem precisar de serviço extra; funciona dentro do Supabase[^20][^19] |
| Orquestração | n8n | Fluxos de ingestão, alertas e rotinas diárias[^22][^23] |
| LLM principal | Claude 3.5/3.7 ou GPT-4o | Para raciocínio e estratégia |
| LLM classificação | GPT-4o-mini ou Claude Haiku | Para categorização rápida de eventos |
| WhatsApp | Evolution API + n8n | Alertas e interface conversacional[^21] |
| E-mail | Resend | Digest diário e alertas formais |
| Painel | Next.js ou Lovable | Dashboard com carteira e fila de prazos |
| Hospedagem | VPS Debian ou Railway | Controle, custo e compatibilidade[^24] |

***

## Fontes de Dados por Motor

| Motor | Fonte gratuita/aberta | Fonte comercial |
|---|---|---|
| Processos | DataJud API Pública (CNJ)[^5] | Jusbrasil API, JUDIT[^25][^26] |
| Diário Oficial | DJEN, DJe dos tribunais | Jusbrasil API Diários[^8][^9] |
| Prazos | Regras CPC + sites dos tribunais[^10][^15] | APIs de calendário forense[^27] |
| Radar | Sites dos tribunais, comunicados PJe[^16] | Serviços de monitoramento[^17] |
| Atores | Curadoria manual do escritório | — |
| Base de conhecimento | Documentos internos | Jurisprudência: Jusbrasil, Judit |

***

## Fases de Construção

### Fase 1 — Donna Operacional (MVP — 2 a 4 semanas)

Objetivo: monitorar processos, capturar diário, calcular prazos e avisar.

- [ ] Banco de dados completo (todas as tabelas)
- [ ] Cadastro de processos, clientes e responsáveis
- [ ] Integração com API de monitoramento processual[^3]
- [ ] Webhook receptor de movimentações[^4]
- [ ] Classificação automática de relevância (regras)
- [ ] Motor de prazos (CPC + feriados)[^10]
- [ ] Busca no Diário Oficial diariamente[^9]
- [ ] Alertas WhatsApp e e-mail via n8n[^22]
- [ ] Painel básico: carteira + prazos vencendo

### Fase 2 — Donna Tática (4 a 8 semanas)

Objetivo: adicionar inteligência, atores e RAG básico.

- [ ] Cadastro e curadoria de atores do judiciário
- [ ] Motor de Radar Operacional (comunicados e indisponibilidade)[^16]
- [ ] RAG com pgvector para playbooks internos[^20]
- [ ] Sugestões de próximos passos (LLM + contexto)
- [ ] Fila diária de prioridades no painel
- [ ] Consulta conversacional por WhatsApp ("Donna, o que vence hoje?")
- [ ] Log de aprendizados por processo/ator

### Fase 3 — Donna Estratégica (8+ semanas)

Objetivo: raciocínio estratégico, ensino e memória institucional.

- [ ] Perfil comportamental completo de atores com histórico
- [ ] Análise de padrão decisório por vara/juiz
- [ ] Sugestão estratégica baseada em perfil do ator[^1]
- [ ] Módulo de ensino para advogados juniores
- [ ] Memória semântica de casos anteriores do escritório
- [ ] Geração de minutas de petição com contexto
- [ ] Análise de risco processual por fase

***

## Considerações de Segurança e Ética

**Proteção dos dados:**
- Dados de clientes e processos são sensíveis — aplicar LGPD[^28]
- Perfis de juízes e promotores devem ficar em ambiente **exclusivamente interno**, sem exposição via API pública
- Logs de acesso e auditoria em todas as operações sensíveis

**Responsabilidade da IA:**
- A Donna sugere — o advogado decide[^2][^1]
- Toda saída deve indicar grau de confiança e listar incertezas
- Nunca tratar como definitiva a contagem de prazo sem validação humana em casos críticos
- Alertas de perda de prazo devem sempre alcançar um humano, independentemente do canal[^29]

**Qualidade da base de conhecimento:**
- Playbooks e estratégias devem ser aprovados manualmente antes de entrarem no RAG[^19]
- Jurisprudência deve ter data de origem — entendimentos podem ser superados
- Versionar regras de contagem de prazo conforme mudanças normativas (ex.: nova regra CNJ de 16/05/2025)[^13][^11]

***

## Estimativa de Investimento Inicial

| Item | Estimativa mensal |
|---|---|
| API de monitoramento processual | R$ 100–500 |
| Supabase (banco + pgvector) | R$ 0–100 (plan gratuito para início) |
| VPS para n8n + backend | R$ 50–150 |
| LLM (Claude/GPT tokens) | R$ 50–200 conforme volume |
| WhatsApp API (Evolution) | R$ 0 (self-hosted) |
| **Total fase 1** | **~R$ 200–950/mês** |

***

## Posicionamento como Produto

A Donna começa como ferramenta pessoal do advogado. Quando validada, pode ser comercializada como SaaS para outros escritórios — especialmente para advogados solo e escritórios de até 10 pessoas, que não têm budget para plataformas como Themis ou Thomson Reuters, mas precisam de inteligência operacional.[^27][^2][^18]

O diferencial competitivo está em três pontos que nenhuma plataforma atual combina: (1) inteligência sobre atores do judiciário com perfil comportamental curado, (2) radar operacional local (fóruns, cartórios, comunicados), e (3) raciocínio estratégico baseado na base de conhecimento do próprio escritório.

---

## References

1. [Agentes de IA no Direito: Como Funcionam e Como Usá ...](https://juridicoagil.com/inteligencia-artificial/agentes-de-ia-no-direito-como-funcionam-e-como-usa-los-na-pratica-juridica/) - Gestão de prazos e processos: monitoram andamentos processuais e notificações automaticamente;; Elab...

2. [Jurídico AI: Inteligência Artificial para Advogados](https://juridico.ai) - Com a Jurídico AI, profissionais do Direito podem automatizar tarefas repetitivas e consumir menos t...

3. [Monitoramento de processos](https://api.jusbrasil.com.br/docs/monitoramento_processos/index.html) - O módulo de monitoramento permite o registro de processos para o acompanhamento de atualizações nos ...

4. [Movimentações | Documentação de integração via API](https://api.jusbrasil.com.br/docs/monitoramento_processos/movimentacoes.html) - As novas movimentações detectadas nos processos monitorados são enviadas diariamente via chamada web...

5. [API Pública | Datajud-Wiki - CNJ](https://datajud-wiki.cnj.jus.br/api-publica/) - A API Pública do Datajud é uma ferramenta que permite o acesso público aos metadados de processos ju...

6. [Endpoints | Datajud-Wiki - CNJ](https://datajud-wiki.cnj.jus.br/api-publica/endpoints/) - A API Pública do Datajud oferece várias rotas para pesquisa de informações processuais devido à natu...

7. [Frequências | Documentação de integração via API](https://api.jusbrasil.com.br/docs/referencias/frequencia.html) - As novas movimentações detectadas nos processos monitorados são enviadas via chamada webhook diariam...

8. [Diários Oficiais | Documentação de integração via API](https://api.jusbrasil.com.br/docs/diarios_oficiais/index.html) - Diários Oficiais#. O módulo de Diários Oficiais permite acessar e consultar dados de diários judicia...

9. [Busca em diários | Documentação de integração via API](https://api.jusbrasil.com.br/docs/diarios_oficiais/busca.html) - Busca em diários#. Retorna uma coleção de documentos obtidos através de buscas textuais realizadas s...

10. [Como funciona a contagem de prazos processuais no CPC](https://preambulo.com.br/blog/contagem-prazos-cpc/) - Entenda como funciona a contagem de prazos CPC, quais as mudanças em relação ao CPC anterior e como ...

11. [Novas regras de contagem de prazos processuais terão ...](https://ww2.trt2.jus.br/noticias/noticias/noticia/novas-regras-de-contagem-de-prazos-processuais-terao-efeito-a-partir-de-16-5) - Normas do Conselho Nacional de Justiça (CNJ) alteram, a partir de 16/5, a contagem de todos os prazo...

12. [art. 3º da Resolução CNJ nº 455/2022](https://atos.cnj.jus.br/atos/detalhar/4509) - § 1o As indisponibilidades que eventualmente ocorram entre meia-noite e 6 (seis) horas dos dias de e...

13. [CNJ alerta: novas regras de contagem de prazos valem a ...](https://www.migalhas.com.br/quentes/429942/cnj-alerta-novas-regras-de-contagem-de-prazos-valem-a-partir-de-16-5) - Nova regulamentação determina que todos os prazos processuais sejam contados com base nas plataforma...

14. [Feriados no Poder Judiciário do RS - Tribunal de Justiça](https://www.tjrs.jus.br/novo/servicos-administrativos/apoio-jurisdicional/feriados/) - Não haverá expediente no Tribunal de Justiça nem nos serviços forenses de primeira instância durante...

15. [Calendário Forense](https://www.jfrn.jus.br/institucional/calendario-forense) - 1 de janeiro de 2026quinta-feira. Até 06 de janeiro (terça-feira) - Recesso Judiciário (Lei Federal ...

16. [PJe](https://www.tst.jus.br/web/pje/inicio/-/asset_publisher/Acc2/content/id/26560950) - Considera-se indisponibilidade do sistema PJe a falta de oferta ao público externo, diretamente ou p...

17. [Aviso de indisponibilidade](https://ww2.trt2.jus.br/contato/suporte-tecnico-de-ti/aviso-de-indisponibilidade) - A Secretaria de Tecnologia da Informação e Comunicação informa que a ferramenta utilizada para regis...

18. [Confira 8 ferramentas de IA que facilitam a rotina dos ...](https://www.migalhas.com.br/quentes/424264/confira-8-ferramentas-de-ia-que-facilitam-a-rotina-dos-advogados) - Voltada para a gestão da rotina jurídica, a plataforma localiza automaticamente processos utilizando...

19. [Curso RAG Corporativo | pgvector e Busca Vetorial Segura](https://4linux.com.br/cursos/rag-corporativo-governado-com-llms-open-source/) - Domine a arquitetura de RAG Corporativo com PostgreSQL e pgvector. Treinamento de busca vetorial, em...

20. [O que é pgvector?](https://www.databricks.com/br/blog/what-is-pgvector) - pgvector é uma extensão do PostgreSQL que permite o armazenamento de vetores e a busca por similarid...

21. [Dev Challenge: AI Agent for WhatsApp with n8n, Supabase ...](https://www.youtube.com/watch?v=-XGbOWV7HQw) - Aproveite os cursos pagos da Rocketseat, liberados gratuitamente até 03/11 https://rseat.in/aproveit...

22. [Automatizar tarefas jurídicas com n8n para advogados](https://horadecodar.com.br/automatizar-tarefas-juridicas-n8n-advogados/) - O n8n é uma poderosa ferramenta de automação que permite criar fluxos de trabalho inteligentes, inte...

23. [⚖️🤖 Como automatizamos a qualificação de leads ...](https://grupo.semcodar.com.br/c/dicas-contribuicoes/como-automatizamos-a-qualificacao-de-leads-trabalhistas-via-whatsapp-com-ia-supabase-e-n8n) - Isso facilita o acesso e o histórico para os advogados. 5. Automação com n8n. Com o n8n, criamos flu...

24. [Qual a diferença de usar windows, linux ou debian?](https://www.perplexity.ai/search/4781b235-5438-4bdc-914d-d765f5e3deb7) - A diferença principal é: Windows é um sistema proprietário da Microsoft, Linux é a “família” de sist...

25. [JUDIT | Sua Infraestrutura de Dados Jurídicos](https://judit.io) - A JUDIT API conecta sua empresa aos tribunais brasileiros em tempo real. Consulte processos por CPF,...

26. [Documentação de integração via API](https://api.jusbrasil.com.br/docs/index.html) - Monitoramento de processos · Registrando processos para monitoramento · Listando processos monitorad...

27. [Software de Gestão de Prazos Processuais 2026: Comparativo](https://trackjud.com.br/blog/pt-br/software-gestao-prazos-processuais) - Software de gestão de prazos é mais focado: calcula prazos automaticamente, mantém calendário forens...

28. [IA e Processo Civil: Desafios Constitucionais](https://legale.com.br/blog/ia-e-processo-civil-desafios-constitucionais/) - A leitura automática após o decurso do prazo legal exige uma gestão de prazos cirúrgica por parte do...

29. [Gestão de prazos sem erros: como usar a tecnologia a seu ...](https://www.thomsonreuters.com.br/pt/juridico/blog/tecnologia-gestao-prazos.html) - Controle prazos com Legal One e HighQ: soluções que eliminam erros, automatizam tarefas e posicionam...

