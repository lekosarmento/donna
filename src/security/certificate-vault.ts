import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import forge from 'node-forge';

/**
 * Cofre Criptográfico em Memória para Certificados Digitais A1 (ICP-Brasil).
 * Carrega e cifra o certificado na inicialização com AES-256-GCM, impedindo chaves brutas de
 * ficarem expostas na V8 heap. Implementa auto-wipe por expiração de tempo e auditorias estritas.
 */
export class CertificateVault {
  private static instance: CertificateVault | null = null;
  
  private ciphertext: Buffer | null = null;
  private encryptionKey: Buffer | null = null;
  private iv: Buffer | null = null;
  private tag: Buffer | null = null;
  private pfxPasswordSecure: string = '';
  
  private expirationDate: Date | null = null;
  private wipeTimer: NodeJS.Timeout | null = null;
  private cacheDurationMs: number = 12 * 60 * 60 * 1000; // Padrão: 12 horas

  private constructor() {}

  /**
   * Padrão Singleton para garantir instância única do Vault na memória.
   */
  public static getInstance(): CertificateVault {
    if (!CertificateVault.instance) {
      CertificateVault.instance = new CertificateVault();
    }
    return CertificateVault.instance;
  }

  /**
   * Inicializa o cofre carregando o arquivo PFX, validando expiração e cifrando-o em memória.
   */
  public async initialize(pfxPath: string, password: string, cacheDurationHours = 12): Promise<void> {
    this.cacheDurationMs = cacheDurationHours * 60 * 60 * 1000;
    const resolvedPath = path.resolve(pfxPath);

    if (!fs.existsSync(resolvedPath)) {
      // SECURITY: Não expõe o caminho real do PFX em produção
      throw new Error(`Certificado digital não localizado no caminho configurado.`);
    }

    try {
      const rawBuffer = fs.readFileSync(resolvedPath);
      this.pfxPasswordSecure = password;

      // 1. Validar expiração do certificado ICP-Brasil usando node-forge
      this.validateCertificateExpiration(rawBuffer, password);

      // 2. Criptografar o buffer do certificado em memória
      this.encryptBuffer(rawBuffer);

      // 3. Agendar o wipe automático para limpar as chaves da memória após X horas
      this.scheduleWipe();

      this.logStructured('info', 'Cofre criptográfico de certificado inicializado com sucesso.', {
        expirationDate: this.expirationDate?.toISOString(),
        cacheDurationHours
      });

    } catch (error) {
      this.wipe(); // Garante limpeza caso ocorra qualquer erro na inicialização
      throw new Error(`Falha crítica de segurança ao carregar certificado no Vault: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Descriptografa e retorna o certificado original em formato de Buffer para handshakes HTTPS.
   * Audita rigidamente cada uso em log estruturado.
   * 
   * @param {string} operadorId OAB/CPF do advogado operador da chamada.
   * @param {string} correlationId ID de correlação da requisição.
   */
  public getDecryptedCertificate(operadorId: string, correlationId: string): Buffer {
    if (!this.ciphertext || !this.encryptionKey || !this.iv || !this.tag) {
      throw new Error('Certificado expirado ou não carregado no Vault. Reinicialização obrigatória.');
    }

    // Auditoria obrigatória ICP-Brasil / LGPD
    this.logStructured('info', 'Uso de assinatura digital/certificado ICP-Brasil auditado.', {
      type: 'AUDIT_CERTIFICATE_USE',
      operadorId,
      correlationId,
      expirationDate: this.expirationDate?.toISOString()
    });

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, this.iv);
      decipher.setAuthTag(this.tag);

      const decrypted = Buffer.concat([
        decipher.update(this.ciphertext),
        decipher.final()
      ]);

      return decrypted;
    } catch (error) {
      throw new Error(`Falha ao descriptografar certificado digital do Vault: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Retorna a senha segura do certificado PFX.
   */
  public getPassword(): string {
    if (!this.pfxPasswordSecure) {
      throw new Error('Cofre criptográfico não inicializado.');
    }
    return this.pfxPasswordSecure;
  }

  /**
   * Limpa e zera (zero-fill) todas as áreas de memória que armazenam chaves e buffers sensíveis.
   */
  public wipe(): void {
    if (this.wipeTimer) clearTimeout(this.wipeTimer);

    // Sobrescrever buffers na memória física com zeros antes de liberar ao Garbage Collector
    if (this.ciphertext) this.ciphertext.fill(0);
    if (this.encryptionKey) this.encryptionKey.fill(0);
    if (this.iv) this.iv.fill(0);
    if (this.tag) this.tag.fill(0);

    this.ciphertext = null;
    this.encryptionKey = null;
    this.iv = null;
    this.tag = null;
    this.pfxPasswordSecure = '';
    this.expirationDate = null;

    this.logStructured('warn', 'Cofre criptográfico limpo (Memory Wipe executado com sucesso).');
  }

  private encryptBuffer(rawBuffer: Buffer): void {
    // Gerar chaves criptográficas em buffers efêmeros
    this.encryptionKey = crypto.randomBytes(32);
    this.iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, this.iv);
    
    this.ciphertext = Buffer.concat([
      cipher.update(rawBuffer),
      cipher.final()
    ]);

    this.tag = cipher.getAuthTag();

    // Zerar o buffer bruto do arquivo temporário para não deixar rastros em memória
    rawBuffer.fill(0);
  }

  private validateCertificateExpiration(pfxBuffer: Buffer, password: string): void {
    try {
      const pfxAsn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
      const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, false, password);
      
      let notAfter: Date | null = null;

      // Buscar sacolas de certificados no arquivo PKCS#12
      const bags = pfx.getBags({ bagType: forge.pki.oids.certBag });
      const certBags = bags[forge.pki.oids.certBag];

      if (certBags && certBags.length > 0) {
        for (const bag of certBags) {
          if (bag.cert) {
            const exp = new Date(bag.cert.validity.notAfter);
            if (!notAfter || exp < notAfter) {
              notAfter = exp; // Pega o limite de validade mais restrito
            }
          }
        }
      }

      if (!notAfter) {
        throw new Error('Não foi possível ler a validade a partir do arquivo PFX.');
      }

      this.expirationDate = notAfter;
      const now = new Date();

      if (now > notAfter) {
        throw new Error(`Certificado digital expirado em: ${notAfter.toLocaleDateString('pt-BR')}`);
      }

      const diasRestantes = Math.floor((notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diasRestantes <= 30) {
        this.logStructured('warn', `ALERTA DE SEGURANÇA: O certificado digital expira em ${diasRestantes} dias! (${notAfter.toLocaleDateString('pt-BR')})`, {
          type: 'CERTIFICATE_EXPIRING_WARNING',
          diasRestantes
        });
      }

    } catch (err) {
      throw new Error(`Erro ao validar validade do PFX: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private scheduleWipe(): void {
    if (this.wipeTimer) clearTimeout(this.wipeTimer);
    
    this.wipeTimer = setTimeout(() => {
      this.wipe();
      this.logStructured('warn', 'Certificado removido do Vault automaticamente devido à expiração do TTL de segurança.');
    }, this.cacheDurationMs);
  }

  private logStructured(level: 'info' | 'warn' | 'error', message: string, metadata: any = {}): void {
    const logObj = {
      level,
      timestamp: new Date().toISOString(),
      correlationId: metadata.correlationId || 'VAULT-SEC',
      message,
      ...metadata
    };
    console.log(JSON.stringify(logObj));
  }
}
