import { PjeProcesso } from '../services/pje/pje-tools.js';

export type LgpdCategory = 'COMUM' | 'PESSOAL' | 'SENSIVEL';

export interface AuditRecord {
  timestamp: string;
  correlationId: string;
  userId: string;
  action: string;
  resource: string;
  baseLegal: string;
  dispositivoLgpd: string;
  finalidade: string;
}

/**
 * Utilitário de Governança e Compliance de Dados sob a LGPD (Lei 13.709/2018).
 * Realiza classificação de dados jurídicos, pseudonimização de identificadores e auditorias de legalidade.
 */
export class LgpdHandler {
  
  /**
   * Classifica as chaves de dados do PJe nas categorias regulatórias da LGPD.
   */
  public static classifyField(fieldName: string): LgpdCategory {
    const fieldLower = fieldName.toLowerCase();
    
    // Dados Pessoais Sensíveis (Art. 5º, II da LGPD)
    if (
      fieldLower.includes('saude') || 
      fieldLower.includes('doenca') || 
      fieldLower.includes('laudo') ||
      fieldLower.includes('orientacaosexual') ||
      fieldLower.includes('filiacaosindical')
    ) {
      return 'SENSIVEL';
    }

    // Dados Pessoais Comuns (Art. 5º, I da LGPD)
    if (
      fieldLower.includes('nome') || 
      fieldLower.includes('cpf') || 
      fieldLower.includes('cnpj') || 
      fieldLower.includes('endereco') ||
      fieldLower.includes('telefone') ||
      fieldLower.includes('email') ||
      fieldLower.includes('oab')
    ) {
      return 'PESSOAL';
    }

    // Dados Públicos/Comuns do Judiciário (Metadados de Processo)
    return 'COMUM';
  }

  /**
   * Pseudonimiza dados de partes processuais para proteção da identidade digital
   * em conformidade com o princípio de segurança e prevenção.
   */
  public static pseudonimizeProcesso(processo: PjeProcesso): PjeProcesso {
    // Verificar se o processo corre em vara de Família ou Segredo de Justiça Cível
    const isSensitiveCourt = 
      processo.orgaoJulgador.toLowerCase().includes('familia') ||
      processo.orgaoJulgador.toLowerCase().includes('sucessoes') ||
      processo.classe.toLowerCase().includes('alimentos') ||
      processo.classe.toLowerCase().includes('divorcio');

    const partesPseudonimizadas = processo.partes.map(parte => {
      const isParteDireta = parte.tipo === 'Autor' || parte.tipo === 'Réu' || parte.tipo === 'ATIVO' || parte.tipo === 'PASSIVO';
      
      // Se for processo sensível de família, pseudonimizamos até as partes principais (iniciais)
      const nomeFinal = isSensitiveCourt 
        ? this.obfuscateEntireName(parte.nome) 
        : (isParteDireta ? parte.nome : this.obfuscateLastName(parte.nome));

      return {
        tipo: parte.tipo,
        nome: nomeFinal,
        cpfCnpj: parte.cpfCnpj ? this.maskDocument(parte.cpfCnpj) : undefined
      };
    });

    return {
      ...processo,
      partes: partesPseudonimizadas,
      // Se for segredo de família, rotula o assunto
      assunto: isSensitiveCourt ? `${processo.assunto} [SEGREDO DE JUSTIÇA - SENSÍVEL]` : processo.assunto
    };
  }

  /**
   * Registra o log de auditoria associando a consulta a uma base legal expressa do Art. 7º da LGPD.
   */
  public static auditLgpdAccess(
    userId: string,
    action: 'CONSULTA_PROCESSO' | 'PETICIONAMENTO' | 'DOWNLOAD_PECA',
    processoCNJ: string,
    correlationId: string
  ): void {
    
    // Para processos judiciais, a base legal canônica é o exercício regular de direitos
    const record: AuditRecord = {
      timestamp: new Date().toISOString(),
      correlationId,
      userId,
      action,
      resource: processoCNJ.replace(/\d{9}/g, '*********'), // Mascaramento de auditoria
      baseLegal: 'Exercício regular de direitos em processo judicial',
      dispositivoLgpd: 'Artigo 7º, inciso VI, da Lei nº 13.709/2018',
      finalidade: 'Defesa e patrocínio de interesses jurídicos da parte outorgante.'
    };

    console.log(JSON.stringify({
      level: 'info',
      type: 'LGPD_AUDIT_COMPLIANCE',
      ...record
    }));
  }

  private static maskDocument(doc: string): string {
    const clean = doc.replace(/\D/g, '');
    if (clean.length === 11) {
      return `***.***.${clean.substring(6, 9)}-${clean.substring(9, 11)}`;
    }
    if (clean.length === 14) {
      return `**.***.***/${clean.substring(8, 12)}-${clean.substring(12, 14)}`;
    }
    return '***.***.***-**';
  }

  private static obfuscateLastName(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    return `${parts[0]} ${parts.slice(1).map(p => `${p.charAt(0).toUpperCase()}.`).join(' ')}`;
  }

  private static obfuscateEntireName(name: string): string {
    return name.trim().split(/\s+/).map(p => `${p.charAt(0).toUpperCase()}.`).join(' ');
  }
}
