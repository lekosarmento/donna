import { jest } from '@jest/globals';
import crypto from 'crypto';

// Configura o ambiente de teste
process.env.NODE_ENV = 'test';

// Importação dinâmica das rotas e helpers após os mocks para ESM
const { decryptPFX } = await import('../../src/routes/onboardingRoutes.js');

// Função auxiliar sob teste para validação de limites de planos
interface Plano {
  id: string;
  nome: string;
  limite_usuarios: number;
  limite_queries_mensais: number;
  rag_habilitado: boolean;
}

function validarLimitesAssinatura(
  plano: Plano,
  totalUsuariosAtuais: number,
  totalQueriesMesAtuais: number
) {
  const permiteNovoUsuario = plano.limite_usuarios === -1 || totalUsuariosAtuais < plano.limite_usuarios;
  const permiteNovaQuery = plano.limite_queries_mensais === -1 || totalQueriesMesAtuais < plano.limite_queries_mensais;
  
  return {
    permiteNovoUsuario,
    permiteNovaQuery,
    ragDisponivel: plano.rag_habilitado
  };
}

describe('Módulo de Onboarding & Compliance de Planos', () => {
  
  describe('Criptografia AES-GCM e Derivação de Chaves (Web Crypto Parity)', () => {
    
    it('deve descriptografar com sucesso um payload cifrado no padrão Web Crypto API', () => {
      const pfxRawContent = 'mock-certificate-binary-pfx-content-data';
      const password = 'senha-secreta-do-advogado';
      
      // Simula a derivação de chave e encriptação AES-GCM feita no browser
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      
      // Derivação de chave via PBKDF2 no Node.js (mesmos parâmetros do Web Crypto: 100.000 iterações, SHA-256, 256 bits)
      const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Criptografia AES-GCM em Node.js
      const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
      const encrypted = Buffer.concat([
        cipher.update(Buffer.from(pfxRawContent, 'utf-8')),
        cipher.final()
      ]);
      const tag = cipher.getAuthTag();
      
      // No Web Crypto, a tag (16 bytes) é automaticamente anexada no final do ciphertext
      const ciphertextWithTag = Buffer.concat([encrypted, tag]);
      
      // Converte para Base64 para envio via rede simulada
      const encryptedPfxBase64 = ciphertextWithTag.toString('base64');
      const saltBase64 = salt.toString('base64');
      const ivBase64 = iv.toString('base64');
      const derivedKeyBase64 = derivedKey.toString('base64');
      
      // Executa a descriptografia no helper do backend
      const decryptedBuffer = decryptPFX(encryptedPfxBase64, saltBase64, ivBase64, derivedKeyBase64);
      
      expect(decryptedBuffer.toString('utf-8')).toBe(pfxRawContent);
    });

    it('deve falhar ao descriptografar se a chave derivada for incorreta ou alterada', () => {
      const pfxRawContent = 'another-pfx-payload';
      const password = 'password123';
      
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(Buffer.from(pfxRawContent, 'utf-8')), cipher.final()]);
      const ciphertextWithTag = Buffer.concat([encrypted, cipher.getAuthTag()]);
      
      const encryptedPfxBase64 = ciphertextWithTag.toString('base64');
      const saltBase64 = salt.toString('base64');
      const ivBase64 = iv.toString('base64');
      
      // Chave incorreta simulada
      const wrongKey = crypto.randomBytes(32).toString('base64');
      
      expect(() => {
        decryptPFX(encryptedPfxBase64, saltBase64, ivBase64, wrongKey);
      }).toThrow();
    });
  });

  describe('Sistema de Planos e Assinaturas (Tiers de Limitação)', () => {
    const planoStarter: Plano = {
      id: 'starter',
      nome: 'Plano Piloto Starter',
      limite_usuarios: 1,
      limite_queries_mensais: 500,
      rag_habilitado: false
    };

    const planoProfessional: Plano = {
      id: 'professional',
      nome: 'Plano Professional',
      limite_usuarios: 10,
      limite_queries_mensais: 5000,
      rag_habilitado: true
    };

    const planoEnterprise: Plano = {
      id: 'enterprise',
      nome: 'Plano Corporate Enterprise',
      limite_usuarios: -1, // Ilimitado
      limite_queries_mensais: -1, // Ilimitado
      rag_habilitado: true
    };

    it('deve validar limites para o Plano Starter', () => {
      // 0 usuários e 0 queries: Permitido adicionar usuário e fazer queries, RAG desabilitado
      let check = validarLimitesAssinatura(planoStarter, 0, 0);
      expect(check.permiteNovoUsuario).toBe(true);
      expect(check.permiteNovaQuery).toBe(true);
      expect(check.ragDisponivel).toBe(false);

      // Limite de 1 usuário atingido: não deve permitir adicionar novo usuário
      check = validarLimitesAssinatura(planoStarter, 1, 100);
      expect(check.permiteNovoUsuario).toBe(false);
      expect(check.permiteNovaQuery).toBe(true);

      // Limite de 500 queries atingido: não deve permitir nova query
      check = validarLimitesAssinatura(planoStarter, 1, 500);
      expect(check.permiteNovoUsuario).toBe(false);
      expect(check.permiteNovaQuery).toBe(false);
    });

    it('deve validar limites para o Plano Professional', () => {
      // Professional permite até 10 usuários e RAG habilitado
      let check = validarLimitesAssinatura(planoProfessional, 5, 2500);
      expect(check.permiteNovoUsuario).toBe(true);
      expect(check.permiteNovaQuery).toBe(true);
      expect(check.ragDisponivel).toBe(true);

      // No limite de 10 usuários
      check = validarLimitesAssinatura(planoProfessional, 10, 4999);
      expect(check.permiteNovoUsuario).toBe(false);
      expect(check.permiteNovaQuery).toBe(true);

      // Estourou queries
      check = validarLimitesAssinatura(planoProfessional, 8, 5000);
      expect(check.permiteNovoUsuario).toBe(true);
      expect(check.permiteNovaQuery).toBe(false);
    });

    it('deve validar limites ilimitados para o Plano Enterprise', () => {
      // Enterprise deve permitir qualquer quantidade de usuários e queries
      const check = validarLimitesAssinatura(planoEnterprise, 150, 959000);
      expect(check.permiteNovoUsuario).toBe(true);
      expect(check.permiteNovaQuery).toBe(true);
      expect(check.ragDisponivel).toBe(true);
    });
  });
});
