-- =======================================================
-- DONNA — SCHEMA SQL COMPLETO PARA SUPABASE (PRODUÇÃO V2.1)
-- Banco de Dados: PostgreSQL com extensão pgvector e RLS JWT
-- Autor: Arquiteto de Software Sênior & Especialista Jurídico
-- =======================================================

-- 1. EXTENSÕES E CONFIGURAÇÕES INICIAIS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector"; -- Necessário para buscas RAG no Supabase (pgvector)

-- Limpar tabelas existentes para garantir reentrabilidade
DROP TABLE IF EXISTS auditoria_prazo CASCADE;
DROP TABLE IF EXISTS alertas_enviados CASCADE;
DROP TABLE IF EXISTS regras_alerta CASCADE;
DROP TABLE IF EXISTS tarefas CASCADE;
DROP TABLE IF EXISTS mensagens_sessao CASCADE;
DROP TABLE IF EXISTS sessoes_donna CASCADE;
DROP TABLE IF EXISTS interacoes_ator CASCADE;
DROP TABLE IF EXISTS prazos CASCADE;
DROP TABLE IF EXISTS publicacoes_diario CASCADE;
DROP TABLE IF EXISTS movimentacoes CASCADE;
DROP TABLE IF EXISTS processos CASCADE;
DROP TABLE IF EXISTS atores_judiciario CASCADE;
DROP TABLE IF EXISTS eventos_operacionais CASCADE;
DROP TABLE IF EXISTS feriados_forense CASCADE;
DROP TABLE IF EXISTS base_conhecimento CASCADE;
DROP TABLE IF EXISTS fontes_documentais CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS fila_processamento_webhook CASCADE;
DROP TABLE IF EXISTS escritorios CASCADE;

-- 2. ENUMS PERSONALIZADOS
CREATE TYPE tipo_prioridade AS ENUM ('urgente', 'alta', 'media', 'baixa');
CREATE TYPE tipo_status_prazo AS ENUM ('aberto', 'cumprido', 'vencido', 'suspenso', 'prorrogado');
CREATE TYPE tipo_abrangencia_feriado AS ENUM ('nacional', 'estadual', 'municipal', 'vara_especifica');
CREATE TYPE tipo_evento_operacional AS ENUM (
  'indisponibilidade_sistema',
  'mudanca_expediente',
  'aviso_forum',
  'aviso_cartorio',
  'recesso_nao_previsto',
  'mudanca_rotina',
  'noticia_relevante'
);
CREATE TYPE tipo_ator_judiciario AS ENUM (
  'juiz', 'desembargador', 'ministro',
  'promotor', 'defensor_publico',
  'servidor_cartorio', 'oficial_justica',
  'registrador', 'tabeliao', 'perito'
);
CREATE TYPE tipo_conhecimento AS ENUM (
  'playbook', 'modelo_peca', 'jurisprudencia',
  'doutrina', 'estrategia', 'licao_aprendida',
  'rotina_forum', 'protocolo_interno'
);
CREATE TYPE tipo_usuario AS ENUM ('socio', 'associado', 'junior', 'estagiario', 'secretario', 'admin');
CREATE TYPE tipo_status_processamento AS ENUM ('pendente', 'processando', 'processado', 'falha');
CREATE TYPE tipo_sync_status AS ENUM ('sincronizado', 'pendente', 'erro');

-- Novos Enums dedicados para evitar drift semântico (Donna V2.1)
CREATE TYPE tipo_canal_publicacao AS ENUM ('djen', 'domicilio', 'outro');
CREATE TYPE tipo_comunicacao_cnj AS ENUM ('citacao', 'intimacao', 'outra_comunicacao');
CREATE TYPE tipo_status_confirmacao AS ENUM ('confirmado', 'nao_confirmado', 'nao_aplicavel');
CREATE TYPE tipo_natureza_destinatario AS ENUM ('pj_privado', 'pj_publico', 'pf', 'nao_aplicavel');
CREATE TYPE tipo_perfil_decisorio AS ENUM ('legalista', 'garantista', 'ativista', 'conservador', 'pragmatico', 'outro');
CREATE TYPE tipo_temperamento AS ENUM ('rigido', 'flexivel', 'imprevisivel', 'colaborativo');
CREATE TYPE tipo_fonte_perfil AS ENUM ('experiencia_socio', 'audiencia_real', 'relato_servidor', 'jurisprudencia_analisada', 'colega_externo');


