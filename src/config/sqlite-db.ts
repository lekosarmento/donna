import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = process.env.NODE_ENV === 'test' ? ':memory:' : path.join(DATA_DIR, 'donna-local.db');

// Caminhos dos arquivos legados jsonMutex para migração
const LEGACY_PROCESSOS_PATH = path.join(process.cwd(), 'src', 'config', 'processos_donna.json');
const LEGACY_ATORES_PATH = path.join(process.cwd(), 'src', 'config', 'atores_donna.json');
const LEGACY_INTERACOES_PATH = path.join(process.cwd(), 'src', 'config', 'interacoes_donna.json');
const LEGACY_CONVERSAS_PATH = path.join(process.cwd(), 'src', 'config', 'conversas_donna.json');

let dbInstance: Database.Database | null = null;

/**
 * Inicializa a pasta de dados e a instância do banco de dados SQLite local.
 */
export function getLocalDb(): Database.Database {
  if (dbInstance) return dbInstance;

  // Garante a existência do diretório /data
  if (process.env.NODE_ENV !== 'test' && !fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Conecta ao banco SQLite local
  dbInstance = new Database(DB_PATH, { verbose: process.env.NODE_ENV === 'test' ? undefined : console.log });
  
  // Habilita performance WAL mode e chaves estrangeiras
  if (process.env.NODE_ENV !== 'test') {
    dbInstance.pragma('journal_mode = WAL');
  }
  dbInstance.pragma('foreign_keys = ON');

  // Inicializa tabelas
  bootstrapDatabase(dbInstance);

  // Executa migração se dados legados JSON existirem
  if (process.env.NODE_ENV !== 'test') {
    migrarDadosLegados(dbInstance);
  }

  return dbInstance;
}

/**
 * Fecha a conexão e limpa a instância do banco (usado em testes).
 */
export function resetDbForTest(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Cria a estrutura de tabelas espelhando as tabelas críticas do Supabase.
 */
function bootstrapDatabase(db: Database.Database): void {
  // 0.1. Tabela: escritorios
  db.exec(`
    CREATE TABLE IF NOT EXISTS escritorios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      cnpj TEXT UNIQUE,
      oab_seccional TEXT,
      endereco TEXT,
      ativo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed do escritorio padrao
  db.exec(`
    INSERT OR IGNORE INTO escritorios (id, nome, cnpj, oab_seccional, endereco, ativo)
    VALUES ('da39b5b2-3864-44df-be9b-e7b8c2d82910', 'Escritório Geral Donna S.A.', '00.000.000/0001-00', 'PB', 'Rua Principal, 100', 1)
  `);

  // 0.2. Tabela: usuarios
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      escritorio_id TEXT REFERENCES escritorios(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      tipo_perfil TEXT DEFAULT 'junior',
      oab TEXT,
      whatsapp TEXT,
      ativo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 1. Tabela: processos
  db.exec(`
    CREATE TABLE IF NOT EXISTS processos (
      id TEXT PRIMARY KEY,
      numero_cnj TEXT UNIQUE NOT NULL,
      tribunal TEXT NOT NULL,
      comarca TEXT,
      vara TEXT,
      classe TEXT,
      assunto TEXT,
      rito TEXT,
      fase_processual TEXT,
      cliente_id TEXT NOT NULL,
      advogado_responsavel_id TEXT,
      prioridade TEXT DEFAULT 'media',
      status TEXT DEFAULT 'ativo',
      observacoes TEXT,
      sync_pending INTEGER DEFAULT 0, -- 0 = sincronizado, 1 = escrita local pendente
      sync_error TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 2. Tabela: prazos
  db.exec(`
    CREATE TABLE IF NOT EXISTS prazos (
      id TEXT PRIMARY KEY,
      processo_id TEXT REFERENCES processos(id) ON DELETE CASCADE,
      descricao TEXT NOT NULL,
      tipo_prazo TEXT,
      data_publicacao TEXT,
      data_inicio_contagem TEXT,
      prazo_dias INTEGER,
      data_vencimento TEXT,
      status TEXT DEFAULT 'aberto',
      responsavel_id TEXT,
      observacoes TEXT,
      sync_pending INTEGER DEFAULT 0,
      sync_error TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 3. Tabela: chat_sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      escritorio_id TEXT,
      usuario_id TEXT NOT NULL,
      processo_id TEXT REFERENCES processos(id) ON DELETE SET NULL,
      titulo TEXT DEFAULT 'Nova conversa jurídica',
      sync_pending INTEGER DEFAULT 0,
      sync_error TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 4. Tabela: chat_messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      escritorio_id TEXT,
      session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT, -- JSON stringificado
      sync_pending INTEGER DEFAULT 0,
      sync_error TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 5. Tabela de Auditoria de Conflitos e Log de Sync
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      record_id TEXT NOT NULL,
      error TEXT,
      status TEXT NOT NULL, -- 'success' | 'failed' | 'conflict_resolved'
      timestamp TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 6. Tabela: atores_judiciario (Magistrados)
  db.exec(`
    CREATE TABLE IF NOT EXISTS atores_judiciario (
      id TEXT PRIMARY KEY,
      escritorio_id TEXT NOT NULL DEFAULT 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
      tipo TEXT NOT NULL,
      nome TEXT NOT NULL,
      nome_usual TEXT,
      tribunal TEXT NOT NULL,
      comarca TEXT,
      vara TEXT,
      cargo_atual TEXT,
      telefone_gabinete TEXT,
      telefone_secretaria TEXT,
      telefone_direto TEXT,
      whatsapp TEXT,
      email_gabinete TEXT,
      email_direto TEXT,
      horario_atendimento TEXT,
      melhor_forma_contato TEXT,
      observacoes_contato TEXT,
      perfil_decisorio TEXT DEFAULT 'outro',
      temperamento TEXT,
      estilo_audiencia TEXT,
      receptividade_acordos TEXT,
      pontos_positivos TEXT, -- JSON stringificado
      pontos_atencao TEXT, -- JSON stringificado
      preferencias_processuais TEXT,
      historico_decisoes_relevantes TEXT,
      notas_estrategicas TEXT,
      fonte_informacao_perfil TEXT DEFAULT 'experiencia_socio',
      grau_confianca_perfil INTEGER DEFAULT 3,
      ativo INTEGER DEFAULT 1,
      sync_pending INTEGER DEFAULT 0,
      ultima_atualizacao_perfil TEXT DEFAULT (date('now')),
      atualizado_por TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 7. Tabela: raw_decisoes_magistrados
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_decisoes_magistrados (
      id TEXT PRIMARY KEY,
      magistrado_id TEXT NOT NULL REFERENCES atores_judiciario(id) ON DELETE CASCADE,
      numero_processo TEXT NOT NULL,
      data_decisao TEXT NOT NULL,
      tipo_decisao TEXT NOT NULL,
      resultado TEXT NOT NULL,
      area TEXT NOT NULL,
      conteudo_decisao TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE (magistrado_id, numero_processo, tipo_decisao, data_decisao)
    )
  `);

  // 8. Tabela: historico_perfis_magistrados
  db.exec(`
    CREATE TABLE IF NOT EXISTS historico_perfis_magistrados (
      id TEXT PRIMARY KEY,
      magistrado_id TEXT NOT NULL REFERENCES atores_judiciario(id) ON DELETE CASCADE,
      perfil_decisorio TEXT NOT NULL,
      temperamento TEXT NOT NULL,
      grau_confianca INTEGER NOT NULL,
      decisoes_analisadas INTEGER NOT NULL,
      data_registro TEXT DEFAULT (date('now')),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 9. Tabela: planos
  db.exec(`
    CREATE TABLE IF NOT EXISTS planos (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      limite_usuarios INTEGER NOT NULL,
      limite_queries_mensais INTEGER NOT NULL,
      rag_habilitado INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed de planos
  db.exec(`
    INSERT OR IGNORE INTO planos (id, nome, limite_usuarios, limite_queries_mensais, rag_habilitado) VALUES
      ('starter', 'Plano Piloto Starter', 1, 500, 0),
      ('professional', 'Plano Professional', 10, 5000, 1),
      ('enterprise', 'Plano Corporate Enterprise', -1, -1, 1)
  `);

  // 10. Tabela: assinaturas
  db.exec(`
    CREATE TABLE IF NOT EXISTS assinaturas (
      id TEXT PRIMARY KEY,
      escritorio_id TEXT REFERENCES escritorios(id) ON DELETE CASCADE,
      plano_id TEXT REFERENCES planos(id),
      status TEXT DEFAULT 'active',
      vigencia_inicio TEXT NOT NULL,
      vigencia_fim TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Seed da assinatura padrao
  db.exec(`
    INSERT OR IGNORE INTO assinaturas (id, escritorio_id, plano_id, status, vigencia_inicio)
    VALUES ('default-sub', 'da39b5b2-3864-44df-be9b-e7b8c2d82910', 'professional', 'active', date('now'))
  `);

  // 11. Tabela: certificados_escritorios
  db.exec(`
    CREATE TABLE IF NOT EXISTS certificados_escritorios (
      escritorio_id TEXT PRIMARY KEY REFERENCES escritorios(id) ON DELETE CASCADE,
      encrypted_pfx TEXT NOT NULL,
      salt TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 12. Tabela: pje_queries_logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS pje_queries_logs (
      id TEXT PRIMARY KEY,
      escritorio_id TEXT REFERENCES escritorios(id) ON DELETE CASCADE,
      usuario_id TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
      tipo_consulta TEXT NOT NULL,
      tokens_estimados INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 13. Tabela: rate_limit_log (DT-01)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      resource TEXT NOT NULL DEFAULT 'pje',
      requested_at INTEGER NOT NULL  -- Unix timestamp em ms
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rate_limit_user_resource ON rate_limit_log(user_id, resource, requested_at)`);
}

/**
 * Realiza migração transparente de dados legados do jsonMutex.js para o SQLite.
 */
function migrarDadosLegados(db: Database.Database): void {
  try {
    // 1. Migrar processos
    if (fs.existsSync(LEGACY_PROCESSOS_PATH)) {
      const content = fs.readFileSync(LEGACY_PROCESSOS_PATH, 'utf-8');
      const processos = JSON.parse(content || '[]');
      
      if (processos.length > 0) {
        console.log(`[SQLite Migration] Migrando ${processos.length} processos do jsonMutex legado...`);
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO processos (
            id, numero_cnj, tribunal, comarca, vara, classe, assunto, rito, 
            fase_processual, cliente_id, advogado_responsavel_id, prioridade, status, observacoes, sync_pending, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `);

        db.transaction((items) => {
          for (const p of items) {
            stmt.run(
              p.id || `local-proc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              p.numero_cnj || p.numeroCNJ,
              p.tribunal,
              p.comarca || null,
              p.vara || null,
              p.classe || null,
              p.assunto || null,
              p.rito || null,
              p.fase_processual || null,
              p.cliente_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
              p.advogado_responsavel_id || null,
              p.prioridade || 'media',
              p.status || 'ativo',
              p.observacoes || null,
              p.created_at || new Date().toISOString()
            );
          }
        })(processos);

        // Limpa o arquivo JSON legado para não duplicar migrações
        fs.writeFileSync(LEGACY_PROCESSOS_PATH, '[]', 'utf-8');
        console.log('[SQLite Migration] Ingestão de processos concluída e arquivo original zerado.');
      }
    }

    // 2. Migrar sessões e mensagens de chat
    if (fs.existsSync(LEGACY_CONVERSAS_PATH)) {
      const content = fs.readFileSync(LEGACY_CONVERSAS_PATH, 'utf-8');
      const conversas = JSON.parse(content || '[]');

      if (conversas.length > 0) {
        console.log(`[SQLite Migration] Migrando ${conversas.length} registros de chat legados...`);
        const stmtSession = db.prepare(`
          INSERT OR IGNORE INTO chat_sessions (id, usuario_id, titulo, sync_pending, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?)
        `);

        const stmtMessage = db.prepare(`
          INSERT OR IGNORE INTO chat_messages (id, session_id, role, content, metadata, sync_pending, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)
        `);

        db.transaction((sessionsList) => {
          for (const s of sessionsList) {
            stmtSession.run(
              s.id,
              s.usuario_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
              s.titulo || 'Conversa Migrada',
              s.created_at || new Date().toISOString(),
              s.updated_at || new Date().toISOString()
            );

            if (s.mensagens && Array.isArray(s.mensagens)) {
              for (const m of s.mensagens) {
                stmtMessage.run(
                  m.id || `local-msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                  s.id,
                  m.role,
                  m.content,
                  JSON.stringify(m.metadata || {}),
                  m.created_at || new Date().toISOString()
                );
              }
            }
          }
        })(conversas);

        fs.writeFileSync(LEGACY_CONVERSAS_PATH, '[]', 'utf-8');
        console.log('[SQLite Migration] Ingestão de conversas concluída e arquivos de chat zerados.');
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[SQLite Migration] Falha crítica de migração jsonMutex -> SQLite: ${errMsg}`);
  }
}
