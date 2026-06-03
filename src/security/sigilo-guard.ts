import { supabase } from '../config/supabase.js';
import { LgpdHandler } from '../compliance/lgpd-handler.js';
import { AuditLogger } from '../compliance/audit-logger.js';

export interface SigiloClassification {
  nivel: 'publico' | 'restrito' | 'segredo';
  fundamentacao: string;
  artigo: string;
}

export interface RedactedProcesso {
  numeroProcesso: string;
  classe: string;
  orgaoJulgador: string;
  segredoJustica: boolean;
  bloqueado: boolean;
  mensagemBloqueio: string;
  fundamentacaoLegal: string;
  artigoCPC: string;
  partes: Array<{ tipo: string; nome: string }>;
  movimentos: any[];
}

/**
 * Guarda de Segurança e Compliance contra vazamento de segredos de justiça (Art. 189 CPC).
 * Intercepta dados processuais do PJe e valida a legitimidade do advogado com base em sua OAB.
 */
export class SigiloGuard {
  
  /**
   * Verifica se o usuário advogado possui legitimidade para acessar os autos de um processo sigiloso.
   * A legitimidade é dada se a OAB do usuário logado estiver associada a alguma das partes ou advogados do processo.
   */
  public static async verificarLegitimidade(usuarioId: string, processo: any): Promise<boolean> {
    try {
      // 1. Obter a OAB do usuário logado na tabela usuarios do Supabase
      const { data: usuarioRecord, error } = await supabase
        .from('usuarios')
        .select('oab')
        .eq('id', usuarioId)
        .single();

      if (error || !usuarioRecord || !usuarioRecord.oab) {
        // Sem OAB cadastrada, impossível verificar legitimidade. Bloqueia por precaução (fail-secure)
        return false;
      }

      const oabAdvogado = usuarioRecord.oab.trim().toLowerCase();

      // 2. Extrair OABs declaradas nos dados do processo
      // No PJe, OABs podem vir em partes representadas ou em metadados adicionais
      const oabsNoProcesso: string[] = [];

      // Verificar nas partes do processo
      if (processo.partes && Array.isArray(processo.partes)) {
        for (const parte of processo.partes) {
          // Adiciona se a própria parte tiver OAB declarada (advogado causa própria/representante)
          if (parte.oab) {
            oabsNoProcesso.push(parte.oab.trim().toLowerCase());
          }
          // Verificar se há advogados associados a esta parte no payload do PJe
          if (parte.advogados && Array.isArray(parte.advogados)) {
            for (const adv of parte.advogados) {
              if (adv.oab) {
                oabsNoProcesso.push(adv.oab.trim().toLowerCase());
              }
            }
          }
        }
      }

      // Verificar se o processo possui uma lista direta de advogados habilitados
      if (processo.advogadosHabilitados && Array.isArray(processo.advogadosHabilitados)) {
        for (const adv of processo.advogadosHabilitados) {
          if (adv.oab) {
            oabsNoProcesso.push(adv.oab.trim().toLowerCase());
          }
        }
      }

      // 3. Checagem de correspondência
      return oabsNoProcesso.some(oab => oab.includes(oabAdvogado) || oabAdvogado.includes(oab));
    } catch (err) {
      console.error('[SigiloGuard] Erro ao verificar legitimidade de acesso:', err);
      return false; // Fail-secure
    }
  }