-- 3. TABELA: ESCRITORIOS (Multi-Tenancy Tenant Principal)
CREATE TABLE escritorios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cnpj TEXT UNIQUE,
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserir escritório padrão para retrocompatibilidade local e seed automática
INSERT INTO escritorios (id, nome, cnpj) 
VALUES ('da39b5b2-3864-44df-be9b-e7b8c2d82910', 'Escritório Geral Donna S.A.', '00.000.000/0001-00')
ON CONFLICT (id) DO NOTHING;

-- 4. TABELA: USUARIOS (Integrada ao auth.users do Supabase)
CREATE TABLE usuarios (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  tipo_perfil tipo_usuario NOT NULL DEFAULT 'junior',
  oab TEXT, -- Número da OAB se for advogado
  whatsapp TEXT,
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABELA: CLIENTES
CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  nome TEXT NOT NULL,
  tipo_pessoa CHAR(1) NOT NULL CHECK (tipo_pessoa IN ('F', 'J')), -- F = Física, J = Jurídica
  documento TEXT NOT NULL, 
  email TEXT,
  telefone TEXT,
  whatsapp TEXT,
  contato_principal TEXT,
  observacoes TEXT,
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Restrição composta por tenant
  CONSTRAINT uq_cliente_documento_tenant UNIQUE (escritorio_id, documento)
);

-- 6. TABELA: ATORES JUDICIARIO (Profiling estratégico de Magistrados)
CREATE TABLE atores_judiciario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  tipo tipo_ator_judiciario NOT NULL,
  nome TEXT NOT NULL,
  nome_usual TEXT,
  tribunal TEXT NOT NULL, -- Ex: TJSP, TRF3, TRT2, TJPB
  comarca TEXT, -- Cidade / Foro
  vara TEXT, -- Vara ou Secretaria
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
  
  -- Perfil comportamental (Confidencialidade estrita do escritório)
  perfil_decisorio tipo_perfil_decisorio DEFAULT 'outro',
  temperamento tipo_temperamento,
  estilo_audiencia TEXT,
  receptividade_acordos TEXT,
  pontos_positivos TEXT[], -- Tags/frases curtas
  pontos_atencao TEXT[], -- Tags/frases curtas
  preferencias_processuais TEXT, -- Ex: "prefere petições curtas"
  historico_decisoes_relevantes TEXT,
  notas_estrategicas TEXT,
  
  -- Governança de Perfis Comportamentais (Fidelidade & Proveniência) (Donna V2.1)
  fonte_informacao_perfil tipo_fonte_perfil DEFAULT 'experiencia_socio',
  grau_confianca_perfil INTEGER CHECK (grau_confianca_perfil BETWEEN 1 AND 5) DEFAULT 3,
  
  -- Metadados
  ativo BOOLEAN DEFAULT TRUE,
  ultima_atualizacao_perfil DATE DEFAULT CURRENT_DATE,
  atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABELA: PROCESSOS
CREATE TABLE processos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  numero_cnj TEXT NOT NULL CHECK (length(numero_cnj) >= 20), -- Validação CNJ
  tribunal TEXT NOT NULL,
  comarca TEXT,
  vara TEXT,
  juiz_id UUID REFERENCES atores_judiciario(id) ON DELETE SET NULL,
  classe TEXT,
  assunto TEXT,
  rito TEXT,
  fase_processual TEXT,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  advogado_responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  prioridade tipo_prioridade NOT NULL DEFAULT 'media',
  status TEXT DEFAULT 'ativo',
  api_monitor_id TEXT, -- ID de rastreamento externo
  observacoes TEXT,
  
  -- Controle de Sincronismo Offline-First (Donna V2.1)
  sync_status tipo_sync_status NOT NULL DEFAULT 'sincronizado',
  sync_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Roteamento de concorrência por tenant
  CONSTRAINT uq_processo_cnj_tenant UNIQUE (escritorio_id, numero_cnj)
);

