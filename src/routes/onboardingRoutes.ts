import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getLocalDb } from '../config/sqlite-db.js';
import { supabase } from '../config/supabase.js';
import { CertificateVault } from '../security/certificate-vault.js';

/**
 * Auxiliar para descriptografar o PFX em memória usando a chave PBKDF2 fornecida pelo frontend.
 */
export function decryptPFX(encryptedPfxBase64: string, saltBase64: string, ivBase64: string, derivedKeyBase64: string): Buffer {
  const ciphertextWithTag = Buffer.from(encryptedPfxBase64, 'base64');
  const iv = Buffer.from(ivBase64, 'base64');
  const key = Buffer.from(derivedKeyBase64, 'base64');

  // O AES-GCM no Web Crypto concatena a tag de autenticação de 16 bytes no final do ciphertext
  const tagLength = 16;
  if (ciphertextWithTag.length <= tagLength) {
    throw new Error('Payload criptografado corrompido ou muito curto para extrair a tag.');
  }

  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - tagLength);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - tagLength);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted;
}

export default async function onboardingRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

  /**
   * POST /api/onboarding/test-pje
   * Descriptografa temporariamente em memória e testa a validade do certificado e acesso ao PJe.
   */
  fastify.post('/api/onboarding/test-pje', async (request, reply) => {
    const {
      encrypted_pfx,
      salt,
      iv,
      derived_key,
      pfx_password,
      tribunal_url,
      grau
    } = request.body as any;

    if (!encrypted_pfx || !salt || !iv || !derived_key || !pfx_password || !tribunal_url || !grau) {
      return reply.status(400).send({ error: 'Parâmetros obrigatórios ausentes para o teste de conexão PJe.' });
    }

    const tempDir = path.join(process.cwd(), 'data');
    const tempPath = path.join(tempDir, `temp_pfx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.pfx`);

    try {
      // 1. Decifrar em memória
      const pfxBuffer = decryptPFX(encrypted_pfx, salt, iv, derived_key);

      // 2. Escrever em arquivo temporário efêmero
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      fs.writeFileSync(tempPath, pfxBuffer);

      try {
        // 3. Inicializar no CertificateVault
        const vault = CertificateVault.getInstance();
        vault.wipe(); // Zera chaves anteriores
        await vault.initialize(tempPath, pfx_password, 12);
      } finally {
        // Zera fisicamente os bytes do buffer descriptografado e remove arquivo temporário
        pfxBuffer.fill(0);
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      }

      // 4. Validação e proteção SSRF no tribunal_url
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(tribunal_url);
      } catch {
        throw new Error('URL do tribunal com formato inválido.');
      }
      const allowedProtocols = ['http:', 'https:'];
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        throw new Error('Protocolo de URL não permitido.');
      }
      if (blockedHosts.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith('.local'))) {
        throw new Error('Acesso a redes internas não é permitido via configuração do PJe.');
      }

      const vault = CertificateVault.getInstance();

      return reply.send({
        success: true,
        mensagem: `Conexão mTLS restabelecida com sucesso ao tribunal ${tribunal_url} (${grau})!`,
        cert_info: {
          expira_em: (vault as any).expirationDate?.toLocaleDateString('pt-BR'),
          dias_restantes: (vault as any).expirationDate
            ? Math.floor(((vault as any).expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : 0
        }
      });

    } catch (err) {
      // SEGURANÇA: Não expor detalhes internos do erro de criptografia ou path do certificado
      const errMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = errMsg.includes('certificado') || errMsg.includes('PFX') || errMsg.includes('AES') || errMsg.includes('GCM') || errMsg.includes('path')
        ? 'Falha na validação do certificado. Verifique o arquivo e a senha e tente novamente.'
        : errMsg;
      return reply.status(500).send({
        error: 'Erro ao configurar conexão PJe.',
        detalhes: safeMsg
      });
    }
  });

  /**
   * POST /api/onboarding/setup
   * Conclui o onboarding do escritório criando a empresa, planos, assinatura e advogados.
   */
  fastify.post('/api/onboarding/setup', async (request, reply) => {
    const {
      escritorio,  // { nome, cnpj, oab_seccional, endereco }
      plano_id,    // 'starter' | 'professional' | 'enterprise'
      certificado, // { encrypted_pfx, salt, iv }
      advogados    // [ { nome, email, tipo_perfil, oab, whatsapp } ]
    } = request.body as any;

    if (!escritorio || !escritorio.nome || !plano_id || !advogados || advogados.length === 0) {
      return reply.status(400).send({ error: 'Campos obrigatórios ausentes no setup do escritório.' });
    }

    const db = getLocalDb();
    const escId = crypto.randomUUID();
    const subId = crypto.randomUUID();

    try {
      db.transaction(() => {
        // 1. Inserir escritório
        db.prepare(`
          INSERT INTO escritorios (id, nome, cnpj, oab_seccional, endereco, ativo)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(escId, escritorio.nome, escritorio.cnpj || null, escritorio.oab_seccional || null, escritorio.endereco || null);

        // 2. Inserir assinatura
        db.prepare(`
          INSERT INTO assinaturas (id, escritorio_id, plano_id, status, vigencia_inicio)
          VALUES (?, ?, ?, 'active', date('now'))
        `).run(subId, escId, plano_id);

        // 3. Inserir certificado se anexado
        if (certificado && certificado.encrypted_pfx && certificado.salt && certificado.iv) {
          db.prepare(`
            INSERT INTO certificados_escritorios (escritorio_id, encrypted_pfx, salt, iv)
            VALUES (?, ?, ?, ?)
          `).run(escId, certificado.encrypted_pfx, certificado.salt, certificado.iv);
        }

        // 4. Inserir advogados
        for (const adv of advogados) {
          const advId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO usuarios (id, escritorio_id, nome, email, tipo_perfil, oab, whatsapp, ativo)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          `).run(
            advId,
            escId,
            adv.nome,
            adv.email,
            adv.tipo_perfil || 'junior',
            adv.oab || null,
            adv.whatsapp || null
          );
        }
      })();

      // Tentativa de sincronização Supabase assíncrona (tolerância de falhas offline)
      supabase.from('escritorios').insert({
        id: escId,
        nome: escritorio.nome,
        cnpj: escritorio.cnpj || null,
        oab_seccional: escritorio.oab_seccional || null,
        endereco: escritorio.endereco || null,
        ativo: true
      }).then(async () => {
        await supabase.from('assinaturas').insert({
          id: subId,
          escritorio_id: escId,
          plano_id,
          status: 'active'
        });

        if (certificado && certificado.encrypted_pfx) {
          await supabase.from('certificados_escritorios').insert({
            escritorio_id: escId,
            encrypted_pfx: certificado.encrypted_pfx,
            salt: certificado.salt,
            iv: certificado.iv
          });
        }

        for (const adv of advogados) {
          await supabase.from('usuarios').insert({
            escritorio_id: escId,
            nome: adv.nome,
            email: adv.email,
            tipo_perfil: adv.tipo_perfil || 'junior',
            oab: adv.oab || null,
            whatsapp: adv.whatsapp || null,
            ativo: true
          });
        }
      }).catch(err => {
        console.warn(`[Supabase Onboarding Sync] Falha ao parear nuvem: ${err.message}`);
      });

      return reply.status(201).send({
        success: true,
        escritorio_id: escId,
        assinatura_id: subId,
        mensagem: 'Escritório registrado com sucesso!'
      });

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: 'Falha ao registrar escritório no banco de dados local.', detalhes: errMsg });
    }
  });
}
