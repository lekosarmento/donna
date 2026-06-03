-- =========================================================================
-- MIGRATION: RAG PIPELINE FOR PLAYBOOKS (SUPABASE VECTOR & TENANT ISOLATION)
-- =========================================================================

-- 1. Habilitar a extensão vector para busca semântica de alta performance
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Criar a tabela de armazenamento de pedaços de playbooks
CREATE TABLE IF NOT EXISTS playbook_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id UUID NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
  documento_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL,
  conteudo TEXT NOT NULL,
  embedding vector(1536) NOT NULL, -- Modelo text-embedding-3-small (1536 dimensões)
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL
);

-- 3. Habilitar Row Level Security (RLS) para isolamento lógico
ALTER TABLE playbook_chunks ENABLE ROW LEVEL SECURITY;

-- 4. Criar políticas de tenant isolation sênior baseadas em JWT claims do Supabase
CREATE POLICY playbook_chunks_tenant_isolation ON playbook_chunks FOR ALL TO authenticated
  USING (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid)
  WITH CHECK (escritorio_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'escritorio_id', '')::uuid);

CREATE POLICY playbook_chunks_superadmin_bypass ON playbook_chunks FOR ALL TO authenticated
  USING (NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '') = 'superadmin');

-- 5. Criar índice HNSW para busca eficiente por Cosseno (vector_cosine_ops)
-- Nota: HNSW é preferível ao IVFFlat em bancos de produção para obter maior precisão (recall) e velocidade
CREATE INDEX IF NOT EXISTS playbook_chunks_embedding_hnsw_idx 
ON playbook_chunks 
USING hnsw (embedding vector_cosine_ops);

-- 6. Criar função de RPC para busca semântica (filtragem por cosseno e tenant)
-- PostgREST não suporta operadores de distância diretamente via API, sendo obrigatório o uso de RPC
CREATE OR REPLACE FUNCTION match_playbook_chunks (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_escritorio_id uuid
)
RETURNS TABLE (
  id uuid,
  escritorio_id uuid,
  documento_id uuid,
  chunk_index int,
  conteudo text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER -- Permite rodar com privilégios elevados para fins de leitura controlada
AS $$
BEGIN
  RETURN QUERY
  SELECT
    playbook_chunks.id,
    playbook_chunks.escritorio_id,
    playbook_chunks.documento_id,
    playbook_chunks.chunk_index,
    playbook_chunks.conteudo,
    playbook_chunks.metadata,
    1 - (playbook_chunks.embedding <=> query_embedding) AS similarity
  FROM playbook_chunks
  WHERE playbook_chunks.escritorio_id = filter_escritorio_id
    AND 1 - (playbook_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY playbook_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
