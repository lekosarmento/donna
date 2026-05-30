import { jsonMutex } from '../config/jsonMutex.js';
import path from 'path';
import fs from 'fs';

console.log('--- TESTE E VALIDAÇÃO DE CONCORRÊNCIA E MUTEX TRANSACIONAL ---');

const TEMP_FILE_PATH = path.join(process.cwd(), 'src', 'config', 'test_mutex.json');

// Inicializa arquivo de teste
fs.writeFileSync(TEMP_FILE_PATH, JSON.stringify([], null, 2), 'utf8');

async function testParallelWrites() {
  const operations = Array.from({ length: 20 }, (_, idx) => {
    return (async () => {
      // Pequeno atraso artificial para forçar sobreposição
      await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
      
      await jsonMutex.safeUpdate(TEMP_FILE_PATH, (currentData) => {
        currentData.push({ id: idx, time: Date.now() });
        return currentData;
      }, []);
      
      console.log(`Operação ${idx} gravada com sucesso transacional.`);
    })();
  });

  await Promise.all(operations);

  // Lê resultado final
  const finalData = JSON.parse(fs.readFileSync(TEMP_FILE_PATH, 'utf8'));
  console.log(`Total de registros no final: ${finalData.length} (Esperado: 20)`);
  
  if (finalData.length === 20) {
    console.log('✅ SUCESSO: O Mutex transacional impediu todas as condições de corrida e corrupção de arquivos!');
  } else {
    console.error('❌ ERRO: Perda de dados detectada sob carga de concorrência!');
  }

  // Limpa arquivo de teste
  try {
    fs.unlinkSync(TEMP_FILE_PATH);
  } catch (err) {}
}

testParallelWrites();
