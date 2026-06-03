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
   * Classifica o nível de sigilo processual com base no Art. 189 do CPC e LGPD.
   */
  public static classificarSigilo(processo: any): { 
    nivel: 'publico' | 'restrito' | 'segredo'; 
    fundamentacao: string; 
    artigo: string; 
  } {
    // 1. Detectar pelo campo segredoJustica da API do PJe
    if (processo.segredoJustica === true) {
      return {
        nivel: 'segredo',
        fundamentacao: 'Processo classificado expressamente como Segredo de Justiça pelo barramento eletrônico do tribunal.',
        artigo: 'Artigo 189, inciso IV, da Lei nº 13.105/2015 (CPC)'
      };
    }

    const classeLower = (processo.classe || '').toLowerCase();
    const assuntoLower = (processo.assunto || '').toLowerCase();
    const orgaoLower = (processo.orgaoJulgador || '').toLowerCase();
    const numeroClasse = parseInt(processo.classeId || processo.classeCode || '0', 10);
    
    // 2. Detectar pelas classes processuais CNJ (família, divórcio, alimentos, guarda, adoção)
    const classesFamiliaCnj = [1116, 1117, 1118, 1121, 1122, 1125, 1126, 1127, 1128];
    const isFamiliaCode = classesFamiliaCnj.includes(numeroClasse);

    const isFamiliaText = 
      classeLower.includes('divórcio') || 
      classeLower.includes('divorcio') ||
      classeLower.includes('guarda') ||
      classeLower.includes('alimentos') ||
      classeLower.includes('adoção') ||
      classeLower.includes('adopcao') ||
      classeLower.includes('tutela') ||
      classeLower.includes('curatela') ||
      classeLower.includes('união estável') ||
      classeLower.includes('uniao estavel') ||
      classeLower.includes('família') ||
      classeLower.includes('familia');

    if (isFamiliaCode || isFamiliaText) {
      return {
        nivel: 'segredo',
        fundamentacao: 'Processo de direito de família e/ou estado das pessoas com restrição legal de publicidade.',
        artigo: 'Artigo 189, inciso II, da Lei nº 13.105/2015 (CPC)'
      };
    }

    // 3. Detectar por violência doméstica (Maria da Penha)
    if (
      assuntoLower.includes('violência doméstica') || 
      assuntoLower.includes('violencia domestica') ||
      assuntoLower.includes('maria da penha') ||
      orgaoLower.includes('violência doméstica') ||
      orgaoLower.includes('violencia domestica')
    ) {
      return {
        nivel: 'segredo',
        fundamentacao: 'Processo envolvendo violência doméstica e familiar contra a mulher.',
        artigo: 'Artigo 189, inciso III, da Lei nº 13.105/2015 (CPC) c/c Lei Maria da Penha'
      };
    }

    // 4. Detectar por adoção, menor de idade ou Estatuto da Criança e do Adolescente (ECA)
    if (
      assuntoLower.includes('adoção') || 
      assuntoLower.includes('adopcao') || 
      assuntoLower.includes('estatuto da criança') || 
      assuntoLower.includes('menor') ||
      orgaoLower.includes('infância') ||
      orgaoLower.includes('infancia') ||
      orgaoLower.includes('juventude')
    ) {
      return {
        nivel: 'segredo',
        fundamentacao: 'Processo que discute interesse de menor de idade sob a égide do Estatuto da Criança e do Adolescente (ECA).',
        artigo: 'Artigo 143 da Lei nº 8.069/1990 (ECA) c/c Artigo 189, inciso II do CPC'
      };
    }

    // 5. Detectar por saúde mental, interdição, doença mental ou dados médicos sensíveis
    if (
      classeLower.includes('interdição') ||
      classeLower.includes('interdicao') ||
      assuntoLower.includes('saúde mental') || 
      assuntoLower.includes('saude mental') || 
      assuntoLower.includes('doença mental') ||
      assuntoLower.includes('doenca mental') ||
      assuntoLower.includes('interdição') || 
      assuntoLower.includes('interdicao') || 
      assuntoLower.includes('curatela')
    ) {
      return {
        nivel: 'restrito',
        fundamentacao: 'Processo contendo dados sensíveis sobre saúde mental ou capacidade civil das partes.',
        artigo: 'Artigo 5º, inciso X, da Constituição Federal c/c Artigo 5º, inciso II, da LGPD'
      };
    }

    return {
      nivel: 'publico',
      fundamentacao: 'Processo sob regime geral de publicidade dos atos processuais.',
      artigo: 'Artigo 93, inciso IX, da Constituição Federal'
    };
  }

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