-- 8. TABELA: MOVIMENTACOES (Trilha de andamentos)
CREATE TABLE movimentacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  data_evento TIMESTAMPTZ NOT NULL,
  titulo TEXT NOT NULL,
  descricao TEXT,
  tipo_evento TEXT, -- Classificação temática
  grau_relevancia tipo_prioridade NOT NULL DEFAULT 'media',
  raw_payload JSONB, -- Payload bruto recebido
  processado BOOLEAN DEFAULT FALSE,
  status_processamento tipo_status_processamento NOT NULL DEFAULT 'pendente',
  tentativas INTEGER DEFAULT 0,
  log_erro TEXT,
  
  -- Controle de Sincronismo Offline-First
  sync_status tipo_sync_status NOT NULL DEFAULT 'sincronizado',
  sync_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. TABELA: PUBLICACOES DIARIO
CREATE TABLE publicacoes_diario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  processo_id UUID REFERENCES processos(id) ON DELETE SET NULL,
  termo_busca TEXT, -- OAB ou Processo
  data_disponibilizacao DATE NOT NULL,
  data_publicacao DATE NOT NULL, -- D1 útil seguinte
  data_inicio_prazo DATE, -- D2 útil após publicação
  titulo TEXT,
  trecho TEXT,
  corpo TEXT NOT NULL,
  tipo TEXT, -- Despacho, Sentença, Intimação
  url_original TEXT,
  prazo_identificado INTEGER, -- Dias sugeridos pelo parser
  processado BOOLEAN DEFAULT FALSE,
  status_processamento tipo_status_processamento NOT NULL DEFAULT 'pendente',
  tentativas INTEGER DEFAULT 0,
  log_erro TEXT,
  
  -- Controle de Sincronismo Offline-First
  sync_status tipo_sync_status NOT NULL DEFAULT 'sincronizado',
  sync_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. TABELA: PRAZOS (Comunicação CNJ & Parâmetros Finais)
CREATE TABLE prazos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  movimentacao_id UUID REFERENCES movimentacoes(id) ON DELETE SET NULL,
  publicacao_id UUID REFERENCES publicacoes_diario(id) ON DELETE SET NULL,
  descricao TEXT NOT NULL,
  tipo_prazo TEXT, -- Ex: Contestação, Apelação, Réplica
  
  -- Matriz de Regras CNJ de Contagem (Enums Dedicados V2.1)
  canal_publicacao tipo_canal_publicacao NOT NULL DEFAULT 'djen',
  tipo_comunicacao tipo_comunicacao_cnj NOT NULL DEFAULT 'intimacao',
  status_confirmacao tipo_status_confirmacao NOT NULL DEFAULT 'nao_aplicavel',
  natureza_destinatario tipo_natureza_destinatario NOT NULL DEFAULT 'nao_aplicavel',
  
  data_publicacao DATE NOT NULL,
  data_inicio_contagem DATE NOT NULL,
  prazo_dias INTEGER NOT NULL CHECK (prazo_dias > 0),
  data_vencimento DATE, -- Null se PJ privado sem citação confirmada
  dias_uteis_restantes INTEGER,
  status tipo_status_prazo NOT NULL DEFAULT 'aberto',
  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  observacoes TEXT, 
  
  -- Controle de Sincronismo Offline-First
  sync_status tipo_sync_status NOT NULL DEFAULT 'sincronizado',
  sync_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. TABELA: AUDITORIA DE PRAZOS (Rastreabilidade das etapas do Motor 3)
