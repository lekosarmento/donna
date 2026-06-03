import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { pjeConfig } from '../config/pje-config.js';
import { CertificateVault } from '../security/certificate-vault.js';
import { supabase } from '../config/supabase.js';
import { globalSyncStatus } from '../sync/sync-worker.js';

// Métricas acumuladas na memória (Prometheus Exporter)
export const metrics = {
  pjeRequestsTotal: 0,
  pjeRequestsFailed: 0,
  pjeCacheHits: 0,
  pjeCacheMisses: 0,
  pjeLatencySumMs: 0,
};

/**
 * Registra uma chamada de medição de latência ao PJe.
 */
export function recordPjeCall(latencyMs: number, success: boolean) {
  metrics.pjeRequestsTotal++;
  if (!success) metrics.pjeRequestsFailed++;
  metrics.pjeLatencySumMs += latencyMs;
}

/**
 * Registra cache hits/misses para cálculo de eficiência.
 */
export function recordCacheHit(hit: boolean) {
  if (hit) {
    metrics.pjeCacheHits++;
  } else {
    metrics.pjeCacheMisses++;
  }
}

/**
 * Plugin de Monitoramento, Métricas e Observabilidade da Donna.
 */
export default async function monitoringRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

  /**
   * GET /health
   * Endpoint detalhado de diagnóstico para healthcheck (K8s / Docker / Cloud Run)
   */
  fastify.get('/health', async (request, reply) => {
    let databaseStatus = 'UP';
    let mcpServerStatus = 'UP';
    let anthropicStatus = 'UP';
    const issues: string[] = [];

    // 1. Validar status do banco de dados (Supabase)
    try {
      const startTime = Date.now();
      const { error } = await supabase.from('processos').select('count', { count: 'exact', head: true }).limit(1);
      if (error) throw error;
      
      const dbLatency = Date.now() - startTime;
      if (dbLatency > 1500) {
        issues.push(`Banco de dados com alta latência: ${dbLatency}ms`);
      }
    } catch (err) {
      databaseStatus = 'DOWN';
      issues.push(`Supabase inacessível: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Validar validade do certificado digital no Vault
    try {
      const vault = CertificateVault.getInstance();
      const certInfo = vault.getCertificateInfo?.() || {};
      
      if (certInfo.expirationDate) {
        const remainingDays = Math.floor((new Date(certInfo.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (remainingDays <= 0) {
          issues.push('Certificado digital ICP-Brasil EXPIRADO.');
        } else if (remainingDays < 30) {
          issues.push(`Certificado digital prestes a expirar: ${remainingDays} dias restantes.`);
          triggerCriticalAlert('CERTIFICATE_EXPIRING_ALERT', `O certificado cadastrado expira em ${remainingDays} dias.`);
        }
      }
    } catch (err) {
      issues.push('Erro ao inspecionar validade do certificado no Vault.');
    }

    // 3. Validar chaves da API Anthropic
    if (!process.env.ANTHROPIC_API_KEY) {
      anthropicStatus = 'DOWN';
      issues.push('Chave de API da Anthropic ausente nas variáveis de ambiente.');
    }

    const overallStatus = (databaseStatus === 'DOWN' || anthropicStatus === 'DOWN') ? 'DOWN' : 'UP';

    const responsePayload = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      components: {
        database: databaseStatus,
        mcpServer: mcpServerStatus,
        anthropic: anthropicStatus,
      },
      sync: {
        pendingSync: globalSyncStatus.pendingSync,
        lastSyncAt: globalSyncStatus.lastSyncAt.toISOString(),
        syncErrors: globalSyncStatus.syncErrors
      },
      issues: issues.length > 0 ? issues : undefined
    };

    return reply
      .status(overallStatus === 'UP' ? 200 : 503)
      .send(responsePayload);
  });

  /**
   * GET /metrics
   * Exportador nativo de métricas no formato padrão do Prometheus (OpenMetrics).
   */
  fastify.get('/metrics', async (request, reply) => {
    const averageLatencyMs = metrics.pjeRequestsTotal > 0 
      ? (metrics.pjeLatencySumMs / metrics.pjeRequestsTotal).toFixed(2)
      : '0';

    const cacheHitRate = (metrics.pjeCacheHits + metrics.pjeCacheMisses) > 0
      ? (metrics.pjeCacheHits / (metrics.pjeCacheHits + metrics.pjeCacheMisses)).toFixed(4)
      : '0.0000';

    let prometheusPayload = '';
    
    // Contadores de requisição PJe
    prometheusPayload += `# HELP donna_pje_requests_total Total de chamadas ao barramento do PJe.\n`;
    prometheusPayload += `# TYPE donna_pje_requests_total counter\n`;
    prometheusPayload += `donna_pje_requests_total ${metrics.pjeRequestsTotal}\n\n`;

    // Falhas de conexões com o PJe
    prometheusPayload += `# HELP donna_pje_requests_failed_total Total de chamadas falhas ao PJe.\n`;
    prometheusPayload += `# TYPE donna_pje_requests_failed_total counter\n`;
    prometheusPayload += `donna_pje_requests_failed_total ${metrics.pjeRequestsFailed}\n\n`;

    // Latência Média
    prometheusPayload += `# HELP donna_pje_latency_average_ms Latência média das chamadas ao PJe em ms.\n`;
    prometheusPayload += `# TYPE donna_pje_latency_average_ms gauge\n`;
    prometheusPayload += `donna_pje_latency_average_ms ${averageLatencyMs}\n\n`;

    // Cache Hit Rate
    prometheusPayload += `# HELP donna_pje_cache_hit_rate Taxa de eficiência (Hit Rate) do cache local da Donna.\n`;
    prometheusPayload += `# TYPE donna_pje_cache_hit_rate gauge\n`;
    prometheusPayload += `donna_pje_cache_hit_rate ${cacheHitRate}\n\n`;

    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(prometheusPayload);
  });
}

/**
 * Triggers a critical SIEM JSON alert for alerting pipelines (Datadog/PagerDuty/Slack).
 */
function triggerCriticalAlert(type: string, message: string): void {
  const alertPayload = {
    level: 'error',
    timestamp: new Date().toISOString(),
    correlationId: 'CRITICAL-MONITOR',
    type: 'INFRASTRUCTURE_ALERT',
    alertType: type,
    message: `[ALERTA DE PRODUÇÃO] ${message}`,
  };
  console.error(JSON.stringify(alertPayload));
}
