#!/bin/bash
# ==============================================================================
# SCRIPT DE VALIDAÇÃO DE CONEXÃO DIRETA COM O PJE DO TJPB
# ==============================================================================
# Este script executa um teste de conectividade mTLS usando curl e o certificado
# digital A1 (PFX) contra os endpoints de API oficiais do TJPB.

# Carregar variáveis de ambiente locais caso existam
if [ -f "d:/Donna/services/pje-mcp-server/.env.donna" ]; then
    source "d:/Donna/services/pje-mcp-server/.env.donna"
else
    # Fallbacks padrão para o TJPB
    PJE_BASE_URL="https://pje.tjpb.jus.br"
    PJE_CERTIFICATE_PFX_PATH="d:/Donna/certs/certificado_tjpb.pfx"
    PJE_CERTIFICATE_PFX_PASSWORD="sua_senha_aqui"
fi

echo "======================================================================"
echo "⚡ INICIANDO VALIDAÇÃO DE CONEXÃO TJPB MÚTUO TLS (mTLS)"
echo "======================================================================"
echo "🎯 URL Destino: $PJE_BASE_URL"
echo "🔐 Certificado: $PJE_CERTIFICATE_PFX_PATH"
echo "----------------------------------------------------------------------"

# 1. Validar existência física do certificado local
if [ ! -f "$PJE_CERTIFICATE_PFX_PATH" ]; then
    echo "❌ ERRO: Certificado PFX não encontrado no caminho especificado!"
    echo "Caminho esperado: $PJE_CERTIFICATE_PFX_PATH"
    exit 1
fi

# 2. Executar teste curl de handshake mTLS (Consultando o Endpoint de Status do PJe)
# O parâmetro '--cert-type P12' indica que estamos usando o arquivo PFX de identidade criptográfica diretamente.
echo "🔄 Testando handshake SSL/TLS com o tribunal..."
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  --cert-type P12 \
  --cert "$PJE_CERTIFICATE_PFX_PATH:$PJE_CERTIFICATE_PFX_PASSWORD" \
  -k \
  "$PJE_BASE_URL/api/v1/status" 2>/dev/null)

if [ "$STATUS_CODE" -eq 200 ] || [ "$STATUS_CODE" -eq 401 ] || [ "$STATUS_CODE" -eq 403 ]; then
    echo "✅ Handshake TLS concluído com sucesso! Código HTTP: $STATUS_CODE"
    echo "O servidor respondeu e a conexão de rede mTLS (camada de transporte) está OK."
else
    echo "❌ FALHA: Ocorreu um erro ao negociar o handshake mTLS com o tribunal."
    echo "Código de resposta HTTP obtido: $STATUS_CODE"
    echo "Dicas: Verifique o status dos serviços do TJPB e se a senha do certificado está correta."
    exit 1
fi

echo "----------------------------------------------------------------------"
echo "📖 RELAÇÃO DE ENDPOINTS INTERNOS DO PJE UTILIZADOS PELO MCP SERVER:"
echo "----------------------------------------------------------------------"
echo "1. Autenticação por mTLS:   POST $PJE_BASE_URL/api/v1/auth/certificate"
echo "2. SSO OAuth2 / Tokens:     POST $PJE_BASE_URL/oauth/token"
echo "3. Consulta de Processo:    GET  $PJE_BASE_URL/api/v1/processos/{id}"
echo "4. Listagem / Pesquisa:     GET  $PJE_BASE_URL/api/v1/processos"
echo "5. Órgãos Julgadores:       GET  $PJE_BASE_URL/api/v1/orgaos-julgadores"
echo "6. Classes Processuais:     GET  $PJE_BASE_URL/api/v1/classes"
echo "7. Assuntos CNJ:            GET  $PJE_BASE_URL/api/v1/assuntos"
echo "======================================================================"