  /**
   * Protege dados processuais de acordo com o nível de sigilo classificado.
   * Retorna os dados censurados (redacted) se o usuário não possuir legitimidade.
   */
  public static async protegerProcesso(
    processo: any,
    usuarioId: string,
    correlationId: string
  ): Promise<any> {
    const classification: SigiloClassification = LgpdHandler.classificarSigilo(processo);

    // Se o processo for público, retorna sem alterações
    if (classification.nivel === 'publico') {
      return processo;
    }

    // Verificar legitimidade do advogado
    const eLegitimo = await this.verificarLegitimidade(usuarioId, processo);

    // Se o advogado é parte legitimada na causa, ele tem acesso completo aos autos
    if (eLegitimo) {
      this.logAuditoriaSigilo(usuarioId, processo.numeroProcesso, classification.nivel, 'autorizado');
      return {
        ...processo,
        segredoJustica: classification.nivel === 'segredo',
        sigiloInfo: {
          nivel: classification.nivel,
          fundamentacao: classification.fundamentacao,
          artigo: classification.artigo,
          legitimidadeConfirmada: true
        }
      };
    }

    // Acesso não legítimo: aplicar medidas restritivas
    if (classification.nivel === 'segredo') {
      // 1. Redact TOTAL: Bloqueio sob o CPC 189
      this.logAuditoriaSigilo(usuarioId, processo.numeroProcesso, classification.nivel, 'bloqueado');

      const processoCensurado: RedactedProcesso = {
        numeroProcesso: processo.numeroProcesso || processo.numero_cnj,
        classe: processo.classe,
        orgaoJulgador: processo.orgaoJulgador || processo.vara,
        segredoJustica: true,
        bloqueado: true,
        mensagemBloqueio: 'Este processo corre sob Segredo de Justiça. Acesso restrito apenas aos advogados habilitados nos autos.',
        fundamentacaoLegal: classification.fundamentacao,
        artigoCPC: classification.artigo,
        // Remove totalmente partes e andamentos
        partes: [
          { tipo: 'ATIVO', nome: 'SEGREDO DE JUSTIÇA (Acesso Bloqueado)' },
          { tipo: 'PASSIVO', nome: 'SEGREDO DE JUSTIÇA (Acesso Bloqueado)' }
        ],
        movimentos: []
      };

      return processoCensurado;
    } else {
      // 2. Redact PARCIAL: Nível Restrito (Censura de dados sensíveis e nomes de menores/vítimas)
      this.logAuditoriaSigilo(usuarioId, processo.numeroProcesso, classification.nivel, 'restrito_autorizado');

      const partesSanitizadas = (processo.partes || []).map((parte: any) => {
        const nomeUpper = parte.nome.toUpperCase();
        // Identificar menores ou partes vulneráveis
        const isVulneravel = 
          nomeUpper.includes('MENOR') || 
          nomeUpper.includes('CRIANÇA') || 
          nomeUpper.includes('ADOLESCENTE') ||
          parte.tipo === 'Vítima' ||
          parte.tipo === 'VITIMA';

        return {
          ...parte,
          nome: isVulneravel ? 'PARTE VULNERÁVEL (OMITIDA SOB LGPD)' : this.obfuscateLastName(parte.nome),
          cpfCnpj: '***.***.***-**' // Mascara total
        };
      });

      // Filtra termos médicos ou sensíveis dos andamentos
      const movimentosSanitizados = (processo.movimentos || []).map((mov: any) => {
        let desc = mov.descricao;
        // Sanitiza termos extremamente sensíveis
        desc = desc.replace(/(laudo psiquiátrico|laudo médico|diagnóstico de esquizofrenia|internação compulsória)/gi, '[INFORMAÇÃO MÉDICA CONFIDENCIAL SUPRIMIDA]');
        return {
          ...mov,
          descricao: desc
        };
      });

      return {
        ...processo,
        partes: partesSanitizadas,
        movimentos: movimentosSanitizados,
        segredoJustica: false,
        sigiloInfo: {
          nivel: 'restrito',
          fundamentacao: classification.fundamentacao,
          artigo: classification.artigo,
          legitimidadeConfirmada: false
        }
      };
    }
  }

  private static obfuscateLastName(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    return `${parts[0]} ${parts.slice(1).map(p => `${p.charAt(0).toUpperCase()}.`).join(' ')}`;
  }

  /**
   * Log estruturado de conformidade e auditoria de processos sigilosos
   */
  private static logAuditoriaSigilo(
    usuarioId: string,
    numeroProcesso: string,
    nivelSigilo: string,
    resultado: 'autorizado' | 'bloqueado' | 'restrito_autorizado'
  ): void {
    // Mascara o processo no log SIEM
    const cnjMascarado = (numeroProcesso || '').replace(/\d{9}/g, '*********');

    const logObj = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      type: 'AUDIT_SIGILO_JUSTICA',
      ação: 'acesso_segredo_justica',
      processo: cnjMascarado,
      userId: usuarioId,
      nivelSigilo,
      resultado
    };

    console.log(JSON.stringify(logObj));
    
    // Registra no AuditLogger unificado se disponível
    try {
      AuditLogger.log({
        correlationId: `SIGILO-${Date.now()}`,
        userId: usuarioId,
        action: `ACESSO_SIGILO_${nivelSigilo.toUpperCase()}`,
        resource: cnjMascarado,
        result: resultado === 'bloqueado' ? 'BLOCKED' : 'SUCCESS'
      });
    } catch {
      // Ignora se o logger não estiver inicializado
    }
  }
}
