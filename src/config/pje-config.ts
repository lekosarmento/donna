import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Carrega as variáveis de ambiente do arquivo local
dotenv.config();

/**
 * Schema de validação Zod para as variáveis de ambiente da integração com o PJe.
 * Define tipos estritos, valores padrão seguros e mensagens de erro explícitas.
 */
const pjeConfigSchema = z.object({
  PJE_BASE_URL: z.string().url({ message: 'PJE_BASE_URL precisa ser uma URL válida.' }),
  PJE_APP_NAME: z.string().min(1, { message: 'PJE_APP_NAME não pode ser vazio.' }),
  PJE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  PJE_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  PJE_CERTIFICATE_PFX_PATH: z.string().min(1, { message: 'PJE_CERTIFICATE_PFX_PATH é obrigatório.' }),
  PJE_CERTIFICATE_PFX_PASSWORD: z.string().min(1, { message: 'PJE_CERTIFICATE_PFX_PASSWORD é obrigatória.' }),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORRELATION_ID_HEADER: z.string().default('x-correlation-id'),
});

/**
 * Tipo correspondente ao schema de configuração validado do PJe.
 */
export type PjeConfig = z.infer<typeof pjeConfigSchema>;

/**
 * Valida todas as variáveis de ambiente necessárias para a integração do PJe com a Donna.
 * Este método executa um padrão de validação "fail-fast" na inicialização e garante a
 * integridade física do certificado ICP-Brasil.
 * 
 * @returns {Readonly<PjeConfig>} Um objeto imutável contendo as configurações validadas.
 * @throws {Error} Lança um erro detalhado se houver falha de validação ou se o certificado digital não for localizado.
 */
function validateAndLoadConfig(): Readonly<PjeConfig> {
  const parseResult = pjeConfigSchema.safeParse(process.env);

  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues
      .map(issue => `[${issue.path.join('.')}]: ${issue.message}`)
      .join(', ');

    // Log estruturado em formato JSON (sem vazar dados confidenciais)
    const logObj = {
      level: 'error',
      timestamp: new Date().toISOString(),
      correlationId: 'STARTUP',
      message: 'Falha de inicialização: Variáveis de ambiente da integração PJe inválidas.',
      error: errorDetails,
    };
    console.error(JSON.stringify(logObj));
    throw new Error(`Falha crítica de inicialização do PJe: ${errorDetails}`);
  }

  const validatedConfig = parseResult.data;

  // Resolução do caminho do certificado e validação de existência
  const absoluteCertPath = path.resolve(validatedConfig.PJE_CERTIFICATE_PFX_PATH);

  try {
    if (!fs.existsSync(absoluteCertPath)) {
      const logObj = {
        level: 'error',
        timestamp: new Date().toISOString(),
        correlationId: 'STARTUP',
        message: 'Falha de inicialização: O arquivo do certificado digital A1 (.pfx/.p12) não foi encontrado no caminho especificado.',
        resolvedPath: absoluteCertPath,
      };
      console.error(JSON.stringify(logObj));
      throw new Error(`Certificado digital A1 não localizado no caminho: ${absoluteCertPath}`);
    }
  } catch (error) {
    // Se o erro foi lançado intencionalmente por não existência, repassa
    if (error instanceof Error && error.message.includes('não localizado')) {
      throw error;
    }
    
    // Tratamento granular de outros erros de acesso ao sistema de arquivos (permissões, etc.)
    const errorMsg = error instanceof Error ? error.message : String(error);
    const logObj = {
      level: 'error',
      timestamp: new Date().toISOString(),
      correlationId: 'STARTUP',
      message: 'Erro ao validar a acessibilidade física do arquivo de certificado digital.',
      resolvedPath: absoluteCertPath,
      error: errorMsg,
    };
    console.error(JSON.stringify(logObj));
    throw new Error(`Erro de permissão ou leitura ao acessar o certificado digital no caminho: ${absoluteCertPath}. Detalhes: ${errorMsg}`);
  }

  // Log estruturado de sucesso ocultando credenciais e senhas sensíveis
  const successLogObj = {
    level: 'info',
    timestamp: new Date().toISOString(),
    correlationId: 'STARTUP',
    message: 'Configuração de conexão PJe e certificado digital carregados e validados com sucesso.',
    config: {
      PJE_BASE_URL: validatedConfig.PJE_BASE_URL,
      PJE_APP_NAME: validatedConfig.PJE_APP_NAME,
      PJE_TIMEOUT_MS: validatedConfig.PJE_TIMEOUT_MS,
      PJE_MAX_RETRIES: validatedConfig.PJE_MAX_RETRIES,
      PJE_CERTIFICATE_PFX_PATH: absoluteCertPath,
      PJE_CERTIFICATE_PFX_PASSWORD: '[PROTEGIDO]',
      LOG_LEVEL: validatedConfig.LOG_LEVEL,
      CORRELATION_ID_HEADER: validatedConfig.CORRELATION_ID_HEADER,
    },
  };
  console.log(JSON.stringify(successLogObj));

  // Retorna o objeto congelado (imutabilidade)
  return Object.freeze(validatedConfig);
}

/**
 * Instância única e imutável de configuração do PJe validada no boot da aplicação.
 */
export const pjeConfig: Readonly<PjeConfig> = validateAndLoadConfig();
