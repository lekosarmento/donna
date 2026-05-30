import { proximoDiaUtil } from '../services/deadlineService.js';

console.log('--- TESTE E VALIDAÇÃO DE TIMEZONE LOCK BRASÍLIA ---');

// Feriados simulados (incluindo Corpus Christi, por exemplo)
const feriados = new Set(['2026-06-04', '2026-06-05']);

// Caso de teste: disponibilização na véspera de feriado prolongado
// 03 de Junho de 2026 (Quarta-feira)
const d0Parts = '2026-06-03'.split('-');
const d0Date = new Date(Number(d0Parts[0]), Number(d0Parts[1]) - 1, Number(d0Parts[2]), 12, 0, 0);

console.log('D0 Disponibilização:', d0Date.toISOString(), '->', d0Date.toString());

// D1 (Publicação) = Primeiro dia útil após D0
// Dia 04/06 (Quinta) é Feriado
// Dia 05/06 (Sexta) é Feriado prolongado
// Dia 06/06 (Sábado)
// Dia 07/06 (Domingo)
// Portanto, D1 deve ser 08/06 (Segunda-feira)
const d1Date = proximoDiaUtil(d0Date, feriados);
console.log('D1 Publicação (Esperado: 2026-06-08):', d1Date.toISOString().split('T')[0], '->', d1Date.toString());

// D2 (Início da Contagem) = Primeiro dia útil após D1
// D1 é 08/06 (Segunda-feira)
// D2 deve ser 09/06 (Terça-feira)
const d2Date = proximoDiaUtil(d1Date, feriados);
console.log('D2 Início da Contagem (Esperado: 2026-06-09):', d2Date.toISOString().split('T')[0], '->', d2Date.toString());

if (d1Date.toISOString().split('T')[0] === '2026-06-08' && d2Date.toISOString().split('T')[0] === '2026-06-09') {
  console.log('✅ SUCESSO: O motor de contagem está perfeitamente travado e consistente.');
} else {
  console.error('❌ ERRO: A contagem de prazos apresentou divergência.');
}
