import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// k6 Options: Cenários progressivos solicitados no pentest
export const options = {
  scenarios: {
    // Cenário 1: Chat (10 a 30 VUs / 5 min)
    chat_steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 10 }, // Ramp-up para 10 VUs
        { duration: '3m', target: 10 }, // Steady em 10 VUs
        { duration: '1m', target: 30 }, // Stress leve (pico de 30 VUs)
        { duration: '30s', target: 0 }, // Ramp-down
      ],
      exec: 'chatScenario',
    },
    // Cenário 2: Processos / PJe simulado (5 VUs constantes, respeitando rate limits)
    processos_api: {
      executor: 'constant-vus',
      vus: 5,
      duration: '5m',
      exec: 'processosScenario',
    },
    // Cenário 3: RAG Upload (Spike de 100 VUs + Steady de 10 VUs)
    rag_upload_spike: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 150,
      stages: [
        { duration: '1m', target: 5 },   // Ingestão leve
        { duration: '1m', target: 100 }, // Spike de 100 requisições/s
        { duration: '3m', target: 5 },   // Volta para ingestão leve (steady)
      ],
      exec: 'uploadScenario',
    },
  },
  thresholds: {
    // p(95) < 3000ms para chat (LLM proxy)
    'http_req_duration{scenario:chat_steady}': ['p(95)<3000'],
    // p(95) < 8000ms para integrações externas de processos
    'http_req_duration{scenario:processos_api}': ['p(95)<8000'],
    // Limite genérico para falhas (menos de 1% de erros 500)
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const DEV_TOKEN = 'donna_dev_bypass_token';

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${DEV_TOKEN}`,
};

export function chatScenario() {
  const payload = JSON.stringify({
    usuario_id: 'admin-dev-user',
    mensagem: 'Resuma o playbook de cobrança em tópicos e liste os prazos importantes.',
    sessao_id: `local-session-${uuidv4()}`
  });

  const res = http.post(`${BASE_URL}/donna/conversar`, payload, { headers });
  
  check(res, {
    'chat is status 200': (r) => r.status === 200,
    'chat contains text': (r) => r.body && r.body.includes('texto'),
  });

  // Tempo de leitura entre as requisições (Think Time)
  sleep(Math.random() * 5 + 3);
}

export function processosScenario() {
  // Puxa lista de processos
  const res = http.get(`${BASE_URL}/processos`, { headers });
  
  check(res, {
    'processos status 200': (r) => r.status === 200,
  });

  // Simula rate limit do tribunal (uma requisição a cada 1 segundo no mínimo para as 5 VUs, 60/min = max 1req/s)
  // Como são 5 VUs, se cada VU esperar ~5-6s, teremos cerca de 60 requisições por minuto no total.
  sleep(Math.random() * 2 + 5);
}

export function uploadScenario() {
  // Simula o payload de upload do RAG
  const payload = JSON.stringify({
    titulo: `Doc_Teste_Carga_${uuidv4()}.txt`,
    conteudo: 'Este é um documento de teste inserido no RAG durante o teste de carga e spike test da Donna. ' + 'X'.repeat(500),
    tipo: 'playbook',
    area_direito: 'Cível',
    tags: ['teste', 'k6']
  });

  const res = http.post(`${BASE_URL}/donna/conhecimento/upload`, payload, { headers });
  
  check(res, {
    'upload status 200': (r) => r.status === 200,
    'upload sucessful': (r) => r.body && r.body.includes('success'),
  });
}
