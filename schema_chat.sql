-- =========================================================================
-- DONNA LEGAL CO-PILOT V3.0 — SCHEMA PARA HISTÓRICO DE CHAT COM RLS E TENANCY
-- =========================================================================

-- Limpeza preventiva de tabelas de chat anteriores (se aplicável)
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;

-- 1. TABELA: chat_sessions (Sessões Individuais de Conversa Jurídica)
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  processo_id UUID REFERENCES processos(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL DEFAULT 'Nova conversa jurídica',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. TABELA: chat_messages (Mensagens Normalizadas de Cada Sessão de Chat)
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =========================================================================
-- INDEXAÇÃO E DESEMPENHO
-- =========================================================================

-- Busca de sessões ordenadas por data de atualização e filtradas por usuário
CREATE INDEX idx_chat_sessions_usuario ON chat_sessions(escritorio_id, usuario_id, updated_at DESC);

-- Ordenação cronológica linear das mensagens dentro de uma sessão específica
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at ASC);

-- =========================================================================
-- SEGURANÇA E POLÍTICAS DE ROW LEVEL SECURITY (RLS)
-- =========================================================================

-- Ativar Row Level Security
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para chat_sessions
-- Garante que operadores só acessem sessões vinculadas ao seu escritório jurídico
CREATE POLICY "Permitir leitura de sessoes do proprio escritorio"
  ON chat_sessions
  FOR SELECT
  USING (
    escritorio_id = (
      SELECT escritorio_id FROM usuarios WHERE id = auth.uid()
    )
  );

CREATE POLICY "Permitir insercao de sessoes no proprio escritorio"
  ON chat_sessions
  FOR INSERT
  WITH CHECK (
    escritorio_id = (
      SELECT escritorio_id FROM usuarios WHERE id = auth.uid()
    )
  );

CREATE POLICY "Permitir atualizacao de sessoes do proprio escritorio"
  ON chat_sessions
  FOR UPDATE
  USING (
    escritorio_id = (
      SELECT escritorio_id FROM usuarios WHERE id = auth.uid()
    )
  );

CREATE POLICY "Permitir exclusao de sessoes do proprio escritorio"
  ON chat_sessions
  FOR DELETE
  USING (
    escritorio_id = (
      SELECT escritorio_id FROM usuarios WHERE id = auth.uid()
    )
  );

-- Políticas de RLS para chat_messages
-- As mensagens seguem as mesmas restrições baseadas no isolamento do escritorio_id
CREATE POLICY "Permitir leitura de mensagens do proprio escritorio"
  ON chat_messages
  FOR SELECT
  USING (
    escritorio_id = (
      SELECT escritorio_id FROM usuarios WHERE id = auth.uid()
    )
  );

CREATE POLICY "Permitir insercao de mensagens no proprio escritorio"
  ON chat_messages
  FOR INSERT
  WITH CHECK (
    escritorio_id = (
      SELECT escritorio_id FROM usuarios WHERE id = auth.uid()
    )
  );

CREATE POLICY "Permitir atualizacao de mensagens do proprio escritorio"
  ON chat_messages
  FOR UPDATE
  USING (
    escritorio_id = (
      SELECT escritorio_id FROM usuarios WHERE id = auth.uid()
    )
  );

CREATE POLICY "Permitir exclusao de mensagens do proprio escritorio"
  ON chat_messages
  FOR DELETE
  USING (
    escritorio_id = (
      SELECT escritorio_id FROM usuarios WHERE id = auth.uid()
    )
  );
