# Relatório Master de Arquitetura, Funcionalidades e Integração PJe
## Donna Legal Co-pilot — Versão 2.5 (Enterprise-Grade)

Este relatório documenta oficialmente a totalidade da solução **Donna**, descrevendo seus objetivos estratégicos, capacidades funcionais, arquitetura de software, resiliência offline-first, e a recente integração mTLS nativa com o Processo Judicial Eletrônico (PJe) via MCP Server (Model Context Protocol).

---

## 🏛️ 1. Objetivo da Solução

O objetivo da **Donna** é servir como um **Copiloto Jurídico Estratégico de Próxima Geração** para escritórios de advocacia corporativos de alto padrão no Brasil. 

A plataforma resolve três problemas crônicos da advocacia em grande escala:
1.  **Exaustão e Erro Humano no Cálculo de Prazos**: Automatiza a leitura e a contagem de prazos processuais sob as regras complexas do CPC/15 e resoluções do CNJ, eliminando multas por intempestividade ou inércia.
2.  **Falta de Inteligência Comportamental**: Mapeia a psicologia de julgadores (juízes, relatores e câmaras) para embasar decisões táticas e recursos com dados estatísticos históricos do tribunal.
3.  **Segurança e LGPD nos Dados do PJe**: Permite a extração de dados do PJe e elaboração de petições por Inteligência Artificial (Claude 3.5 Sonnet) sem violar regras de segredo de justiça, expondo dados pessoais ou versionando certificados digitais em código.

---

## 🛠️ 2. O que a Plataforma Faz (Funcionalidades Principais)

### A. Motor 3: Algoritmo de Cálculo de Prazos CNJ/CPC
*   **Timezone Lock (UTC-3)**: Evita falhas de timezone (UTC zero de servidores AWS/Supabase) travando todos os cálculos nas regras oficiais do horário de Brasília.
*   **Citação Eletrônica Confirmada**: Calcula prazos a partir do 5º dia útil subsequente à confirmação ativa do advogado no Domicílio Judicial (Art. 231, IX, CPC).
*   **Citação Não Confirmada (PJ Privada)**: Identifica inércia no recebimento eletrônico de pessoas jurídicas privadas, bloqueia automaticamente o vencimento de prazo na IA (vencimento `null`), e insere alertas operacionais críticos de risco de multa de até 5% sobre o valor da causa (Art. 246, §1º-C do CPC).
*   **Intimação Presumida (Inércia de 10 Dias)**: Computa a leitura fictícia de intimações gerais após a janela de 10 dias corridos de inércia e inicia a contagem de prazos em dias úteis a partir do primeiro dia útil seguinte a essa janela (CNJ Res. 569/2024).

### B. Módulo Juízes & Atores (Comportamento de Magistrados)
*   Armazena e exibe perfis cognitivos detalhados de juízes (legalistas, garantistas), temperamento e preferências processuais.
*   Associa a cada nota estratégica um **Grau de Confiança (1 a 5)** e a respectiva **Proveniência de Origem**, impedindo alucinações de perfis.

### C. Chat IA Tutor Estratégico (Donna Agent)
*   Interface inteligente que atua como conselheira dos advogados (com persona baseada na Donna Paulsen de *Suits*).
*   Utiliza busca semântica em banco de dados de vetores (**RAG**) para embasar teses nos playbooks internos do escritório.
*   **Loop Agentic**: Permite que a IA execute de forma autônoma ferramentas de leitura e busca de processos no PJe, analise os resultados e entregue a resposta jurídica final de forma limpa.

