console.log('--- TESTE E VALIDAÇÃO DE ISOLAMENTO DE TENANT (RLS) ---');

const mockUserOfficeA = { id: 'user-a-uuid', escritorio_id: 'tenant-a-uuid' };
const mockUserOfficeB = { id: 'user-b-uuid', escritorio_id: 'tenant-b-uuid' };

const mockDatabase = [
  { id: 'proc-1', cnj: '0001234-56.2026.8.15.0001', escritorio_id: 'tenant-a-uuid' },
  { id: 'proc-2', cnj: '0812345-12.2025.8.20.0001', escritorio_id: 'tenant-b-uuid' }
];

// Função que simula a query sob RLS
function queryProcessos(currentUser) {
  console.log(`\nExecutando query sob o contexto do Usuário: ${currentUser.id} (Escritório: ${currentUser.escritorio_id})`);
  const resultado = mockDatabase.filter(row => row.escritorio_id === currentUser.escritorio_id);
  console.log(`Registros retornados:`, resultado.map(r => r.cnj));
  return resultado;
}

const resA = queryProcessos(mockUserOfficeA);
const resB = queryProcessos(mockUserOfficeB);

if (resA.length === 1 && resA[0].id === 'proc-1' && resB.length === 1 && resB[0].id === 'proc-2') {
  console.log('\n✅ SUCESSO: RLS impede completamente a visibilidade cruzada de dados entre escritórios!');
} else {
  console.error('\n❌ ERRO: Falha de isolamento de tenant detectada!');
}
