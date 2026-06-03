-- =========================================================================
-- MIGRATION: JUDGES COGNITIVE PROFILING & SENTENCE SCRAPING STORAGE
-- =========================================================================

-- Tabela para armazenar as decisões judiciais brutas dos juízes raspadas do DJe/TJPB
CREATE TABLE IF NOT EXISTS raw_decisoes_magistrados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  magistrado_id UUID NOT NULL REFERENCES atores_judiciario(id) ON DELETE CASCADE,
  numero_processo VARCHAR(30) NOT NULL,
  data_decisao DATE NOT NULL,
  tipo_decisao VARCHAR(100) NOT NULL, -- Ex: 'Sentença', 'Acórdão'
  resultado VARCHAR(50) NOT NULL, -- Ex: 'procedente', 'improcedente', 'parcial', 'outro'
  area VARCHAR(100) NOT NULL, -- Ex: 'tributário', 'trabalhista', 'família', 'civil'
  conteudo_decisao TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL,
  
  -- Garante idempotência: mesmo juiz, processo e tipo de decisão na mesma data não se repetem
  CONSTRAINT uq_magistrado_processo_decisao UNIQUE (magistrado_id, numero_processo, tipo_decisao, data_decisao)
);

-- Tabela para armazenar snapshots históricos dos perfis cognitivos para a timeline de consistência
CREATE TABLE IF NOT EXISTS historico_perfis_magistrados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  magistrado_id UUID NOT NULL REFERENCES atores_judiciario(id) ON DELETE CASCADE,
  perfil_decisorio tipo_perfil_decisorio NOT NULL,
  temperamento tipo_temperamento NOT NULL,
  grau_confianca INTEGER NOT NULL,
  decisoes_analisadas INTEGER NOT NULL,
  data_registro DATE DEFAULT CURRENT_DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL
);

-- Habilitar RLS em ambas para isolamento de tenant
ALTER TABLE raw_decisoes_magistrados ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_perfis_magistrados ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para raw_decisoes_magistrados baseadas em claims de escritório
CREATE POLICY raw_decisoes_magistrados_tenant_isolation ON raw_decisoes_magistrados FOR ALL TO authenticated
  USING (
    magistrado_id IN (
      SELECT id FROM atores_judiciario WHERE escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid
    )
  )
  WITH CHECK (
    magistrado_id IN (
      SELECT id FROM atores_judiciario WHERE escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid
    )
  );

-- Políticas de RLS para historico_perfis_magistrados baseadas em claims de escritório
CREATE POLICY historico_perfis_magistrados_tenant_isolation ON historico_perfis_magistrados FOR ALL TO authenticated
  USING (
    magistrado_id IN (
      SELECT id FROM atores_judiciario WHERE escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid
    )
  )
  WITH CHECK (
    magistrado_id IN (
      SELECT id FROM atores_judiciario WHERE escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid
    )
  );
