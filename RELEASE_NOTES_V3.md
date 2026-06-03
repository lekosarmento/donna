# Notas de Versão — Donna Copiloto Jurídico V3.0

Esta versão marca a maturação da Donna para o go-live corporativo com o primeiro escritório piloto. A arquitetura foi expandida para suportar isolamento estrito de tenants, criptografia de ponta a ponta em conformidade com a LGPD e resiliência offline-first.

---

## Principais Novidades da V3.0

### 1. Onboarding Seguro & Web Cryptography (ICP-Brasil)
- **Criptografia Client-side:** O certificado digital A1 (.pfx) é criptografado localmente no browser usando a **Web Crypto API** com chave AES-GCM de 256 bits derivada de 100.000 iterações PBKDF2.
- **Transmissão e Cofre:** O backend recebe apenas o binário cifrado, salt e IV. A senha do certificado é transmitida e mantida exclusivamente na memória operacional do `CertificateVault` para testes de conexão e handshakes TLS, sendo limpa após 12 horas por auto-wipe (sobrescrita com zeros) ou rotação.

### 2. Resiliência Offline Fase 2 (SQLite Local)
- **Substituição do Legado:** Migração completa da persistência local baseada em arquivos JSON isolados (`jsonMutex.js`) para um banco de dados estruturado local **SQLite** (`better-sqlite3`).
- **Sincronismo em Background:** Worker rodando em thread separada (`sync-worker.ts`) que monitora gravações locais pendentes e resolve conflitos de concorrência com o Supabase utilizando a estratégia *Last-Write-Wins*.

### 3. Compliance LGPD & Segredo de Justiça (Art. 189 CPC)
- **Detecção Automática:** O pipeline analisa classes do CNJ e sinalizadores de sigilo das APIs dos tribunais.
- **Bloqueio Dinâmico:** Processos em segredo de justiça são bloqueados na camada de serviço (`SigiloGuard`) e apenas advogados que comprovem representação ou façam parte da lide podem acessá-los.

### 4. Pipeline de Profiling Cognitivo de Magistrados
- **Ingestão Qualitativa:** Scraper de decisões em diários de justiça e jurisprudências de tribunais (com delays de 2s e fallback local).
- **Análise Qualitativa:** Uso de Claude 3.5 Sonnet para traçar estilos de fundamentação e preferências de provas dos juízes, com cálculo estatístico de *Grau de Confiança* baseada no volume amostral de acórdãos/sentenças.

### 5. Painel Administrativo de Compliance
- **Métricas Operacionais:** Monitoramento de tokens gastos na nuvem, total de processos sob custódia e taxa de requisições ao PJe.
- **Controle de Tenant e Planos:** Habilitação dos tiers de planos `starter` (1 usuário), `professional` (10 usuários + RAG) e `enterprise` (ilimitado) com controle nativo de limites por RLS.

---

## Hardening de Segurança (V3.0)

Durante a fase de go-live, as seguintes medidas de blindagem foram aplicadas:
1. **Sanitização de File Uploads:** Prevenção de Path Traversal no RAG usando `path.basename` para higienizar nomes de arquivos e isolar execuções de buffers em memória.
2. **Defesa contra Prompt Injection:** Criação de barreira de validação no Zod e nos controladores de chat para filtrar e rejeitar strings contendo instruções de controle do sistema ("ignore previous instructions", "system override", "jailbreak").
3. **CORS Dinâmico:** Whitelist de origens autorizadas restringindo o tráfego em produção às URIs registradas na variável de ambiente `ALLOWED_ORIGINS`.

---

## Breaking Changes e Compatibilidade

> [!WARNING]
> * **Persistência Local:** O arquivo legado de processos e conversas em JSON foi descontinuado. No primeiro boot da V3.0, a migração lê e ingere automaticamente os dados legados para o arquivo `donna-local.db` e zera as listas JSON.
> * **Autenticação PFX:** Senhas do certificado PFX não podem mais ser enviadas ou persistidas em variáveis de ambiente globais de produção por motivos de compliance.

---

## Guia de Migração (V2.5 para V3.0)

### Passo 1: Executar Migrações do Supabase
Rode no console de SQL do Supabase os seguintes arquivos na ordem indicada:
1. [schema.sql](file:///d:/Donna/schema.sql) (Atualizações de enums de perfil)
2. [schema_judges.sql](file:///d:/Donna/schema_judges.sql) (Tabelas de magistrados)
3. [schema_onboarding.sql](file:///d:/Donna/schema_onboarding.sql) (Planos e assinaturas)

### Passo 2: Atualizar Variáveis de Ambiente
Adicione ao seu arquivo `.env` de produção:
```env
# CORS Whitelist (separado por vírgula)
ALLOWED_ORIGINS=https://app.donna.com.br,https://admin.donna.com.br

# SQLite path
DATABASE_URL=./data/donna-local.db
```

### Passo 3: Iniciar o Servidor
Execute a instalação de dependências e inicie o bootstrap automático do SQLite:
```bash
npm install
npm run dev
```
O servidor migrará automaticamente qualquer dado JSON legado existente e criará a estrutura no banco local SQLite.
