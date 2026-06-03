import 'dotenv/config';
import { buildApp } from './app.js';
import { iniciarWorker } from './workers/docketWorker.js';
import { getLocalDb } from './config/sqlite-db.js';
import { executarSincronizacao } from './sync/sync-worker.js';

const app = buildApp();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

const start = async () => {
  try {
    console.log('Iniciando o copiloto jurídico Donna...');
    
    // 1. Inicializar SQLite local e migrar jsonMutex legado
    try {
      getLocalDb();
      console.log('Banco de dados SQLite local inicializado e dados legados migrados.');
    } catch (dbErr) {
      console.error('Falha ao inicializar SQLite local:', dbErr);
    }

    await app.listen({ port: Number(port), host: host });
    console.log(`\n🚀 Donna rodando com sucesso em http://${host}:${port}`);
    console.log('Ambiente de automação jurídica e IA carregado.');
    
    // 2. Inicializar o worker assíncrono do diário em segundo plano
    iniciarWorker();

    // 3. Inicializar o loop de sincronização resiliente com o Supabase (LWW)
    console.log('Disparando sincronizador em background (intervalo 30s)...');
    setInterval(async () => {
      try {
        const metrics = await executarSincronizacao();
        if (metrics.totalSynced > 0 || metrics.conflictsResolved > 0) {
          console.log(`[Sync Worker] Sincronização concluída: ${metrics.totalSynced} sincronizados, ${metrics.conflictsResolved} conflitos resolvidos.`);
        }
      } catch (syncErr) {
        console.error('[Sync Worker] Erro no loop de sincronização:', syncErr);
      }
    }, 30000);

    // Executa a primeira carga de sync de imediato de forma não-bloqueante
    executarSincronizacao().catch(err => console.error('[Sync Worker] Erro no sync inicial:', err));
    
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
