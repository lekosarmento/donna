import { buildApp } from './app.js';
import { iniciarWorker } from './workers/docketWorker.js';
import dotenv from 'dotenv';

dotenv.config();

const app = buildApp();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

const start = async () => {
  try {
    console.log('Iniciando o copiloto jurídico Donna...');
    await app.listen({ port: Number(port), host: host });
    console.log(`\n🚀 Donna rodando com sucesso em http://${host}:${port}`);
    console.log('Ambiente de automação jurídica e IA carregado.');
    
    // Inicializar o worker assíncrono em segundo plano
    iniciarWorker();
    
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
