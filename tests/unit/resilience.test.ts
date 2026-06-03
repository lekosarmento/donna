import { jest } from '@jest/globals';

// Configura o ambiente de teste
process.env.NODE_ENV = 'test';

// Mock do módulo do Supabase
jest.unstable_mockModule('../../src/config/supabase.js', () => {
  const mockFrom = jest.fn();
  return {
    supabase: {
      from: mockFrom
    }
  };
});

// Importações dinâmicas após o mock para interceptamento correto do ESM
const { supabase } = await import('../../src/config/supabase.js');
const { ResilientRepository } = await import('../../src/repositories/resilient-repository.js');
const { executarSincronizacao, globalSyncStatus } = await import('../../src/sync/sync-worker.js');
const { getLocalDb, resetDbForTest } = await import('../../src/config/sqlite-db.js');

const mockFrom = supabase.from as jest.Mock;

interface MockBehavior {
  selectData?: any;
  singleData?: any;
  error?: any;
  delayMs?: number;
}

const activeTimeouts: NodeJS.Timeout[] = [];

/**
 * Utilitário para configurar o comportamento simulado do Supabase
 */
function setupSupabaseMock(behavior: MockBehavior) {
  const chainable = {
    select: jest.fn().mockImplementation(() => chainable),
    insert: jest.fn().mockImplementation(async () => {
      if (behavior.delayMs) {
        await new Promise((r) => {
          const t = setTimeout(r, behavior.delayMs);
          activeTimeouts.push(t);
        });
      }
      if (behavior.error) return { data: null, error: behavior.error };
      return { data: [], error: null };
    }),
    upsert: jest.fn().mockImplementation(async () => {
      if (behavior.delayMs) {
        await new Promise((r) => {
          const t = setTimeout(r, behavior.delayMs);
          activeTimeouts.push(t);
        });
      }
      if (behavior.error) return { data: null, error: behavior.error };
      return { data: [], error: null };
    }),
    eq: jest.fn().mockImplementation(() => chainable),
    order: jest.fn().mockImplementation(() => chainable),
    single: jest.fn().mockImplementation(async () => {
      if (behavior.delayMs) {
        await new Promise((r) => {
          const t = setTimeout(r, behavior.delayMs);
          activeTimeouts.push(t);
        });
      }
      if (behavior.error) return { data: null, error: behavior.error };
      return { data: behavior.singleData || null, error: null };
    }),
    // Implementa then para que o race de promises o trate como Promise direta
    then: (resolve: any, reject: any) => {
      const promise = (async () => {
        if (behavior.delayMs) {
          await new Promise((r) => {
            const t = setTimeout(r, behavior.delayMs);
            activeTimeouts.push(t);
          });
        }
        if (behavior.error) return { data: null, error: behavior.error };
        return { data: behavior.selectData || [], error: null };
      })();
      return promise.then(resolve, reject);
    }
  };

  mockFrom.mockImplementation(() => chainable);
}

