# Variáveis de Ambiente em Produção — Integração PJe

Este documento descreve todas as variáveis de ambiente necessárias para a execução segura da integração da Donna com o PJe MCP Server em ambientes produtivos, detalhando sua classificação de segurança e a estratégia de injeção em contêineres.

---

## 1. Inventário de Variáveis de Ambiente

| Variável | Descrição | Classificação | Valor Recomendado |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Define o ambiente de runtime do Node.js. | **Pública** | `production` |
| `PORT` | Porta utilizada pelo painel de controle e métricas. | **Pública** | `3000` |
| `PJE_BASE_URL` | URL do PJe do Tribunal de destino. | **Pública** | `https://pje.tjpb.jus.br` |
| `PJE_APP_NAME` | Nome identificador do app cliente. | **Pública** | `pje-tjpb-1g` |
| `PJE_TIMEOUT_MS` | Tempo máximo de resposta para conexões de tribunal. | **Pública** | `30000` |
| `PJE_MAX_RETRIES` | Máximo de tentativas de reconexão de rede. | **Pública** | `3` |
| `LOG_LEVEL` | Nível dos logs internos (evitar debug em prod). | **Pública** | `info` |
| `CORRELATION_ID_HEADER` | Cabeçalho usado para correlationId. | **Pública** | `x-correlation-id` |
| `PJE_CERTIFICATE_PFX_PATH` | Caminho do arquivo físico do certificado (.pfx). | **Sensível** | `/usr/src/app/certs/certificado_tjpb.pfx` |
| `PJE_CERTIFICATE_PFX_PASSWORD` | Senha do certificado digital A1. | **Secreta** | *Ocultado via KMS* |
| `ANTHROPIC_API_KEY` | Chave de autenticação da IA da Anthropic (Claude). | **Secreta** | *Ocultado via KMS* |

### Definições de Classificação:
*   **Pública**: Informações de configuração geral não confidenciais. Podem ser inseridas diretamente no arquivo de configuração do Helm Chart, Docker Compose ou variables do Kubernetes.
*   **Sensível**: Informações estruturais que identificam caminhos internos ou nomes. Recomenda-se cautela, mas não representam perigo isolado.
*   **Secreta**: Chaves privadas, tokens ou senhas que conferem acesso administrativo ou civil. **NUNCA devem ser mantidas em arquivos planos ou logs.**

---

## 2. Injeção Criptografada via Secret Manager

Em produção, variáveis classificadas como **Secreta** devem ser injetadas em tempo de execução via **Secret Manager** (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, Google Secret Manager ou Doppler).

### Fluxo de Injeção de Variáveis:
```
[Doppler / Secret Manager] ──► [Injeção em Tempo de Execução] ──► [Memória RAM da Donna]
```

---

## 3. Injeção do Certificado Digital A1 (PFX) via Secret

Como imagens Docker devem ser imutáveis e **nunca** empacotar chaves criptográficas em seus arquivos de build (Camadas de Imagem), o arquivo PFX do certificado deve ser injetado dinamicamente:

### Passo 1: Converter o certificado para Base64
Execute localmente em sua máquina segura de infraestrutura:
```bash
# Linux/macOS
base64 -i certificado_tjpb.pfx -o certificado_base64.txt

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificado_tjpb.pfx")) > certificado_base64.txt
```

### Passo 2: Armazenar no Secret Manager
Salve o conteúdo do arquivo `certificado_base64.txt` como uma variável secreta chamada `PJE_CERTIFICATE_PFX_BASE64` no seu Secret Manager.

### Passo 3: Decodificar e Montar no Contêiner no Startup
Adicione o seguinte script de ponto de entrada (`entrypoint.sh`) ou configure no manifesto de implantação do contêiner para decodificar o arquivo antes da aplicação subir:

```bash
#!/bin/sh
# Decodificar o certificado armazenado como variável base64 em disco
if [ -n "$PJE_CERTIFICATE_PFX_BASE64" ]; then
    echo "Decodificando certificado digital A1 a partir das secrets..."
    echo "$PJE_CERTIFICATE_PFX_BASE64" | base64 -d > /usr/src/app/certs/certificado_tjpb.pfx
    # Limpar a variável do ambiente de processos para evitar vazamentos
    unset PJE_CERTIFICATE_PFX_BASE64
fi

# Inicializar a aplicação
exec "$@"
```
> **Segurança**: Isso garante conformidade com a LGPD e políticas ICP-Brasil, pois a chave privada existe apenas fisicamente dentro do contêiner ativo em tempo de execução.
