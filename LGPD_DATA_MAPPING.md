# Mapeamento de Dados e Conformidade LGPD (Lei nº 13.709/2018)
## Sistema Donna — Integração PJe MCP Server

Este documento descreve as categorias de dados pessoais tratados pela integração do PJe MCP Server com o backend da Donna, identificando sua classificação, base legal de tratamento, finalidades e políticas de descarte e retenção.

---

## 1. Inventário e Classificação de Dados

| Categoria de Dado | Campos Específicos | Classificação LGPD | Sensibilidade |
| :--- | :--- | :--- | :--- |
| **Identificadores Civis das Partes** | Nome completo, CPF, CNPJ, Razão Social | Dado Pessoal Comum | Baixa / Média |
| **Dados Profissionais** | Nome do Advogado, Registro OAB | Dado Pessoal Comum | Baixa |
| **Metadados Processuais** | Número de processo CNJ, Vara, Classe, Assunto, Tribunal | Dado Comum / Público | Nula |
| **Metadados de Contato** | Endereço residencial/comercial, telefone, e-mail (se constar nas petições) | Dado Pessoal Comum | Média |
| **Dados Judiciais de Família** | Divórcio, pensão alimentícia, guarda de menores, partilha | Dado Pessoal Comum / Sensível | **Alta** (Segredo de Justiça) |
| **Dados Médicos e Previdenciários** | Laudos médicos, atestados, prontuários (em ações de saúde ou previdenciárias) | **Dado Pessoal Sensível** (Art. 5º, II) | **Crítica** |

---

## 2. Bases Legais de Tratamento (Art. 7º e Art. 11 da LGPD)

Todo o fluxo de processamento de dados realizado pela Donna baseia-se em hipóteses legais estritas:

1. **Exercício Regular de Direitos em Processo Judicial (Art. 7º, inciso VI)**:
   * **Aplicação**: Coleta de dados processuais do PJe, análise comportamental de magistrados e andamentos processuais para elaboração de defesas, recursos e petições.
   * **Justificativa**: O tratamento de dados das partes adversas e advogados é indispensável para viabilizar o exercício da advocacia privada constitucionalmente protegida (Art. 133 CF/88).

2. **Execução de Contrato de Prestação de Serviços (Art. 7º, inciso V)**:
   * **Consenso/Contrato**: O tratamento de dados dos clientes do escritório (outorgantes) decorre diretamente do contrato de prestação de serviços de advocacia e procuração ad judicia.

3. **Tratamento de Dados Sensíveis - Exercício de Direitos (Art. 11, inciso II, alínea 'd')**:
   * **Justificativa**: A análise de laudos médicos ou dados de direito de família destina-se exclusivamente à defesa em juízo da saúde ou direitos civis do titular.

---

## 3. Fluxo de Minimização e Pseudonimização

Para mitigar o risco de acessos indevidos e vazamento de dados, a Donna implementa os seguintes controles técnicos automatizados:

*   **Mascaramento de Documentos**: CPFs e CNPJs de todas as partes consultadas no PJe são filtrados antes do armazenamento em cache e exposição na IA, mantendo apenas a identificação parcial (Ex: `***.***.567-00`).
*   **Pseudonimização de Terceiros**: Nomes de testemunhas, peritos ou terceiros não relacionados diretamente como Autor ou Réu são ofuscados automaticamente no nível do serviço (Ex: `Maria Silva Santos` torna-se `Maria S. S.`).
*   **Mascaramento em Segredo de Justiça**: Processos de Varas de Família sofrem ofuscamento integral de nomes de todas as partes nas exibições da interface de conversação.

---

## 4. Política de Retenção e Descarte

| Tipo de Recurso | Repositório | Tempo de Retenção | Método de Descarte |
| :--- | :--- | :--- | :--- |
| **Cache de Processos** | Memória RAM (`PjeService.cache`) | **5 minutos** (TTL estrito) | Expiração automática do timer do cache com limpeza total das variáveis. |
| **Logs de Auditoria (SIEM)** | Arquivo local (`logs/audit.log`) | **5 anos** (Finalidade de prova legal e auditoria) | Arquivamento histórico e expurgo após prescrição. |
| **Arquivos de Petições Temporárias** | Diretório local (`uploads/`) | **Imediato** (Excluído logo após o protocolo no PJe) | Apagamento definitivo do arquivo em disco via módulo `fs.unlink`. |
| **Chave de Certificado Digital** | Memória criptografada (`CertificateVault`) | **12 horas** (Auto-wipe de sessão) | Sobrescrita física das chaves criptográficas com zeros (`Buffer.fill(0)`). |

---

## 5. Medidas de Segurança da Informação (Art. 46)

1. **Criptografia em Repouso e Memória**: Chaves privadas de certificados A1 nunca são mantidas descriptografadas na heap V8 do Node.js.
2. **Logs de Auditoria Imutáveis**: Todas as operações que envolvem leitura de dados pessoais no PJe geram um registro SIEM imutável em arquivo local append-only, rastreando o `operadorId`, `timestamp`, `action` e `correlationId`.
3. **Isolamento de Tenant**: A segurança a nível de banco de dados (Row Level Security) garante que escritórios de advocacia concorrentes nunca compartilhem ou acessem caches ou logs de auditoria de terceiros.