describe('Offline Resilience & Sync Engine (SQLite + Supabase)', () => {
  let db: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDbForTest();
    db = getLocalDb();

    // Reset do status de sincronização global
    globalSyncStatus.pendingSync = 0;
    globalSyncStatus.syncErrors = 0;
    globalSyncStatus.lastSyncAt = new Date();
  });

  afterEach(() => {
    activeTimeouts.forEach(clearTimeout);
    activeTimeouts.length = 0;
  });

  afterAll(() => {
    resetDbForTest();
  });

  describe('ResilientRepository Fallbacks', () => {
    const usuarioId = 'usr-123';
    const mockSession = {
      id: 'session-abc',
      escritorio_id: 'esc-999',
      usuario_id: usuarioId,
      titulo: 'Consulta de Divórcio'
    };

    it('deve carregar dados do Supabase e cachear no SQLite local em caso de sucesso', async () => {
      setupSupabaseMock({
        selectData: [
          {
            ...mockSession,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
      });

      const sessions = await ResilientRepository.getSessions(usuarioId);
      expect(sessions.length).toBe(1);
      expect(sessions[0].titulo).toBe('Consulta de Divórcio');

      // Verifica se cacheou localmente
      const localSessions = db.prepare('SELECT * FROM chat_sessions WHERE usuario_id = ?').all(usuarioId);
      expect(localSessions.length).toBe(1);
      expect(localSessions[0].titulo).toBe('Consulta de Divórcio');
      expect(localSessions[0].sync_pending).toBe(0); // Cacheado com sucesso
    });

    it('deve retornar dados locais se o Supabase falhar (Offline Fallback)', async () => {
      // Inserir registro local prévio
      db.prepare(`
        INSERT INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(mockSession.id, mockSession.escritorio_id, mockSession.usuario_id, 'Divórcio Local Antigo', new Date().toISOString(), new Date().toISOString());

      // Simular erro de rede no Supabase
      setupSupabaseMock({
        error: new Error('Network Connection Failure')
      });

      const sessions = await ResilientRepository.getSessions(usuarioId);
      expect(sessions.length).toBe(1);
      expect(sessions[0].titulo).toBe('Divórcio Local Antigo');
    });

    it('deve retornar dados locais se o Supabase exceder o timeout de 3s', async () => {
      // Inserir registro local
      db.prepare(`
        INSERT INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(mockSession.id, mockSession.escritorio_id, mockSession.usuario_id, 'Divórcio Local Timeout', new Date().toISOString(), new Date().toISOString());

      // Simular lentidão extrema (timeout) de 4 segundos no Supabase
      setupSupabaseMock({
        selectData: [{ ...mockSession, titulo: 'Divórcio Remoto Lento' }],
        delayMs: 4000
      });

      const sessions = await ResilientRepository.getSessions(usuarioId);
      // Deve retornar o local por causa do timeout de 3s
      expect(sessions.length).toBe(1);
      expect(sessions[0].titulo).toBe('Divórcio Local Timeout');
    });

    it('deve salvar localmente com sync_pending = 1 se o Supabase falhar na gravação', async () => {
      setupSupabaseMock({
        error: new Error('Supabase insert error')
      });

      await ResilientRepository.saveSession(mockSession);

      // Deve ter gravado localmente marcado como pendente
      const local = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(mockSession.id);
      expect(local).toBeDefined();
      expect(local.titulo).toBe('Consulta de Divórcio');
      expect(local.sync_pending).toBe(1);
    });

    it('deve salvar localmente com sync_pending = 0 se o Supabase gravar com sucesso', async () => {
      setupSupabaseMock({});

      await ResilientRepository.saveSession(mockSession);

      const local = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(mockSession.id);
      expect(local).toBeDefined();
      expect(local.sync_pending).toBe(0);
    });
  });

  describe('SyncEngine: Last-Write-Wins (LWW) & Conflict Resolution', () => {
    it('deve enviar alterações locais novas ao Supabase se elas não existirem na nuvem', async () => {
      // Criar sessão local pendente de sync
      const localTime = new Date('2026-06-02T10:00:00Z').toISOString();
      db.prepare(`
        INSERT INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
        VALUES ('sess-1', 'esc-1', 'usr-1', 'Título Local', 1, ?, ?)
      `).run(localTime, localTime);

      // Mock da nuvem: não tem a sessão
      setupSupabaseMock({
        singleData: null // Não existe
      });

      const metrics = await executarSincronizacao();
      expect(metrics.totalSynced).toBe(1);
      expect(metrics.conflictsResolved).toBe(0);
      expect(metrics.totalErrors).toBe(0);

      // Deve ter atualizado o SQLite para sincronizado
      const local = db.prepare("SELECT sync_pending FROM chat_sessions WHERE id = 'sess-1'").get();
      expect(local.sync_pending).toBe(0);
    });

    it('deve prevalecer o registro local se ele for mais recente que o remoto (LWW local)', async () => {
      const localTime = new Date('2026-06-02T12:00:00Z').toISOString();
      const remoteTime = new Date('2026-06-02T11:00:00Z').toISOString();

      db.prepare(`
        INSERT INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
        VALUES ('sess-2', 'esc-1', 'usr-1', 'Título Local Mais Recente', 1, ?, ?)
      `).run(localTime, localTime);

      // Mock remoto com data antiga
      setupSupabaseMock({
        singleData: { updated_at: remoteTime }
      });

      const metrics = await executarSincronizacao();
      expect(metrics.totalSynced).toBe(1);
      expect(metrics.conflictsResolved).toBe(0);

      const local = db.prepare("SELECT sync_pending FROM chat_sessions WHERE id = 'sess-2'").get();
      expect(local.sync_pending).toBe(0);
    });

    it('deve prevalecer o registro remoto e atualizar o SQLite se o remoto for mais recente (LWW cloud)', async () => {
      const localTime = new Date('2026-06-02T10:00:00Z').toISOString();
      const remoteTime = new Date('2026-06-02T11:00:00Z').toISOString();

      db.prepare(`
        INSERT INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
        VALUES ('sess-3', 'esc-1', 'usr-1', 'Título Local Desatualizado', 1, ?, ?)
      `).run(localTime, localTime);

      // Mock da nuvem mais recente
      setupSupabaseMock({
        singleData: { 
          id: 'sess-3',
          titulo: 'Título Remoto Mais Recente',
          updated_at: remoteTime
        }
      });

      const metrics = await executarSincronizacao();
      expect(metrics.totalSynced).toBe(0);
      expect(metrics.conflictsResolved).toBe(1); // Resolvido conflito remoto

      // SQLite local deve ter sido atualizado com dados remotos
      const local = db.prepare("SELECT titulo, sync_pending, updated_at FROM chat_sessions WHERE id = 'sess-3'").get();
      expect(local.titulo).toBe('Título Remoto Mais Recente');
      expect(local.sync_pending).toBe(0);
      expect(local.updated_at).toBe(remoteTime);
    });

    it('deve registrar erro no SQLite e manter sync_pending = 1 se a sincronização falhar', async () => {
      db.prepare(`
        INSERT INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
        VALUES ('sess-err', 'esc-1', 'usr-1', 'Sessão Falha', 1, ?, ?)
      `).run(new Date().toISOString(), new Date().toISOString());

      setupSupabaseMock({
        error: new Error('Conexão recusada ao Supabase')
      });

      const metrics = await executarSincronizacao();
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.totalSynced).toBe(0);

      const local = db.prepare("SELECT sync_pending, sync_error FROM chat_sessions WHERE id = 'sess-err'").get();
      expect(local.sync_pending).toBe(1);
      expect(local.sync_error).toContain('Conexão recusada');
    });
  });
});
