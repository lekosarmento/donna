import { isMainThread, parentPort } from 'worker_threads';
import { supabase } from '../config/supabase.js';
import { getLocalDb } from '../config/sqlite-db.js';

interface SyncMetrics {
  totalSynced: number;
  totalErrors: number;
  conflictsResolved: number;
}

// Armazena metadados de sync global na memória para o endpoint de health
export const globalSyncStatus = {
  pendingSync: 0,
  lastSyncAt: new Date(),
  syncErrors: 0
};

/**
 * Executa a varredura e sincronização de todos os registros pendentes (sync_pending = 1) no SQLite para o Supabase.
 * Usa estratégia Last-Write-Wins (LWW) baseada no campo updated_at.
 */
export async function executarSincronizacao(): Promise<SyncMetrics> {
  const db = getLocalDb();
  const metrics: SyncMetrics = { totalSynced: 0, totalErrors: 0, conflictsResolved: 0 };

  try {
    // 1. Sincronizar chat_sessions
    const pendingSessions = db.prepare(`SELECT * FROM chat_sessions WHERE sync_pending = 1`).all();
    for (const session of pendingSessions as any[]) {
      try {
        // Obter versão remota
        const { data: remoteSession } = await supabase
          .from('chat_sessions')
          .select('updated_at')
          .eq('id', session.id)
          .single();

        let deveAtualizarRemoto = true;

        if (remoteSession) {
          const remoteTime = new Date(remoteSession.updated_at).getTime();
          const localTime = new Date(session.updated_at).getTime();

          if (remoteTime > localTime) {
            // Remoto é mais recente (Conflito resolvido em favor da nuvem)
            deveAtualizarRemoto = false;
            
            // Buscar dados remotos completos e atualizar SQLite
            const { data: fullRemote } = await supabase
              .from('chat_sessions')
              .select('*')
              .eq('id', session.id)
              .single();

            if (fullRemote) {
              db.prepare(`
                UPDATE chat_sessions 
                SET titulo = ?, sync_pending = 0, updated_at = ?, sync_error = NULL
                WHERE id = ?
              `).run(fullRemote.titulo, fullRemote.updated_at, session.id);
              
              registrarLogSync(db, 'chat_sessions', session.id, 'conflict_resolved', 'Remoto mais recente. SQLite atualizado.');
              metrics.conflictsResolved++;
            }
          }
        }

        if (deveAtualizarRemoto) {
          // Local é mais recente ou novo (Enviar para o Supabase)
          const { error } = await supabase
            .from('chat_sessions')
            .upsert({
              id: session.id,
              escritorio_id: session.escritorio_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
              usuario_id: session.usuario_id,
              titulo: session.titulo,
              created_at: session.created_at,
              updated_at: session.updated_at
            });

          if (error) throw error;

          db.prepare(`UPDATE chat_sessions SET sync_pending = 0, sync_error = NULL WHERE id = ?`).run(session.id);
          registrarLogSync(db, 'chat_sessions', session.id, 'success');
          metrics.totalSynced++;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        db.prepare(`UPDATE chat_sessions SET sync_error = ? WHERE id = ?`).run(errorMsg, session.id);
        registrarLogSync(db, 'chat_sessions', session.id, 'failed', errorMsg);
        metrics.totalErrors++;
      }
    }

    // 2. Sincronizar chat_messages
    const pendingMessages = db.prepare(`SELECT * FROM chat_messages WHERE sync_pending = 1`).all();
    for (const msg of pendingMessages as any[]) {
      try {
        const { error } = await supabase
          .from('chat_messages')
          .upsert({
            id: msg.id,
            escritorio_id: msg.escritorio_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
            session_id: msg.session_id,
            role: msg.role,
            content: msg.content,
            metadata: msg.metadata ? JSON.parse(msg.metadata) : {},
            created_at: msg.created_at
          });

        if (error) throw error;

        db.prepare(`UPDATE chat_messages SET sync_pending = 0, sync_error = NULL WHERE id = ?`).run(msg.id);
        registrarLogSync(db, 'chat_messages', msg.id, 'success');
        metrics.totalSynced++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        db.prepare(`UPDATE chat_messages SET sync_error = ? WHERE id = ?`).run(errorMsg, msg.id);
        registrarLogSync(db, 'chat_messages', msg.id, 'failed', errorMsg);
        metrics.totalErrors++;
      }
    }

    // 3. Sincronizar processos
    const pendingProcessos = db.prepare(`SELECT * FROM processos WHERE sync_pending = 1`).all();
    for (const proc of pendingProcessos as any[]) {
      try {
        // Obter versão remota do processo
        const { data: remoteProc } = await supabase
          .from('processos')
          .select('updated_at')
          .eq('id', proc.id)
          .single();

        let deveAtualizarRemoto = true;

        if (remoteProc) {
          const remoteTime = new Date(remoteProc.updated_at).getTime();
          const localTime = new Date(proc.updated_at).getTime();

          if (remoteTime > localTime) {
            deveAtualizarRemoto = false;
            
            const { data: fullRemote } = await supabase
              .from('processos')
              .select('*')
              .eq('id', proc.id)
              .single();

            if (fullRemote) {
              db.prepare(`
                UPDATE processos 
                SET numero_cnj = ?, tribunal = ?, comarca = ?, vara = ?, classe = ?, 
                    assunto = ?, rito = ?, fase_processual = ?, cliente_id = ?, 
                    advogado_responsavel_id = ?, prioridade = ?, status = ?, observacoes = ?, 
                    sync_pending = 0, updated_at = ?, sync_error = NULL
                WHERE id = ?
              `).run(
                fullRemote.numero_cnj, fullRemote.tribunal, fullRemote.comarca, fullRemote.vara,
                fullRemote.classe, fullRemote.assunto, fullRemote.rito, fullRemote.fase_processual,
                fullRemote.cliente_id, fullRemote.advogado_responsavel_id, fullRemote.prioridade,
                fullRemote.status, fullRemote.observacoes, fullRemote.updated_at, proc.id
              );
              
              registrarLogSync(db, 'processos', proc.id, 'conflict_resolved', 'Conflito resolvido em favor da nuvem.');
              metrics.conflictsResolved++;
            }
          }
        }

        if (deveAtualizarRemoto) {
          const { error } = await supabase
            .from('processos')
            .upsert({
              id: proc.id,
              numero_cnj: proc.numero_cnj,
              tribunal: proc.tribunal,
              comarca: proc.comarca || null,
              vara: proc.vara || null,
              classe: proc.classe || null,
              assunto: proc.assunto || null,
              rito: proc.rito || null,
              fase_processual: proc.fase_processual || null,
              cliente_id: proc.cliente_id,
              advogado_responsavel_id: proc.advogado_responsavel_id || null,
              prioridade: proc.prioridade || 'media',
              status: proc.status || 'ativo',
              observacoes: proc.observacoes || null,
              created_at: proc.created_at,
              updated_at: proc.updated_at
            });

          if (error) throw error;

          db.prepare(`UPDATE processos SET sync_pending = 0, sync_error = NULL WHERE id = ?`).run(proc.id);
          registrarLogSync(db, 'processos', proc.id, 'success');
          metrics.totalSynced++;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        db.prepare(`UPDATE processos SET sync_error = ? WHERE id = ?`).run(errorMsg, proc.id);
        registrarLogSync(db, 'processos', proc.id, 'failed', errorMsg);
        metrics.totalErrors++;
      }
    }

    // Atualizar status global em memória
    const pendingCount = (
      db.prepare(`SELECT count(*) as count FROM chat_sessions WHERE sync_pending = 1`).get() as any
    ).count + (
      db.prepare(`SELECT count(*) as count FROM chat_messages WHERE sync_pending = 1`).get() as any
    ).count + (
      db.prepare(`SELECT count(*) as count FROM processos WHERE sync_pending = 1`).get() as any
    ).count;

    globalSyncStatus.pendingSync = pendingCount;
    globalSyncStatus.lastSyncAt = new Date();
    globalSyncStatus.syncErrors = metrics.totalErrors;

  } catch (syncErr) {
    console.error('[Sync Engine] Erro fatal no loop de sincronização:', syncErr);
    globalSyncStatus.syncErrors++;
  }

  return metrics;
}

function registrarLogSync(
  db: any, 
  table: string, 
  recordId: string, 
  status: 'success' | 'failed' | 'conflict_resolved', 
  error: string | null = null
): void {
  try {
    db.prepare(`
      INSERT INTO sync_logs (action, resource, record_id, error, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('sync_record', table, recordId, error, status);
  } catch (err) {
    console.error('[Sync Logger] Falha ao registrar log de sync no SQLite:', err);
  }
}

// 4. Inicializa o loop se executado como Thread Secundária
if (!isMainThread && process.env.NODE_ENV !== 'test') {
  console.log('[Sync Worker] Inicializado em background thread.');
  
  // Roda uma sincronização inicial imediata de inicialização
  executarSincronizacao().then((metrics) => {
    parentPort?.postMessage({ type: 'sync:complete', metrics });
  });

  // Loop de intervalo de 30 segundos
  setInterval(async () => {
    try {
      const metrics = await executarSincronizacao();
      if (metrics.totalSynced > 0 || metrics.conflictsResolved > 0 || metrics.totalErrors > 0) {
        parentPort?.postMessage({ type: 'sync:complete', metrics });
      }
    } catch (err) {
      parentPort?.postMessage({ type: 'sync:conflict', error: String(err) });
    }
  }, 30000);
}
