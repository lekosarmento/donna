import * as fs from 'fs';
import * as path from 'path';

export interface SIEMAuditEntry {
  timestamp: string;
  correlationId: string;
  userId: string;
  action: string;
  resource: string;
  result: 'SUCCESS' | 'FAILED' | 'ERROR';
  ip: string;
  environment: string;
}

/**
 * Logger de Auditoria imutável (Append-only) e compatível com SIEM.
 * Grava registros estruturados de segurança em disco, prevenindo alterações retroativas
 * e bloqueando vazamento de dados confidenciais ou peças jurídicas nos logs.
 */
export class AuditLogger {
  private static logFilePath = path.resolve('d:/Donna/logs/audit.log');

  /**
   * Registra um evento de auditoria no log estruturado imutável da Donna.
   */
  public static log(entry: {
    correlationId: string;
    userId: string;
    action: string;
    resource: string;
    result: 'SUCCESS' | 'FAILED' | 'ERROR';
    ip?: string;
  }): void {
    const timestamp = new Date().toISOString();
    const cleanResource = this.sanitizeAuditResource(entry.resource);
    const clientIp = entry.ip || '127.0.0.1';

    const siemRecord: SIEMAuditEntry = {
      timestamp,
      correlationId: entry.correlationId,
      userId: entry.userId,
      action: entry.action,
      resource: cleanResource,
      result: entry.result,
      ip: clientIp,
      environment: process.env.NODE_ENV || 'production'
    };

    const logLine = JSON.stringify(siemRecord) + '\n';

    // Persistência imutável em arquivo append-only
    try {
      const dir = path.dirname(AuditLogger.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Append-only síncrono para garantir integridade e ordem temporal sob concorrência
      fs.appendFileSync(AuditLogger.logFilePath, logLine, 'utf8');

      // Emitir no standard output para coletores de log de contêineres (Datadog/Elastic)
      console.log(JSON.stringify({
        level: 'info',
        type: 'SIEM_AUDIT_STREAM',
        ...siemRecord
      }));

    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        timestamp,
        correlationId: entry.correlationId,
        message: 'FALHA CRÍTICA AO GRAVAR REGISTRO DE AUDITORIA EM DISCO.',
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }

  /**
   * Remove identificadores sensíveis ou corpos de documentos longos da string do recurso.
   */
  private static sanitizeAuditResource(resource: string): string {
    if (!resource) return 'N/A';
    
    let sanitized = resource.trim();
    
    // Ocultar números de CPFs (11 dígitos)
    sanitized = sanitized.replace(/\b\d{11}\b/g, '***.***.***-**');
    
    // Ocultar números de CNPJ (14 dígitos)
    sanitized = sanitized.replace(/\b\d{14}\b/g, '**.***.***/****-**');

    // Se o recurso contiver fragmentos de textos gigantes, trunca
    if (sanitized.length > 250) {
      sanitized = sanitized.substring(0, 200) + '... [TRUNCADO PARA AUDITORIA]';
    }

    return sanitized;
  }
}
