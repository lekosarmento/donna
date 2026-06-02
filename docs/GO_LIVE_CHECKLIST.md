# Checklist de Go-Live — Integração PJe MCP Server & Donna

Este checklist consolida todos os requisitos técnicos, de segurança, de conformidade com a LGPD e operacionais que devem ser inspecionados e aprovados antes de liberar a integração com o PJe para uso em produção por escritórios de advocacia parceiros.

---

## 🛡️ 1. Segurança do Certificado Digital A1

- [ ] **Exclusão de Git Verificada**: Confirmar que o diretório `certs/` e os arquivos com extensão `*.pfx` e `*.p12` estão listados no `.gitignore` raiz e não constam no histórico de commits do repositório remoto.
- [ ] **Permissões do Sistema de Arquivos**: O diretório físico onde o certificado A1 reside deve ter permissões restritas a nível de sistema operacional (apenas o usuário de execução da aplicação Donna deve possuir direitos de leitura).
- [ ] **Configuração do Auto-Wipe**: Validar que o tempo de expiração do cache do `CertificateVault` (padrão de 12 horas) está ativo e limpando as chaves através de sobrescrita física de bytes (`Buffer.fill(0)`).
- [ ] **Mapeamento de Logs**: Certificar que o console logger e as ferramentas SIEM nunca registram o campo `PJE_CERTIFICATE_PFX_PASSWORD` ou chaves privadas brutas sob qualquer circunstância.
- [ ] **Validação de Cadeia SSL**: Confirmar que a verificação de certificados SSL (`rejectUnauthorized: true`) está habilitada para o ambiente de produção, evitando brechas de ataque Man-in-the-Middle (MitM).

---

## ⚖️ 2. Conformidade com a LGPD (Lei nº 13.709/2018)

- [ ] **Minimização de Dados Ativa**: Validar que a função `LgpdHandler.pseudonimizeProcesso` está ativada no fluxo de busca do PJe, mascarando CPFs/CNPJs e nomes de terceiros (testemunhas/peritos).
- [ ] **Segredo de Justiça**: Testar se os processos de Varas de Família e Sucessões estão tendo seus dados e nomes de partes principais ofuscados em conformidade com o Artigo 189 do CPC e segredo de justiça.
- [ ] **TTL do Cache de Dados**: Verificar se o cache de processos no `PjeService` está configurado para expirar de forma estrita após **5 minutos** (`CACHE_TTL_MS = 300000`).
- [ ] **Log de Base Legal**: Confirmar se cada consulta realizada no PJe gera um registro com a base legal correspondente (Artigo 7º, Inciso VI - Exercício Regular de Direitos).
- [ ] **Apagamento de Petições Temporárias**: Garantir que o diretório temporário `uploads/` exclua fisicamente os arquivos PDF de petições imediatamente após a transmissão para o PJe.

---

## 📊 3. Monitoramento, Alertas e Resiliência

- [ ] **Logs de Auditoria no SIEM**: Verificar se os logs de auditoria estruturados (JSON) estão sendo gravados de forma contínua no arquivo append-only `logs/audit.log` e se os campos `correlationId`, `userId` e `action` estão presentes.
- [ ] **Alerta de Expiração de Certificado**: Testar se o sistema emite um alerta operacional na telemetria (nível `warn`) 30 dias antes do vencimento do certificado digital.
- [ ] **Circuit Breaker Testado**: Validar se o Circuit Breaker abre após 5 falhas consecutivas de conexão com o PJe MCP Server e se bloqueia requisições durante o cooldown de 30 segundos.
- [ ] **Rate Limiting por Usuário**: Testar o limite local de segurança de até **60 requisições por minuto** por usuário (`operadorId`) para impedir o bloqueio de infraestrutura pelo tribunal.

---

## 🔄 4. Resiliência Operacional (Fallback e Backup)

- [ ] **Fallback Local Ativo**: Garantir que as rotas de persistência utilizem o semáforo transacional `jsonMutex` em caso de instabilidade com o banco central Supabase.
- [ ] **Rastreamento por Correlation ID**: Validar que o cabeçalho `x-correlation-id` é gerado no request e propagado até o bridge do MCP Server, garantindo o rastreamento fim-a-fim de bugs operacionais.

---

## 📝 5. Requisitos Jurídicos e Contratuais

- [ ] **Termos de Uso e Política de Privacidade**: Certificar que o escritório possui termos que avisam explicitamente os colaboradores e clientes sobre o tratamento de dados processuais por algoritmos de inteligência artificial de forma segura.
- [ ] **Consentimento e Procuração**: Verificar se a cláusula de autorização para tratamento automatizado de dados processuais está incluída nos modelos de contrato e procuração dos clientes do escritório.
