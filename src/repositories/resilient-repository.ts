import { supabase } from '../config/supabase.js';
import { getLocalDb } from '../config/sqlite-db.js';
import { AuditLogger } from '../compliance/audit-logger.js';

// Utilitário para envelopar requisições assíncronas com timeout estrito
async function withTimeout<T>(promise: Promise<T>, timeoutMs = 3000): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('TIMEOUT_EXCEEDED'));
    }, timeoutMs);
  });

  return Promise.race([
    promise.then((res) => {
      clearTimeout(timeoutId);
      return res;
    }),
    timeoutPromise
  ]);
}

/**
 * Repositório Resiliente - Centraliza o padrão Híbrido/Fallback Offline da Donna.
 * Se o Supabase falhar ou exceder 3 segundos de latência, a operação é executada
 * transparentemente no banco SQLite local com a marcação de 'sync_pending = 1'.
 */
export class ResilientRepository {
  
  /**
   * Obtém as sessões de chat do usuário.
   */
  public static async getSessions(usuarioId: string): Promise<any[]> {
    const db = getLocalDb();
    try {
      // 1. Tentar leitura do Supabase
      const fetchSessionsPromise = supabase
        .from('chat_sessions')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('updated_at', { ascending: false });

      const { data, error } = await withTimeout(fetchSessionsPromise, 3000);

      if (!error && data) {
        // Cachear/Sincronizar no banco SQLite local para manter offline-first atualizado
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `);
        
        db.transaction((items) => {
          for (const s of items) {
            stmt.run(s.id, s.escritorio_id, s.usuario_id, s.titulo, s.created_at, s.updated_at);
          }
        })(data);

        return data;
      }
      throw error || new Error('Dados nulos do Supabase');
    } catch (err) {
      console.warn('[Resilience] Falha de conexão Supabase ao carregar sessões. Utilizando SQLite local:', err instanceof Error ? err.message : String(err));
      
      // 2. Fallback: Ler do SQLite local
      const rows = db.prepare(`
        SELECT * FROM chat_sessions 
        WHERE usuario_id = ? 
        ORDER BY datetime(updated_at) DESC
      `).all(usuarioId);

      return rows;
    }
  }

  /**
   * Obtém as mensagens de uma sessão específica.
   */
  public static async getMessages(sessionId: string): Promise<any[]> {
    const db = getLocalDb();
    try {
      const fetchMessagesPromise = supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      const { data, error } = await withTimeout(fetchMessagesPromise, 3000);

      if (!error && data) {
        // Cachear no SQLite local
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO chat_messages (id, escritorio_id, session_id, role, content, metadata, sync_pending, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `);

        db.transaction((messages) => {
          for (const m of messages) {
            stmt.run(m.id, m.escritorio_id, m.session_id, m.role, m.content, JSON.stringify(m.metadata || {}), m.created_at);
          }
        })(data);

        return data;
      }
      throw error || new Error('Mensagens nulas do Supabase');
    } catch (err) {
      console.warn('[Resilience] Falha de conexão Supabase ao carregar mensagens. Utilizando SQLite local:', err instanceof Error ? err.message : String(err));
      
      const rows = db.prepare(`
        SELECT * FROM chat_messages 
        WHERE session_id = ? 
        ORDER BY datetime(created_at) ASC
      `).all(sessionId);

      return rows.map((r: any) => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : {}
      }));
    }
  }

  /**
   * Grava uma nova sessão de chat.
   */
  public static async saveSession(session: {
    id: string;
    escritorio_id: string;
    usuario_id: string;
    titulo: string;
    created_at?: string;
    updated_at?: string;
  }): Promise<void> {
    const db = getLocalDb();
    const now = session.updated_at || new Date().toISOString();
    const created = session.created_at || now;

    try {
      // 1. Tentar gravação imediata no Supabase
      const insertPromise = supabase
        .from('chat_sessions')
        .insert({
          id: session.id,
          escritorio_id: session.escritorio_id,
          usuario_id: session.usuario_id,
          titulo: session.titulo,
          created_at: created,
          updated_at: now
        });

      const { error } = await withTimeout(insertPromise, 3000);
      if (error) throw error;

      // Sucesso: Grava localmente sem pendências
      db.prepare(`
        INSERT OR REPLACE INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(session.id, session.escritorio_id, session.usuario_id, session.titulo, created, now);

    } catch (err) {
      console.warn('[Resilience] Falha ao persistir sessão no Supabase. Gravando no SQLite com sync pendente:', err instanceof Error ? err.message : String(err));
      
      // Grava no SQLite marcado para sincronização
      db.prepare(`
        INSERT OR REPLACE INTO chat_sessions (id, escritorio_id, usuario_id, titulo, sync_pending, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(session.id, session.escritorio_id, session.usuario_id, session.titulo, created, now);
      
      this.logLocalWrite('chat_sessions', session.id);
    }
  }

  /**
   * Grava uma nova mensagem na sessão.
   */
  public static async saveMessage(message: {
    id: string;
    escritorio_id: string;
    session_id: string;
    role: string;
    content: string;
    metadata: any;
    created_at?: string;
  }): Promise<void> {
    const db = getLocalDb();
    const created = message.created_at || new Date().toISOString();

    try {
      const insertPromise = supabase
        .from('chat_messages')
        .insert({
          id: message.id,
          escritorio_id: message.escritorio_id,
          session_id: message.session_id,
          role: message.role,
          content: message.content,
          metadata: message.metadata,
          created_at: created
        });

      const { error } = await withTimeout(insertPromise, 3000);
      if (error) throw error;

      db.prepare(`
        INSERT OR REPLACE INTO chat_messages (id, escritorio_id, session_id, role, content, metadata, sync_pending, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(message.id, message.escritorio_id, message.session_id, message.role, message.content, JSON.stringify(message.metadata), created);

    } catch (err) {
      console.warn('[Resilience] Falha ao persistir mensagem no Supabase. Gravando localmente:', err instanceof Error ? err.message : String(err));
      
      db.prepare(`
        INSERT OR REPLACE INTO chat_messages (id, escritorio_id, session_id, role, content, metadata, sync_pending, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(message.id, message.escritorio_id, message.session_id, message.role, message.content, JSON.stringify(message.metadata), created);

      this.logLocalWrite('chat_messages', message.id);
    }
  }

  /**
   * Busca um processo específico pelo número CNJ.
   */
  public static async getProcesso(numeroCnj: string): Promise<any | null> {
    const db = getLocalDb();
    try {
      const fetchProcessoPromise = supabase
        .from('processos')
        .select('*')
        .eq('numero_cnj', numeroCnj)
        .single();

      const { data, error } = await withTimeout(fetchProcessoPromise, 3000);
      if (!error && data) {
        return data;
      }
      throw error || new Error('Dados nulos do processo');
    } catch (err) {
      console.warn('[Resilience] Falha ao buscar processo no Supabase. Utilizando SQLite local:', err instanceof Error ? err.message : String(err));
      
      const row = db.prepare(`
        SELECT * FROM processos WHERE numero_cnj = ?
      `).get(numeroCnj);

      return row || null;
    }
  }

  /**
   * Salva ou atualiza um processo na carteira de processos.
   */
  public static async saveProcesso(processo: any): Promise<void> {
    const db = getLocalDb();
    const now = new Date().toISOString();
    const created = processo.created_at || now;

    try {
      const insertPromise = supabase
        .from('processos')
        .upsert({
          id: processo.id,
          numero_cnj: processo.numero_cnj || processo.numeroCNJ,
          tribunal: processo.tribunal,
          comarca: processo.comarca || null,
          vara: processo.vara || null,
          classe: processo.classe || null,
          assunto: processo.assunto || null,
          rito: processo.rito || null,
          fase_processual: processo.fase_processual || null,
          cliente_id: processo.cliente_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
          advogado_responsavel_id: processo.advogado_responsavel_id || null,
          prioridade: processo.prioridade || 'media',
          status: processo.status || 'ativo',
          observacoes: processo.observacoes || null,
          created_at: created,
          updated_at: now
        });

      const { error } = await withTimeout(insertPromise, 3000);
      if (error) throw error;

      db.prepare(`
        INSERT OR REPLACE INTO processos (
          id, numero_cnj, tribunal, comarca, vara, classe, assunto, rito, 
          fase_processual, cliente_id, advogado_responsavel_id, prioridade, status, observacoes, sync_pending, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        processo.id,
        processo.numero_cnj || processo.numeroCNJ,
        processo.tribunal,
        processo.comarca || null,
        processo.vara || null,
        processo.classe || null,
        processo.assunto || null,
        processo.rito || null,
        processo.fase_processual || null,
        processo.cliente_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
        processo.advogado_responsavel_id || null,
        processo.prioridade || 'media',
        processo.status || 'ativo',
        processo.observacoes || null,
        created,
        now
      );

    } catch (err) {
      console.warn('[Resilience] Falha ao persistir processo no Supabase. Gravando no SQLite:', err instanceof Error ? err.message : String(err));
      
      db.prepare(`
        INSERT OR REPLACE INTO processos (
          id, numero_cnj, tribunal, comarca, vara, classe, assunto, rito, 
          fase_processual, cliente_id, advogado_responsavel_id, prioridade, status, observacoes, sync_pending, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        processo.id,
        processo.numero_cnj || processo.numeroCNJ,
        processo.tribunal,
        processo.comarca || null,
        processo.vara || null,
        processo.classe || null,
        processo.assunto || null,
        processo.rito || null,
        processo.fase_processual || null,
        processo.cliente_id || 'da39b5b2-3864-44df-be9b-e7b8c2d82910',
        processo.advogado_responsavel_id || null,
        processo.prioridade || 'media',
        processo.status || 'ativo',
        processo.observacoes || null,
        created,
        now
      );

      this.logLocalWrite('processos', processo.id);
    }
  }

  private static logLocalWrite(table: string, recordId: string) {
    try {
      AuditLogger.log({
        correlationId: `OFFLINE-${Date.now()}`,
        userId: 'SYSTEM',
        action: `GRAVACAO_OFFLINE_${table.toUpperCase()}`,
        resource: recordId,
        result: 'SUCCESS'
      });
    } catch {
      // Ignora se o Logger não inicializou
    }
  }
}