CREATE TABLE auditoria_prazo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  prazo_id UUID NOT NULL REFERENCES prazos(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL, -- disponibilizacao, publicacao, suspensao_indisponibilidade, feriado_pulado, consolidado
  descricao TEXT NOT NULL,
  valor_base TEXT,
  valor_resultado TEXT,
  fonte_regra TEXT,
  
  -- Controle de Sincronismo Offline-First (Donna V2.1)
  sync_status tipo_sync_status NOT NULL DEFAULT 'sincronizado',
  sync_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. TABELA: FERIADOS FORENSE
CREATE TABLE feriados_forense (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  data DATE NOT NULL,
  descricao TEXT NOT NULL,
  tribunal TEXT DEFAULT 'nacional', -- Sigla ou 'nacional'
  abrangencia tipo_abrangencia_feriado NOT NULL DEFAULT 'nacional',
  municipio TEXT, -- Comarca
  vara_especifica TEXT,
  fonte TEXT, -- Link de portaria
  tipo TEXT CHECK (tipo IN ('feriado', 'recesso', 'suspensao', 'indisponibilidade')) DEFAULT 'feriado',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. TABELA: EVENTOS OPERACIONAIS (Radar de Indisponibilidades PJe)
CREATE TABLE eventos_operacionais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  tipo tipo_evento_operacional NOT NULL,
  tribunal TEXT NOT NULL,
  vara TEXT,
  titulo TEXT NOT NULL,
  descricao TEXT,
  data_inicio TIMESTAMPTZ NOT NULL,
  data_fim TIMESTAMPTZ,
  impacto_prazos BOOLEAN DEFAULT FALSE,
  fonte_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. TABELA: INTERACOES ATOR (Inteligência tática de Gabinetes)
CREATE TABLE interacoes_ator (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  ator_id UUID NOT NULL REFERENCES atores_judiciario(id) ON DELETE CASCADE,
  processo_id UUID REFERENCES processos(id) ON DELETE SET NULL,
  data_interacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo TEXT NOT NULL, -- audiencia, despacho oral, ligacao
  descricao TEXT NOT NULL,
  resultado TEXT,
  aprendizado TEXT, -- Lógica comportamental extraída
  registrado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. TABELA: BASE DE CONHECIMENTO (RAG pgvector de Playbooks)
CREATE TABLE base_conhecimento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  tipo tipo_conhecimento NOT NULL,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  tags TEXT[],
  area_direito TEXT NOT NULL,
  tribunal TEXT,
  autor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  embedding VECTOR(1536), -- 1536D nativo do Gemini Embedding 2
  aprovado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. TABELA: FONTES DOCUMENTAIS
CREATE TABLE fontes_documentais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  corpo TEXT NOT NULL,
  url TEXT,
  data_publicacao DATE,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. TABELA: TAREFAS (Donna sugestões operacionais)
CREATE TABLE tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  prazo_id UUID REFERENCES prazos(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  descricao TEXT,
  prioridade tipo_prioridade NOT NULL DEFAULT 'media',
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluida', 'cancelada')),
  responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  sugerida_por_ia BOOLEAN DEFAULT FALSE,
  justificativa_ia TEXT,
  data_vencimento TIMESTAMPTZ,
  concluida_em TIMESTAMPTZ,
  
  -- Sincronismo
  sync_status tipo_sync_status NOT NULL DEFAULT 'sincronizado',
  sync_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. TABELA: REGRAS ALERTA
CREATE TABLE regras_alerta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  processo_id UUID REFERENCES processos(id) ON DELETE CASCADE,
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email', 'ambos')),
  dias_antecedencia INTEGER[] DEFAULT '{1,2,5}',
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. TABELA: ALERTAS ENVIADOS
CREATE TABLE alertas_enviados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  processo_id UUID REFERENCES processos(id) ON DELETE SET NULL,
  prazo_id UUID REFERENCES prazos(id) ON DELETE SET NULL,
  tarefa_id UUID REFERENCES tarefas(id) ON DELETE SET NULL,
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email')),
  conteudo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enviado' CHECK (status IN ('pendente', 'enviado', 'falha')),
  log_erro TEXT,
  enviado_em TIMESTAMPTZ DEFAULT NOW()
);

-- 20. TABELA: SESSOES DONNA (Chat Strategic Header)
CREATE TABLE sessoes_donna (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  processo_id UUID REFERENCES processos(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL DEFAULT 'Nova conversa jurídica',
  
  -- Controle de Sincronismo Offline-First (Donna V2.1)
  sync_status tipo_sync_status NOT NULL DEFAULT 'sincronizado',
  sync_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 21. TABELA: MENSAGENS SESSÃO (Normalização Canônica de Chat & Contexto)
CREATE TABLE mensagens_sessao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  sessao_id UUID NOT NULL REFERENCES sessoes_donna(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  sequence_number INTEGER DEFAULT 0,
  token_count_estimate INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Controle de Sincronismo Offline-First (Donna V2.1)
  sync_status tipo_sync_status NOT NULL DEFAULT 'sincronizado',
  sync_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 22. TABELA: FILA PROCESSAMENTO WEBHOOK (Fila assíncrona robusta)
CREATE TABLE fila_processamento_webhook (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  tipo_evento TEXT NOT NULL CHECK (tipo_evento IN ('movimentacao', 'diario')),
  payload_bruto JSONB NOT NULL,
  status_processamento tipo_status_processamento NOT NULL DEFAULT 'pendente',
  tentativas INTEGER DEFAULT 0,
  log_erro TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- INDEXAÇÃO E OTIMIZAÇÃO POR TENANT
-- ==========================================

-- Índices de Integridade e Chaves Estrangeiras Compostos por Tenant
CREATE INDEX idx_processos_tenant_cnj ON processos(escritorio_id, numero_cnj);
CREATE INDEX idx_prazos_tenant_advogado ON prazos(escritorio_id, responsavel_id, status);
CREATE INDEX idx_mensagens_tenant_tempo ON mensagens_sessao(sessao_id, created_at ASC, sequence_number ASC);
CREATE INDEX idx_fila_webhook_tenant_status ON fila_processamento_webhook(escritorio_id, status_processamento, created_at DESC);
CREATE INDEX idx_auditoria_prazo_tenant ON auditoria_prazo(escritorio_id, prazo_id);

CREATE INDEX idx_processos_cliente ON processos(escritorio_id, cliente_id);
CREATE INDEX idx_processos_juiz ON processos(escritorio_id, juiz_id);
CREATE INDEX idx_movimentacoes_processo ON movimentacoes(escritorio_id, processo_id);
CREATE INDEX idx_publicacoes_diario_processo ON publicacoes_diario(escritorio_id, processo_id);
CREATE INDEX idx_tarefas_processo ON tarefas(escritorio_id, processo_id);
CREATE INDEX idx_sessoes_donna_usuario ON sessoes_donna(escritorio_id, usuario_id);

-- Índices de Negócio e Consulta Frequente
CREATE INDEX idx_movimentacoes_data ON movimentacoes(escritorio_id, data_evento DESC);
CREATE INDEX idx_prazos_vencimento ON prazos(escritorio_id, data_vencimento ASC) WHERE status = 'aberto';
CREATE INDEX idx_feriados_data ON feriados_forense(escritorio_id, data);
CREATE INDEX idx_eventos_operacionais_tempo ON eventos_operacionais(escritorio_id, data_inicio DESC);

-- Índices vetoriais HNSW pgvector (Similaridade por Cosseno)
CREATE INDEX idx_base_conhecimento_embedding ON base_conhecimento USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_fontes_documentais_embedding ON fontes_documentais USING hnsw (embedding vector_cosine_ops);


-- ==========================================
-- TRIGGERS PARA UPDATED_AT AUTOMÁTICO
-- ==========================================

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_usuarios BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_clientes BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_atores BEFORE UPDATE ON atores_judiciario FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_processos BEFORE UPDATE ON processos FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_prazos BEFORE UPDATE ON prazos FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_base_conhecimento BEFORE UPDATE ON base_conhecimento FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_tarefas BEFORE UPDATE ON tarefas FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_sessoes BEFORE UPDATE ON sessoes_donna FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_fila BEFORE UPDATE ON fila_processamento_webhook FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_movs BEFORE UPDATE ON movimentacoes FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_diarios BEFORE UPDATE ON publicacoes_diario FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();


-- ==========================================
-- RAG: FUNÇÃO DE BUSCA SEMÂNTICA (pgvector)
-- ==========================================
CREATE OR REPLACE FUNCTION buscar_conhecimento(
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count INT,
  filtro_tipo TEXT DEFAULT NULL,
  filtro_area TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  tipo tipo_conhecimento,
  titulo TEXT,
  conteudo TEXT,
  tags TEXT[],
  area_direito TEXT,
  tribunal TEXT,
  similaridade FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bc.id,
    bc.tipo,
    bc.titulo,
    bc.conteudo,
    bc.tags,
    bc.area_direito,
    bc.tribunal,
    1 - (bc.embedding <=> query_embedding) AS similaridade
  FROM base_conhecimento bc
  WHERE 
    bc.aprovado = TRUE
    AND (filtro_tipo IS NULL OR bc.tipo = filtro_tipo::tipo_conhecimento)
    AND (filtro_area IS NULL OR bc.area_direito = filtro_area)
    AND (1 - (bc.embedding <=> query_embedding)) > match_threshold
  ORDER BY bc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;


-- =======================================================
-- RAG & TRABALHO DE FILAS: FUNÇÕES DE OBTENÇÃO & RESERVA
-- =======================================================

CREATE OR REPLACE FUNCTION obter_e_reservar_movimentacao()
RETURNS TABLE (
  id UUID,
  processo_id UUID,
  data_evento TIMESTAMPTZ,
  titulo TEXT,
  descricao TEXT,
  raw_payload JSONB
) AS $$
DECLARE
  r_id UUID;
BEGIN
  SELECT m.id INTO r_id
  FROM movimentacoes m
  WHERE m.status_processamento = 'pendente'
  ORDER BY m.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF r_id IS NOT NULL THEN
    UPDATE movimentacoes
    SET status_processamento = 'processando',
        tentativas = tentativas + 1
    WHERE movimentacoes.id = r_id;
    
    RETURN QUERY
    SELECT m.id, m.processo_id, m.data_evento, m.titulo, m.descricao, m.raw_payload
    FROM movimentacoes m
    WHERE m.id = r_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION obter_e_reservar_diario()
RETURNS TABLE (
  id UUID,
  processo_id UUID,
  termo_busca TEXT,
  data_disponibilizacao DATE,
  data_publicacao DATE,
  data_inicio_prazo DATE,
  titulo TEXT,
  trecho TEXT,
  corpo TEXT,
  tipo TEXT,
  url_original TEXT,
  prazo_identificado INTEGER
) AS $$
DECLARE
  r_id UUID;
BEGIN
  SELECT p.id INTO r_id
  FROM publicacoes_diario p
  WHERE p.status_processamento = 'pendente'
  ORDER BY p.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF r_id IS NOT NULL THEN
    UPDATE publicacoes_diario
    SET status_processamento = 'processando',
        tentativas = tentativas + 1
    WHERE publicacoes_diario.id = r_id;
    
    RETURN QUERY
    SELECT p.id, p.processo_id, p.termo_busca, p.data_disponibilizacao, p.data_publicacao, p.data_inicio_prazo, p.titulo, p.trecho, p.corpo, p.tipo, p.url_original, p.prazo_identificado
    FROM publicacoes_diario p
    WHERE p.id = r_id;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- =======================================================
-- SEGURANÇA E LGPD (CONFIGURAÇÕES DE POLÍTICA - RLS JWT)
-- =======================================================

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE atores_judiciario ENABLE ROW LEVEL SECURITY;
ALTER TABLE processos ENABLE ROW LEVEL SECURITY;
ALTER TABLE prazos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_prazo ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_conhecimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessoes_donna ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens_sessao ENABLE ROW LEVEL SECURITY;
ALTER TABLE fila_processamento_webhook ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicacoes_diario ENABLE ROW LEVEL SECURITY;

-- Isolamento lógico sênior via decodificação de claims JWT de Tenant
CREATE POLICY usuarios_tenant_isolation ON usuarios FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY clientes_tenant_isolation ON clientes FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY atores_tenant_isolation ON atores_judiciario FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY processos_tenant_isolation ON processos FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY prazos_tenant_isolation ON prazos FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY auditoria_tenant_isolation ON auditoria_prazo FOR SELECT TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY base_conhecimento_tenant_isolation ON base_conhecimento FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY sessoes_tenant_isolation ON sessoes_donna FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY mensagens_tenant_isolation ON mensagens_sessao FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY fila_tenant_isolation ON fila_processamento_webhook FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY movimentacoes_tenant_isolation ON movimentacoes FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY publicacoes_diario_tenant_isolation ON publicacoes_diario FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

-- =========================================================================
-- CONTROLE E AUDITORIA ADMINISTRATIVA CROSS-TENANT (BYPASS PARA SUPERADMIN)
-- =========================================================================
-- Permite que usuários com claim 'role' = 'superadmin' acessem dados de qualquer escritório
-- apenas para fins de suporte técnico e auditoria operacional, com governança restrita.

CREATE POLICY usuarios_superadmin_bypass ON usuarios FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY clientes_superadmin_bypass ON clientes FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY atores_superadmin_bypass ON atores_judiciario FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY processos_superadmin_bypass ON processos FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY prazos_superadmin_bypass ON prazos FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY auditoria_superadmin_bypass ON auditoria_prazo FOR SELECT TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY base_conhecimento_superadmin_bypass ON base_conhecimento FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY sessoes_superadmin_bypass ON sessoes_donna FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY mensagens_superadmin_bypass ON mensagens_sessao FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY fila_superadmin_bypass ON fila_processamento_webhook FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY movimentacoes_superadmin_bypass ON movimentacoes FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

CREATE POLICY publicacoes_diario_superadmin_bypass ON publicacoes_diario FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');
