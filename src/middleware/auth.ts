import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';

// Extende os tipos do Fastify para incluir `user` no request
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      escritorio_id: string;
      tipo_perfil: string;
      role: string; // 'admin' | 'socio' | 'associado' | 'junior' | 'estagiario'
    };
  }
}

/**
 * DT-04 FIX — Middleware de Autenticação JWT para Fastify.
 *
 * Valida o Bearer token contra o Supabase Auth e injeta `request.user`
 * com dados do usuário (id, email, escritorio_id, perfil) para uso nas rotas.
 *
 * Uso:
 *   // Proteger uma rota específica
 *   fastify.post('/api/minha-rota', { preHandler: [requireAuth] }, handler);
 *
 *   // Proteger todas as rotas de um plugin
 *   fastify.addHook('preHandler', requireAuth);
 */

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role para validar tokens de qualquer usuário
);

/**
 * Extrai o Bearer token do header Authorization.
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7); // Remove 'Bearer '
}

/**
 * Hook preHandler: valida JWT e injeta request.user.
 * Retorna 401 se o token for inválido ou ausente.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Em ambiente de teste, injeta usuário mock para não bloquear suítes de teste
  if (process.env.NODE_ENV === 'test') {
    request.user = {
      id: 'test-user-id',
      email: 'test@donna.com.br',
      escritorio_id: 'test-escritorio-id',
      tipo_perfil: 'socio',
      role: 'socio',
    };
    return;
  }

  const token = extractBearerToken(request);

  // DEV BYPASS: Permite acessar localmente usando token de simulação
  if (process.env.NODE_ENV !== 'production' && token === 'donna_dev_bypass_token') {
    request.user = {
      id: 'admin-dev-user',
      email: 'admin@donna.com.br',
      escritorio_id: 'da39b5b2-3864-44df-be9b-e7b8c2d82910', // ID do seed sqlite
      tipo_perfil: 'admin',
      role: 'admin',
    };
    request.headers['x-user-id'] = request.user.id;
    return;
  }

  if (!token) {
    return reply.status(401).send({
      error: 'Não autorizado',
      detalhes: 'Token de autenticação ausente. Inclua o header Authorization: Bearer <token>.',
    });
  }

  // Valida o JWT contra o Supabase Auth (verifica assinatura + expiração)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    request.log.warn({ error: error?.message }, 'JWT inválido ou expirado na tentativa de acesso.');
    return reply.status(401).send({
      error: 'Não autorizado',
      detalhes: 'Token de autenticação inválido ou expirado. Faça login novamente.',
    });
  }

  // Busca dados de perfil e escritorio_id do usuário na tabela `usuarios`
  const { data: userRecord, error: dbError } = await supabaseAdmin
    .from('usuarios')
    .select('id, escritorio_id, tipo_perfil, ativo')
    .eq('id', user.id)
    .single();

  if (dbError || !userRecord) {
    request.log.warn({ userId: user.id }, 'Usuário autenticado pelo JWT mas não encontrado na tabela usuarios.');
    return reply.status(403).send({
      error: 'Acesso negado',
      detalhes: 'Usuário não cadastrado neste sistema. Entre em contato com o administrador do escritório.',
    });
  }

  if (!userRecord.ativo) {
    return reply.status(403).send({
      error: 'Conta suspensa',
      detalhes: 'Sua conta foi desativada. Entre em contato com o administrador do escritório.',
    });
  }

  // Injeta dados verificados no request — disponíveis em qualquer handler da rota
  request.user = {
    id: user.id,
    email: user.email!,
    escritorio_id: userRecord.escritorio_id,
    tipo_perfil: userRecord.tipo_perfil,
    role: userRecord.tipo_perfil,
  };

  // Propaga o userId verificado no header para compatibilidade com código legado
  // que lê `x-user-id` (ex: pjeChatRoutes.ts antes do DT-04)
  request.headers['x-user-id'] = user.id;
}

/**
 * Hook preHandler: exige perfil 'admin' além de autenticação válida.
 * Deve ser usado APÓS requireAuth na cadeia de preHandlers.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);

  // Se requireAuth já enviou resposta (401/403), não continua
  if (reply.sent) return;

  if (request.user?.role !== 'admin') {
    return reply.status(403).send({
      error: 'Acesso restrito',
      detalhes: 'Esta operação requer perfil de administrador do sistema.',
    });
  }
}

/**
 * Plugin Fastify para registrar os decorators de autenticação na instância.
 * Registrar com: fastify.register(authPlugin)
 */
export async function authPlugin(fastify: FastifyInstance) {
  fastify.decorate('requireAuth', requireAuth);
  fastify.decorate('requireAdmin', requireAdmin);

  // Expor versão decorada para uso em definições de rota
  fastify.decorateRequest('user', null);
}
