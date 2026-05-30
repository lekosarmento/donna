import { calcularPrazoProcessual } from '../services/deadlineService.js';
import { supabase } from '../config/supabase.js';

console.log('--- TESTE E VALIDAÇÃO DE CONFORMIDADE JURÍDICA E PRAZOS DO DOMICÍLIO ---');

// Mock do supabase.from('processos')
const mockProcesso = {
  tribunal: 'TJPB',
  comarca: 'João Pessoa',
  vara: '2ª Vara Cível'
};

// Sobrescreve temporariamente a chamada supabase.from para simular conexão
const originalFrom = supabase.from;
supabase.from = (tableName) => {
  if (tableName === 'processos') {
    return {
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: mockProcesso, error: null })
        })
      })
    };
  }
  if (tableName === 'feriados_forense') {
    return {
      select: () => ({
        gte: () => ({
          lte: () => Promise.resolve({ data: [{ data: '2026-06-04', abrangencia: 'nacional', tipo: 'feriado' }], error: null })
        })
      })
    };
  }
  if (tableName === 'eventos_operacionais') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              or: () => Promise.resolve({ data: [], error: null })
            })
          })
        })
      })
    };
  }
  return originalFrom.call(supabase, tableName);
};

async function runTests() {
  try {
    // 1. Caso A: DJEN clássico
    console.log('\n[Teste 1] DJEN clássico - Apelação 15 dias');
    const r1 = await calcularPrazoProcessual({
      processoId: 'dummy-id',
      dataReferencia: '2026-06-03', // Quarta
      prazoDias: 15,
      canalPublicacao: 'djen',
      tipoComunicacao: 'intimacao'
    });
    console.log('Vencimento DJEN:', r1.data_vencimento);
    console.log('Audit Steps DJEN:', r1.auditLogs.map(l => ` - [${l.etapa}]: ${l.descricao} (${l.valor_resultado})`).join('\n'));

    // 2. Caso B: Citação Eletrônica Confirmada - PJ Privada (Regra 5º dia útil)
    console.log('\n[Teste 2] Citação Confirmada - Contestação 15 dias');
    const r2 = await calcularPrazoProcessual({
      processoId: 'dummy-id',
      dataReferencia: '2026-06-03', // Confirmação na Quarta
      prazoDias: 15,
      canalPublicacao: 'domicilio',
      tipoComunicacao: 'citacao',
      statusConfirmacao: 'confirmado',
      naturezaDestinatario: 'pj_privado'
    });
    console.log('Vencimento Citação Confirmada:', r2.data_vencimento);
    console.log('Audit Steps Citação:', r2.auditLogs.map(l => ` - [${l.etapa}]: ${l.descricao} (${l.valor_resultado})`).join('\n'));

    // 3. Caso C: Citação Não Confirmada - PJ Privada (Bloqueado/Físico)
    console.log('\n[Teste 3] Citação Não Confirmada - PJ Privada (Bloqueado)');
    const r3 = await calcularPrazoProcessual({
      processoId: 'dummy-id',
      dataReferencia: '2026-06-03',
      prazoDias: 15,
      canalPublicacao: 'domicilio',
      tipoComunicacao: 'citacao',
      statusConfirmacao: 'nao_confirmado',
      naturezaDestinatario: 'pj_privado'
    });
    console.log('Vencimento PJ Privada Não Confirmada:', r3.data_vencimento, '(Deve ser null)');
    console.log('Alerta Critico:', r3.alerta_critico ? 'SIM (Alerta gerado)' : 'NÃO');

    // 4. Caso D: Intimação Não Confirmada no Domicílio (Tácita 10 dias corridos)
    console.log('\n[Teste 4] Intimação Não Confirmada - Réplica 15 dias (Presumida 10 dias corridos)');
    const r4 = await calcularPrazoProcessual({
      processoId: 'dummy-id',
      dataReferencia: '2026-06-01', // Enviado Segunda 01/06/2026
      prazoDias: 15,
      canalPublicacao: 'domicilio',
      tipoComunicacao: 'intimacao',
      statusConfirmacao: 'nao_confirmado'
    });
    console.log('Vencimento Intimação Tácita:', r4.data_vencimento);
    console.log('Audit Steps Intimação Tácita:', r4.auditLogs.map(l => ` - [${l.etapa}]: ${l.descricao} (${l.valor_resultado})`).join('\n'));

    console.log('\n✅ TESTES DE CONFORMIDADE EXECUTADOS COM SUCESSO!');
  } catch (err) {
    console.error('Erro ao executar testes paramétricos:', err);
  } finally {
    // Restaura o supabase original
    supabase.from = originalFrom;
  }
}

runTests();
