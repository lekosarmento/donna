import { getLocalDb } from '../config/sqlite-db.js';

/**
 * DT-01 FIX — Rate Limiter Persistente via SQLite.
 *
 * Resolve o problema crítico de segurança onde o rate limit era armazenado
 * em um Map em memória que se perdia a cada restart do servidor.
 *
 * A tabela `rate_limit_log` registra cada requisição com TTL automático.
 * A limpeza de registros expirados ocorre a cada verificação (lazy cleanup).
 *
 * Interface `RateLimiter` permite migração futura para Redis sem mudar o PjeService.
 *
 * Schema necessário (incluído no sqlite-db.ts bootstrap):
 *   CREATE TABLE IF NOT EXISTS rate_limit_log (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT,
 *     user_id TEXT NOT NULL,
 *     resource TEXT NOT NULL DEFAULT 'pje',
 *     requested_at INTEGER NOT NULL  -- Unix timestamp em ms
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_rate_limit_user_resource
 *     ON rate_limit_log(user_id, resource, requested_at);
 */

export interface RateLimiterOptions {
  maxRequests: number;     // Máximo de requisições na janela
  windowMs: number;        // Tamanho da janela em milissegundos
  resource?: string;       // Identificador do recurso (padrão: 'pje')
}

/**
 * Verifica e registra uma requisição para o userId especificado.
 * Lança um erro se o limite for excedido.
 *
 * @throws {RateLimitExceededError} se o limite da janela for atingido
 */
export function checkAndRecordRequest(userId: string, options: RateLimiterOptions): void {
  const db = getLocalDb();
  const now = Date.now();
  const windowStart = now - options.windowMs;
  const resource = options.resource || 'pje';

  // 1. Limpar registros expirados (lazy cleanup — evita crescimento ilimitado)
  db.prepare(`
    DELETE FROM rate_limit_log
    WHERE requested_at < ? AND resource = ?
  `).run(windowStart - options.windowMs, resource); // Remove registros com mais de 2x a janela

  // 2. Contar requisições na janela atual para este usuário
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM rate_limit_log
    WHERE user_id = ?
      AND resource = ?
      AND requested_at >= ?
  `).get(userId, resource, windowStart) as { count: number };

  if (row.count >= options.maxRequests) {
    const oldestInWindow = db.prepare(`
      SELECT MIN(requested_at) as oldest
      FROM rate_limit_log
      WHERE user_id = ? AND resource = ? AND requested_at >= ?
    `).get(userId, resource, windowStart) as { oldest: number };

    const resetInMs = oldestInWindow?.oldest
      ? (oldestInWindow.oldest + options.windowMs) - now
      : options.windowMs;
    const resetInSec = Math.ceil(resetInMs / 1000);

    throw new RateLimitExceededError(userId, options.maxRequests, resetInSec);
  }

  // 3. Registrar a requisição atual
  db.prepare(`
    INSERT INTO rate_limit_log (user_id, resource, requested_at)
    VALUES (?, ?, ?)
  `).run(userId, resource, now);
}

/**
 * Retorna quantas requisições o userId ainda pode fazer na janela atual.
 * Útil para incluir no header X-RateLimit-Remaining.
 */
export function getRemainingRequests(userId: string, options: RateLimiterOptions): number {
  const db = getLocalDb();
  const windowStart = Date.now() - options.windowMs;
  const resource = options.resource || 'pje';

  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM rate_limit_log
    WHERE user_id = ? AND resource = ? AND requested_at >= ?
  `).get(userId, resource, windowStart) as { count: number };

  return Math.max(0, options.maxRequests - row.count);
}

/**
 * Limpa todos os registros de rate limit de um usuário (útil em testes e reset admin).
 */
export function resetRateLimit(userId: string, resource = 'pje'): void {
  const db = getLocalDb();
  db.prepare(`DELETE FROM rate_limit_log WHERE user_id = ? AND resource = ?`).run(userId, resource);
}

/**
 * Erro tipado de rate limit com informações de reset.
 */
export class RateLimitExceededError extends Error {
  public readonly code = 'RATE_LIMIT_EXCEEDED';
  public readonly retryAfterSeconds: number;

  constructor(userId: string, maxRequests: number, retryAfterSeconds: number) {
    super(
      `Limite de ${maxRequests} requisições por minuto excedido para o usuário ${userId}. ` +
      `Tente novamente em ${retryAfterSeconds} segundos.`
    );
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
