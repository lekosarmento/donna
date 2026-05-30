import { promises as fs } from 'fs';
import path from 'path';

/**
 * Mutex para prevenir concorrência de escrita assíncrona em arquivos locais JSON.
 * Mantém uma fila de promessas sequenciais por arquivo.
 */
class JsonMutex {
  constructor() {
    this.locks = new Map();
  }

  /**
   * Obtém a promessa de trava para um arquivo específico.
   * Se já houver um lock ativo, aguarda a liberação dele.
   */
  async lock(filepath) {
    if (!this.locks.has(filepath)) {
      this.locks.set(filepath, Promise.resolve());
    }
    
    const previousLock = this.locks.get(filepath);
    let resolveLock;
    
    const nextLock = new Promise((resolve) => {
      resolveLock = resolve;
    });
    
    // Atualiza a trava para a próxima na fila
    this.locks.set(filepath, nextLock);
    
    // Aguarda o término da trava anterior
    await previousLock;
    
    // Retorna a função de liberação para a próxima trava na fila
    return () => {
      resolveLock();
      // Limpa a chave se não houver mais ninguém esperando
      if (this.locks.get(filepath) === nextLock) {
        this.locks.delete(filepath);
      }
    };
  }

  /**
   * Lê um arquivo JSON de forma segura sob trava concorrente.
   */
  async safeRead(filepath, fallbackValue = []) {
    const release = await this.lock(filepath);
    try {
      try {
        const content = await fs.readFile(filepath, 'utf8');
        return JSON.parse(content || JSON.stringify(fallbackValue));
      } catch (err) {
        if (err.code === 'ENOENT') {
          // Se o arquivo não existir, cria um novo com o fallback
          await fs.mkdir(path.dirname(filepath), { recursive: true });
          await fs.writeFile(filepath, JSON.stringify(fallbackValue, null, 2), 'utf8');
          return fallbackValue;
        }
        throw err;
      }
    } finally {
      release();
    }
  }

  /**
   * Escreve dados em um arquivo JSON de forma segura sob trava concorrente.
   */
  async safeWrite(filepath, data) {
    const release = await this.lock(filepath);
    try {
      await fs.mkdir(path.dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    } finally {
      release();
    }
  }

  /**
   * Executa uma transação de atualização segura (leitura, alteração e escrita) sob a mesma trava.
   * Evita condições de corrida entre leituras e escritas separadas.
   */
  async safeUpdate(filepath, updater, fallbackValue = []) {
    const release = await this.lock(filepath);
    try {
      let data = fallbackValue;
      try {
        const content = await fs.readFile(filepath, 'utf8');
        data = JSON.parse(content || JSON.stringify(fallbackValue));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
      
      // Executa a função de atualização sobre os dados lidos
      const updatedData = await updater(data);
      
      await fs.mkdir(path.dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, JSON.stringify(updatedData, null, 2), 'utf8');
      return updatedData;
    } finally {
      release();
    }
  }
}

export const jsonMutex = new JsonMutex();
