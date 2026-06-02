# Runbook de Operações — Integração PJe MCP Server

Este manual de operações descreve os procedimentos de suporte, manutenção e resposta a incidentes de segurança para a integração da Donna com o ecossistema do PJe.

---

## 🚀 1. Reinicialização do MCP Server (Zero Downtime)

Como a comunicação entre a Donna e o PJe MCP Server baseia-se em um processo filho (`spawn` sobre StdIO) controlado pela classe `MCPBridge`, a reinicialização pode ser feita de duas formas sem interromper o serviço principal da Donna:

### Procedimento Automatizado (Reconexão Automática):
A ponte `MCPBridge` possui um watcher de eventos de fechamento de processo (`close`). Se o subprocesso do MCP cair ou for finalizado, a Donna reconectará automaticamente no background de forma silenciosa dentro de 5 segundos.

### Comando Manual para Reinicialização Segura (Soft Restart):
Para recarregar o servidor MCP sem derrubar a API da Donna:
1. Acesse o console administrativo ou execute uma chamada de desativação enviando o sinal `SIGTERM` ao processo filho.
2. O `MCPBridge` detectará a queda, esvaziará a fila de chamadas com rejeições controladas (que cairão no RAG local ou fallbacks locais do Chat) e subirá o processo filho novamente:
   ```bash
   # Identificar o PID do processo MCP (Node)
   ps aux | grep pje-mcp-server
   
   # Encerrar de forma controlada (SIGTERM)
   kill -15 <PID_DO_MCP_SERVER>
   ```

---

## 🔐 2. Rotação do Certificado Digital A1 (Zero Downtime)

Para renovar ou rotacionar o certificado digital ICP-Brasil sem causar interrupções nas consultas processuais dos advogados:

1.  **Codifique o novo certificado PFX** em base64:
    ```bash
    base64 -i novo_certificado_tjpb.pfx -o novo_base64.txt
    ```
2.  **Atualize o valor na Secret**: Altere a variável secreta `PJE_CERTIFICATE_PFX_BASE64` e `PJE_CERTIFICATE_PFX_PASSWORD` no seu Secret Manager (AWS/Doppler).
3.  **Forçar atualização do Vault**:
    A Donna possui um endpoint administrativo interno para recarregar o cofre sem reiniciar o servidor. Envie uma requisição autenticada de reload:
    ```bash
    curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:3000/api/admin/vault/reload
    ```
    *Como funciona*: O Vault lerá a nova secret de ambiente decodificada, validará a validade e substituirá os buffers criptografados em memória RAM de forma atômica. Handshakes subsequentes utilizarão a nova chave instantaneamente.

---

## 🔍 3. Diagnóstico de Falhas de Autenticação

Caso o PJe retorne erros de autenticação (HTTP 401 ou 403) ou o status retorne `Falha de Autenticação com Certificado`:

| Sintoma | Causa Provável | Ação de Resolução |
| :--- | :--- | :--- |
| **Erro: Certificado expirado** | A data de expiração do PFX foi atingida. | Efetue a rotação do certificado seguindo a Seção 2 deste Runbook. |
| **Erro: CPF não cadastrado** | O titular do certificado não está cadastrado no sistema do PJe do TJPB. | O advogado titular deve acessar o portal do PJe (`https://pje.tjpb.jus.br`) via navegador e completar seu cadastro. |
| **HTTP 403 Forbidden** | O IP do servidor da Donna foi temporariamente bloqueado por exceder o rate limit do tribunal. | Aguarde 15 minutos pelo desbloqueio do WAF do tribunal. Garanta que o rate limiter do `PjeService` está ativo. |
| **Erro: Senha PFX Inválida** | A chave secreta inserida no `PJE_CERTIFICATE_PFX_PASSWORD` está incorreta. | Recupere a senha correta e atualize-a no Secret Manager. |

---

## 🚨 4. Resposta a Incidentes de Segurança com Dados Pessoais (LGPD Art. 48)

Conforme exige o Artigo 48 da Lei nº 13.709/2018 (LGPD), qualquer incidente de segurança envolvendo dados processuais coletados que possa acarretar risco ou dano relevante aos titulares deve ser comunicado à ANPD e aos titulares.

### Protocolo de Ação Imediata (Incident Response Plan):
1.  **Contenção Imediata (Triage)**:
    Se for identificado vazamento ou acesso não autorizado, derrube o Vault temporariamente para bloquear o acesso às chaves do PJe:
    ```typescript
    // Executa a limpeza física da memória
    CertificateVault.getInstance().wipe();
    ```
2.  **Identificação do Escopo**:
    Acesse o arquivo append-only de auditoria `/usr/src/app/logs/audit.log` filtrando pelo `correlationId` suspeito para rastrear quais processos e dados pessoais foram visualizados e por qual credencial de usuário (`userId`).
3.  **Elaboração do Relatório de Impacto**:
    Documente o incidente preenchendo as informações exigidas pelo art. 48, § 1º:
    *   Descrição da natureza dos dados pessoais afetados;
    *   Indicação das medidas de segurança técnicas utilizadas;
    *   Riscos potenciais aos titulares;
    *   Medidas adotadas para reverter ou mitigar o prejuízo.
4.  **Comunicação Oficial**:
    Acione a Assessoria Jurídica e o Encarregado de Proteção de Dados (DPO) do escritório parceiro para enviar a notificação formal à ANPD em até 48 horas úteis.

---

## 📞 5. Contatos de Suporte e Escalação

*   **TI / Suporte Técnico PJe (TJPB)**:
    *   *Canal Oficial*: Central de Serviços de TI TJPB
    *   *Telefone*: (83) 3216-1400 (Suporte PJe 1º e 2º Graus)
    *   *E-mail*: pje.suporte@tjpb.jus.br
*   **Emissora de Certificados ICP-Brasil**:
    *   *Contato*: Central de Suporte da Autoridade Certificadora emissora (ex: Certisign, Serasa Experian, OAB Federal).
    *   *Finalidade*: Revogação em caso de suspeita de comprometimento da chave privada ou renovação de mídia.
