import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { getLocalDb } from '../config/sqlite-db.js';
import { supabase } from '../config/supabase.js';
import { CertificateVault } from '../security/certificate-vault.js';

export default async function adminRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

  /**
   * Helper para verificar se o usuário solicitante é administrador.
   * Em produção, isso seria feito através de JWT decode / Supabase Auth middleware.
   */
  async function checkAdminRole(headers: any): Promise<boolean> {
    const userRole = headers['x-user-role'];
    if (userRole === 'admin' || userRole === 'superadmin') {
      return true;
    }

    const userId = headers['x-user-id'];
    if (!userId) return false;

    try {
      const db = getLocalDb();
      const user = db.prepare('SELECT tipo_perfil FROM usuarios WHERE id = ?').get(userId) as any;
      return user && (user.tipo_perfil === 'admin' || user.tipo_perfil === 'superadmin');
    } catch {
      return false;
    }
  }

  /**
   * GET /api/admin/summary
   * Retorna relatórios consolidados, alertas operacionais e listagem de escritórios.
   */
  fastify.get('/api/admin/summary', async (request, reply) => {
    // Para simplificar no ambiente local de desenvolvimento, permitimos acesso de bypass se sem headers
    const isAdmin = await checkAdminRole(request.headers);
    if (!isAdmin && request.headers['x-user-id']) {
      return reply.status(403).send({ error: 'Acesso negado. Apenas administradores do sistema possuem permissão.' });
    }

    const db = getLocalDb();

    try {
      // 1. Listagem de escritórios com plano, usuários e última atividade
      const escritorios = db.prepare(`
        SELECT
          e.id,
          e.nome,
          e.cnpj,
          e.oab_seccional,
          e.endereco,
          e.ativo,
          a.plano_id,
          a.status AS assinatura_status,
          (SELECT COUNT(*) FROM usuarios u WHERE u.escritorio_id = e.id) as total_usuarios,
          (SELECT MAX(created_at) FROM pje_queries_logs q WHERE q.escritorio_id = e.id) as ultima_atividade
        FROM escritorios e
        LEFT JOIN assinaturas a ON a.escritorio_id = e.id
      `).all() as any[];

      // 2. Coletar métricas agregadas
      // Queries por dia (últimos 7 dias)
      const queriesPorDia = db.prepare(`
        SELECT date(created_at) as data, COUNT(*) as total
        FROM pje_queries_logs
        GROUP BY date(created_at)
        ORDER BY data DESC
        LIMIT 7
      `).all() as any[];

      // Tokens consumidos no mês corrente
      const tokensConsumidosMes = db.prepare(`
        SELECT SUM(tokens_estimados) as total
        FROM pje_queries_logs
        WHERE strftime('%m', created_at) = strftime('%m', 'now')
      `).get() as any;

      // Processos monitorados no total
      const processosMonitorados = db.prepare(`
        SELECT COUNT(*) as total FROM processos
      `).get() as any;

      // 3. Montar lista de alertas
      const alertas: any[] = [];

      // Alertas de sincronização pendente
      const syncPendentes = db.prepare(`
        SELECT COUNT(*) as total FROM processos WHERE sync_pending = 1
      `).get() as any;
      
      if (syncPendentes && syncPendentes.total > 0) {
        alertas.push({
          tipo: 'sync_pendente',
          nivel: 'warn',
          mensagem: `Existem ${syncPendentes.total} processos com sincronismo offline pendente para a nuvem.`
        });
      }

      // Alertas de erros de conexão recentes
      const errosConexao = db.prepare(`
        SELECT COUNT(*) as total FROM sync_logs WHERE status = 'failed' AND timestamp > datetime('now', '-24 hours')
      `).get() as any;

      if (errosConexao && errosConexao.total > 0) {
        alertas.push({
          tipo: 'pje_conexao_erro',
          nivel: 'error',
          mensagem: `Detecção de ${errosConexao.total} falhas de handshake ou comunicação PJe nas últimas 24h.`
        });
      }

      // Alertas de validade de certificado digital
      const vault = CertificateVault.getInstance();
      const expDate = (vault as any).expirationDate;
      if (expDate) {
        const diasRestantes = Math.floor((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (diasRestantes <= 30) {
          alertas.push({
            tipo: 'certificado_expirando',
            nivel: diasRestantes <= 7 ? 'error' : 'warn',
            mensagem: `O certificado digital ICP-Brasil ativo no cofre expira em ${diasRestantes} dias (${expDate.toLocaleDateString('pt-BR')}).`
          });
        }
      } else {
        // Alerta padrão caso não tenha nenhum carregado
        alertas.push({
          tipo: 'certificado_ausente',
          nivel: 'warn',
          mensagem: 'Nenhum certificado digital carregado na memória do CertificateVault para a sessão ativa.'
        });
      }

      return reply.send({
        escritorios,
        metricas: {
          queries_dia: queriesPorDia.reverse(),
          tokens_mes: tokensConsumidosMes?.total || 0,
          processos_monitorados: processosMonitorados?.total || 0
        },
        alertas
      });

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Erro ao compilar painel administrativo', detalhes: errMsg });
    }
  });

  /**
   * POST /api/admin/escritorios/:id/status
   * Suspende ou reativa a assinatura de um escritório.
   */
  fastify.post('/api/admin/escritorios/:id/status', async (request, reply) => {
    const isAdmin = await checkAdminRole(request.headers);
    if (!isAdmin && request.headers['x-user-id']) {
      return reply.status(403).send({ error: 'Acesso negado.' });
    }

    const { id } = request.params as { id: string };
    const { status } = request.body as { status: 'active' | 'suspended' };

    if (!status || !['active', 'suspended'].includes(status)) {
      return reply.status(400).send({ error: 'Parâmetro status inválido (requer active ou suspended).' });
    }

    const db = getLocalDb();

    try {
      db.prepare('UPDATE assinaturas SET status = ?, updated_at = datetime(\'now\', \'localtime\') WHERE escritorio_id = ?').run(status, id);

      // Sincroniza Supabase
      supabase.from('assinaturas')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('escritorio_id', id)
        .then(({ error }) => {
          if (error) console.error(`[Admin Status Sync] Erro Supabase: ${error.message}`);
        });

      return reply.send({ success: true, mensagem: `Escritório ${id} agora está com status de assinatura: ${status}` });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Erro ao alterar status da assinatura.', detalhes: errMsg });
    }
  });

  /**
   * POST /api/admin/escritorios/:id/rotate-cert
   * Força a remoção (wipe) do certificado em memória e deleta do banco para obrigar re-upload.
   */
  fastify.post('/api/admin/escritorios/:id/rotate-cert', async (request, reply) => {
    const isAdmin = await checkAdminRole(request.headers);
    if (!isAdmin && request.headers['x-user-id']) {
      return reply.status(403).send({ error: 'Acesso negado.' });
    }

    const { id } = request.params as { id: string };
    const db = getLocalDb();

    try {
      // 1. Zera memória do cofre
      CertificateVault.getInstance().wipe();

      // 2. Remove da base de dados local
      db.prepare('DELETE FROM certificados_escritorios WHERE escritorio_id = ?').run(id);

      // 3. Remove da base de dados nuvem
      supabase.from('certificados_escritorios')
        .delete()
        .eq('escritorio_id', id)
        .then(({ error }) => {
          if (error) console.error(`[Admin Cert Sync] Erro ao limpar Supabase: ${error.message}`);
        });

      return reply.send({ success: true, mensagem: 'Rotação de certificado disparada. Chaves de memória zeradas e registros limpos.' });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Erro ao rotacionar certificado.', detalhes: errMsg });
    }
  });
}
