-- =========================================================================
-- MIGRATION: OFFICE ONBOARDING, PLANS, SUBSCRIPTIONS & CERTIFICATES STORAGE
-- =========================================================================

-- 1. Estender a tabela escritorios com campos adicionais de onboarding
ALTER TABLE escritorios ADD COLUMN IF NOT EXISTS oab_seccional VARCHAR(10);
ALTER TABLE escritorios ADD COLUMN IF NOT EXISTS endereco TEXT;

-- 2. Tabela de Planos de Serviço
CREATE TABLE IF NOT EXISTS planos (
  id VARCHAR(50) PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  limite_usuarios INTEGER NOT NULL, -- -1 = ilimitado
  limite_queries_mensais INTEGER NOT NULL, -- -1 = ilimitado
  rag_habilitado BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL
);

-- 3. Tabela de Assinaturas dos Escritórios
CREATE TABLE IF NOT EXISTS assinaturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE,
  plano_id VARCHAR(50) NOT NULL REFERENCES planos(id),
  status VARCHAR(50) DEFAULT 'active' NOT NULL, -- 'active' | 'suspended' | 'canceled'
  vigencia_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim DATE,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL
);

-- 4. Tabela de Armazenamento de Certificados Digitais Criptografados (Web Crypto AES-GCM + PBKDF2)
CREATE TABLE IF NOT EXISTS certificados_escritorios (
  escritorio_id UUID PRIMARY KEY REFERENCES escritorios(id) ON DELETE CASCADE,
  encrypted_pfx TEXT NOT NULL, -- Base64 do ciphertext criptografado no browser
  salt TEXT NOT NULL, -- Base64 do salt derivado via PBKDF2 no browser
  iv TEXT NOT NULL, -- Base64 do IV dinâmico de 12 bytes do AES-GCM
  created_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL
);

-- 5. Tabela de Auditoria de Queries PJe (Medição e Rate Limiting de Planos)
CREATE TABLE IF NOT EXISTS pje_queries_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo_consulta VARCHAR(100) NOT NULL, -- Ex: 'busca_processo', 'lista_processos'
  tokens_estimados INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL
);

-- 6. Habilitar RLS em todas as tabelas criadas
ALTER TABLE planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificados_escritorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE pje_queries_logs ENABLE ROW LEVEL SECURITY;

-- 7. Definir Políticas de RLS de Isolamento de Tenant

-- Planos são públicos (leitura para todos autenticados, escrita apenas por superadmin)
CREATE POLICY planos_read_policy ON planos FOR SELECT TO authenticated USING (true);

-- Assinatura isolada por escritorio_id
CREATE POLICY assinaturas_tenant_isolation ON assinaturas FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY assinaturas_superadmin_bypass ON assinaturas FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

-- Certificados isolados por escritorio_id
CREATE POLICY certificados_tenant_isolation ON certificados_escritorios FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

-- Queries logs isolados por escritorio_id
CREATE POLICY pje_queries_logs_tenant_isolation ON pje_queries_logs FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

-- 8. Seed inicial de Planos de Serviço
INSERT INTO planos (id, nome, limite_usuarios, limite_queries_mensais, RAG_habilitado) VALUES
  ('starter', 'Plano Piloto Starter', 1, 500, false),
  ('professional', 'Plano Professional', 10, 5000, true),
  ('enterprise', 'Plano Corporate Enterprise', -1, -1, true)
ON CONFLICT (id) DO NOTHING;

-- 9. Seed de assinatura padrão para o escritório principal
INSERT INTO assinaturas (escritorio_id, plano_id, status, vigencia_inicio)
VALUES ('da39b5b2-3864-44df-be9b-e7b8c2d82910', 'professional', 'active', CURRENT_DATE)
ON CONFLICT DO NOTHING;
