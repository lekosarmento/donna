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



dotenv.config();

export function buildApp() {
  const fastify = Fastify({
    logger: true,
  });

  // 1. Habilitar CORS para permitir conexão com Next.js ou Lovable frontends
  fastify.register(cors, {
    origin: '*',
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

  // 3. Rota de Health Check operacional
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'online',
      timestamp: new Date().toISOString(),
      copiloto: 'Donna v1.0.0',
    };
  });

  // 4. Registrar Módulos de Rotas do Sistema
  fastify.register(webhookRoutes);
  fastify.register(processoRoutes);
  fastify.register(prazoRoutes);
  fastify.register(donnaRoutes);
  fastify.register(pjeChatRoutes);
  fastify.register(monitoringRoutes);



  return fastify;
}