### D. Integração PJe via MCP Server (mTLS e Certificados A1)
*   Conecta a Donna diretamente às APIs REST do **TJPB** (1º e 2º graus) por meio de um processo filho isolado em StdIO utilizando o Model Context Protocol da Anthropic.
*   Suporta handshake TLS mútuo (mTLS) de alta segurança utilizando certificados digitais do tipo **A1 (PKCS#12 / .pfx)**.

---

## ⚙️ 3. Como Funciona (Arquitetura Técnica)

A Donna é estruturada sob o paradigma de **Clean Architecture** e isolamento absoluto de dados:

```
                  ┌──────────────────────────────┐
                  │      Next.js Frontend        │
                  │   (Dashboard, Chat, Perfis)  │
                  └──────────────┬───────────────┘
                                 │ HTTP / SSE
                                 ▼
                  ┌──────────────────────────────┐
                  │    Fastify Backend Server    │
                  │   (Zod Validation, Routing)   │
                  └──────────────┬───────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
┌─────────────────┐                             ┌─────────────────┐
│  PjeService     │                             │  Supabase Cloud │
│ (RateLimiter)   │                             │  (Postgres RLS) │
│ (CircuitBreaker)│                             └────────┬────────┘
└────────┬────────┘                                      │
         ▼                                               ▼
┌─────────────────┐                             ┌─────────────────┐
│CertificateVault │                             │  Fallback Local │
│ (AES-256-GCM)   │                             │   jsonMutex     │
└────────┬────────┘                             └─────────────────┘
         ▼
┌─────────────────┐
│   MCPBridge     │
│ (StdIO Process) │
└─────────────────┘
```

### 1. Multi-Tenancy Isolado no Banco de Dados (PostgreSQL RLS)
*   Inquilinos (escritórios rivais) compartilham a mesma instância do Supabase, mas a visibilidade das carteiras é isolada a nível de banco de dados por políticas de **Row-Level Security (RLS)**.
*   A aplicação Fastify não envia chaves de escritório nas consultas SQL. O PostgreSQL decodifica e filtra os registros automaticamente com base na claim `escritorio_id` decodificada do token JWT autenticado do usuário do advogado.

### 2. Resiliência Offline-First (Mutex de Concorrência)
*   **Fase 1 (Atual)**: Se o Supabase apresentar alta latência ou offline em redes de escritórios, a aplicação faz fallback transparente de leitura e escrita para arquivos JSON locais temporários.
*   Para evitar a corrupção desses arquivos locais sob dezenas de concorrências simultâneas de webhooks, foi implementado o `jsonMutex.js`, um semáforo Promise-based reentrante que enfileira escritas de forma sequencial.
*   **Fase 2 (Destino)**: Transição para banco de dados local SQLite sincronizado por worker de segundo plano.

### 3. Comunicação JSON-RPC 2.0 (MCP Bridge)
*   A classe `MCPBridge` controla o processo filho do MCP Server no Node.js via StdIO. A Donna envia requisições estruturadas no formato JSON-RPC 2.0. A ponte realiza o handshake regulamentar do protocolo MCP (com o fluxo `initialize` -> `notifications/initialized`) e monitora a queda do processo reiniciando-o em background.

---

## 🔒 4. O que Já Fizemos e Implementamos (Marcos Recentes)

Nas etapas recentes de evolução do projeto (Donna V2.1 a V2.5), concluímos as seguintes entregas críticas de nível de engenharia de software sênior:

1.  **Homologação do schema.sql e deadlineService.js**: Banco de dados centralizado estruturado com tabelas de auditoria, triggers e enums CNJ, e motor de prazos de precisão em dias úteis.
2.  **Criação de Ativos Visuais Premium**: Geramos mockups de alta fidelidade em modo escuro para o Cockpit Estratégico (Dashboard), Juízes & Atores (Behaviors), Console de Chat com playbooks RAG e Linha do Tempo de Prazos CNJ, inserindo-os no repositório.
3.  **Pje MCP Server local compilado**: Clonamos o repositório `./services/pje-mcp-server`, corrigimos dependências e compilamos o TypeScript sem erros de tipos.
4.  **Criação de pje-config.ts (Zod Validation)**: Validador "fail-fast" no boot que assegura que todas as variáveis do `.env.donna` necessárias para o PJe TJPB e certificados digitais existam e estejam em conformidade.
5.  **Cofre de Certificados AES-256-GCM (`CertificateVault`)**: Carregamento único do PFX em disco e criptografia de chave/IV efêmeros em memória. O cofre faz *auto-wipe* (sobrescrita física com zeros) após 12 horas e avisa na telemetria se o certificado digital expirar em 30 dias.
6.  **PjeService com Proteções de Infraestrutura**:
    *   **Rate Limiting**: Bloqueia requisições localmente se o usuário disparar mais de **60 consultas por minuto**, evitando punição por WAF do tribunal.
    *   **Circuit Breaker**: O circuito abre por **30 segundos** após **5 erros consecutivos** de conexão StdIO, impedindo loops infinitos e exaustão de processamento.
7.  **Conformidade de Privacidade (`LgpdHandler`)**: Algoritmo de classificação de dados judiciais que pseudonimiza CPFs/CNPJs e nomes de testemunhas/terceiros. Registra Logs de Auditoria de legalidade com a base jurídica do Artigo 7º, Inciso VI da LGPD.
8.  **SIEM Audit Logger (`audit-logger.ts`)**: Registra dados de auditoria de uso no arquivo local append-only `logs/audit.log` formatado em JSON para indexação automatizada por sistemas SIEM (Splunk, Datadog), bloqueando vazamentos de payloads.
9.  **Dockerização e Observabilidade**:
    *   Criado o Dockerfile de produção multi-stage Node 20 Alpine rodando como usuário não-root.
    *   Endpoint `/health` para monitoramento do Supabase, Vault e chaves da Anthropic.
    *   Expositor `/metrics` com métricas em formato textual aceito pelo Prometheus.
10. **Documentação Operacional Pushed**: Criado o checklist de go-live, guia de variáveis de ambiente de produção, runbook de incidentes (LGPD Art. 48) e rotação de certificados, além do mapeamento legal `LGPD_DATA_MAPPING.md`.
11. **Testes Completos Versionados**: Escrito os testes unitários com Jest e scripts de validação CLI via `curl`.
