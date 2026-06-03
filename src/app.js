import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';

// Importar as rotas do projeto
import webhookRoutes from './routes/webhookRoutes.js';
import processoRoutes from './routes/processoRoutes.js';
import prazoRoutes from './routes/prazoRoutes.js';
import donnaRoutes from './routes/donnaRoutes.js';
import pjeChatRoutes from './routes/pjeChatRoutes.js';
import monitoringRoutes from './monitoring/health.js';
import multipart from '@fastify/multipart';
import ragIngestorRoutes from './rag/ingestor.js';
import judgeRoutes from './routes/judgeRoutes.js';
import onboardingRoutes from './routes/onboardingRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
// DT-04: Middleware de autenticação JWT
import { authPlugin, requireAuth, requireAdmin } from './middleware/auth.js';



dotenv.config();

export function buildApp() {
  const fastify = Fastify({
    logger: true,
  });

  // 1. Habilitar CORS para permitir conexão de origens autorizadas (CORS Hardening)
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://localhost:3002'];

  fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // 2. Registrar Rate Limiting para proteção contra abusos e exaustão de tokens
  fastify.register(rateLimit, {
    max: 100, // limite de 100 requisições por IP
    timeWindow: '1 minute', // por minuto
    errorResponseBuilder: (request, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Donna identificou excesso de requisições a partir deste endereço. Acesso temporariamente suspenso para proteção dos servidores.'
      };
    }
  });


  // Habilitar Multipart para Ingestão de Playbooks RAG
  fastify.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024 // Limite de 15MB por arquivo
    }
  });

  // DT-04: Registrar o plugin de autenticação JWT (decorator + request.user)
  fastify.register(authPlugin);

  // 4. Registrar Módulos de Rotas do Sistema
  // Rotas públicas (sem autenticação)
  fastify.register(webhookRoutes);     // Webhooks recebidos dos tribunais (validação própria via secret)
  fastify.register(onboardingRoutes);  // Setup inicial de escritório (ainda sem usuário)
  fastify.register(monitoringRoutes);  // /health e /metrics (acesso interno/infra)

  // Rotas privadas — exigem Bearer JWT válido (DT-04)
  fastify.register(processoRoutes,    { prefix: '' });
  fastify.register(prazoRoutes,       { prefix: '' });
  fastify.register(donnaRoutes,       { prefix: '' });
  fastify.register(pjeChatRoutes,     { prefix: '' });
  fastify.register(ragIngestorRoutes, { prefix: '' });
  fastify.register(judgeRoutes,       { prefix: '' });

  // Rota administrativa — exige perfil admin (DT-04)
  fastify.register(adminRoutes, { prefix: '' });



  return fastify;
}
