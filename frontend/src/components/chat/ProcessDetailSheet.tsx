'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface ProcessDetailSheetProps {
  numero: string | null;
  onClose: () => void;
}

interface Parte {
  tipo: string;
  nome: string;
  cpfCnpj?: string;
}

interface Movimento {
  data: string;
  descricao: string;
  tipo?: string;
}

interface ProcessoDetalhes {
  numeroProcesso: string;
  classe: string;
  assunto: string;
  orgaoJulgador: string;
  partes: Parte[];
  movimentos?: Movimento[];
  segredoJustica?: boolean;
  ultimaMovimentacao?: Movimento;
  proximoPrazo?: string;
  bloqueado?: boolean;
  fundamentacaoLegal?: string;
  artigoCPC?: string;
}

export function ProcessDetailSheet({ numero, onClose }: ProcessDetailSheetProps): React.JSX.Element | null {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processo, setProcesso] = useState<ProcessoDetalhes | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!numero) return;

    const fetchProcesso = async () => {
      setLoading(true);
      setError(null);
      setProcesso(null);

      try {
        const response = await fetch(`http://localhost:3000/api/pje/processo/${numero}`, {
          headers: {
            'X-Correlation-Id': `SHEET-FETCH-${Date.now()}`
          }
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Processo não localizado no barramento do PJe do TJPB.');
          }
          throw new Error(`Falha na consulta judicial: HTTP ${response.status}`);
        }

        const data = await response.json();
        setProcesso(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido ao consultar PJe.');
      } finally {
        setLoading(false);
      }
    };

    fetchProcesso();
  }, [numero]);

  // Fechamento ao apertar a tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && numero) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [numero, onClose]);

  if (!numero) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="none">
      <div 
        className="sheet-container" 
        onClick={(e) => e.stopPropagation()} 
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Prontuário do processo ${numero}`}
      >
        {/* Header da Sheet */}
        <div className="sheet-header">
          <div className="sheet-title-area">
            <span className="sheet-badge">PJe TJPB</span>
            <h2 className="sheet-cnj">{numero}</h2>
            <p className="sheet-subtitle">{processo?.orgaoJulgador || 'Buscando órgão julgador...'}</p>
          </div>
          
          <button 
            type="button" 
            className="sheet-close-btn" 
            onClick={onClose}
            aria-label="Fechar painel de detalhes"
          >
            &times;
          </button>
        </div>

        {/* Conteúdo da Sheet */}
        <div className="sheet-content">
          {loading && (
            <div className="sheet-loading-state" role="status">
              <div className="sheet-spinner" />
              <p>Consultando barramento oficial do PJe...</p>
            </div>
          )}

          {error && (
            <div className="sheet-error-state" role="alert">
              <svg className="error-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3>Falha de Sincronismo</h3>
              <p>{error}</p>
              <button type="button" className="retry-btn" onClick={() => {
                const num = numero;
                onClose();
                setTimeout(() => {
                  // Simular reabertura
                  onClickRetry(num);
                }, 100);
              }}>Tentar Novamente</button>
            </div>
          )}

          {!loading && !error && processo && (
            <div className="sheet-details">
              
              {/* Flag Vermelho: Segredo de Justiça com Bloqueio de Conteúdo */}
              {processo.segredoJustica && processo.bloqueado ? (
                <div className="segredo-bloqueio-container">
                  <div className="segredo-banner-vermelho" role="alert">
                    <svg className="lock-icon" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                    <span>⚠️ Processo em Segredo de Justiça — acesso restrito às partes</span>
                  </div>

                  <div className="fundamentacao-box">
                    <h4>Fundamentação Legal do Sigilo:</h4>
                    <p className="fund-desc">{processo.fundamentacaoLegal || 'Processo classificado sob sigilo judicial com base na legislação processual civil brasileira.'}</p>
                    <span className="fund-artigo">{processo.artigoCPC || 'Artigo 189 do Código de Processo Civil'}</span>
                  </div>
                </div>
              ) : (
                <>
                  {/* Se houver segredo de justiça mas for restrito ou autorizado com legitimidade */}
                  {processo.segredoJustica && (
                    <div className="segredo-banner" role="alert">
                      <svg className="lock-icon" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                      <span>PROCESSO EM SEGREDO DE JUSTIÇA (Acesso Liberado)</span>
                    </div>
                  )}

                  {/* Seção 1: Resumo */}
                  <div className="detail-section">
                    <h3>Informações da Ação</h3>
                    <div className="info-grid">
                      <div className="info-item">
                        <span className="info-label">Classe Processual</span>
                        <span className="info-value">{processo.classe}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Assunto Principal</span>
                        <span className="info-value">{processo.assunto}</span>
                      </div>
                    </div>
                  </div>

                  {/* Seção 2: Partes (LGPD Pseudonimizadas) */}
                  <div className="detail-section">
                    <h3>Partes do Processo</h3>
                    <div className="partes-list">
                      {processo.partes.map((parte, i) => (
                        <div key={i} className={`parte-card ${parte.tipo.toLowerCase()}`}>
                          <div className="parte-identity">
                            <span className="parte-tipo">{parte.tipo}</span>
                            <span className="parte-nome">{parte.nome}</span>
                          </div>
                          {parte.cpfCnpj && (
                            <span className="parte-doc">{parte.cpfCnpj}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Seção 3: Próximo Prazo */}
                  <div className="detail-section">
                    <h3>Motor de Prazos</h3>
                    <div className="prazo-box">
                      <div className="prazo-icon-wrapper">
                        <svg className="calendar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="prazo-details">
                        <span className="prazo-title">Próximo Vencimento Estimado</span>
                        <span className="prazo-desc">{processo.proximoPrazo || 'Nenhum prazo mapeado pela triagem.'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Seção 4: Último Andamento */}
                  <div className="detail-section">
                    <h3>Última Movimentação</h3>
                    <div className="movimentacao-box">
                      <span className="mov-date">{processo.ultimaMovimentacao?.data}</span>
                      <p className="mov-text">{processo.ultimaMovimentacao?.descricao}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .sheet-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(3, 4, 7, 0.6);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 1000;
          display: flex;
          justify-content: flex-end;
          animation: fadeIn 0.3s ease;
        }

        .sheet-container {
          width: 100%;
          max-width: 520px;
          height: 100%;
          background: #080a10;
          border-left: 1px solid rgba(212, 175, 55, 0.15);
          box-shadow: -10px 0 40px rgba(0, 0, 0, 0.8);
          display: flex;
          flex-direction: column;
          animation: slideLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .sheet-header {
          padding: 1.5rem;
          border-bottom: 1px solid rgba(212, 175, 55, 0.08);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          background: #030407;
        }

        .sheet-title-area {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .sheet-badge {
          font-size: 0.62rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #06b6d4;
          background: rgba(6, 182, 212, 0.08);
          padding: 0.15rem 0.4rem;
          border-radius: 2px;
          border: 1px solid rgba(6, 182, 212, 0.2);
          width: fit-content;
        }

        .sheet-cnj {
          font-family: 'Lora', serif;
          font-size: 1.3rem;
          font-weight: 500;
          color: var(--text-primary, #f8fafc);
          margin: 0;
        }

        .sheet-subtitle {
          font-size: 0.75rem;
          color: var(--text-secondary, #94a3b8);
          margin: 0;
        }

        .sheet-close-btn {
          background: none;
          border: none;
          color: var(--text-secondary, #94a3b8);
          font-size: 1.8rem;
          line-height: 1;
          cursor: pointer;
          padding: 0 0.5rem;
          transition: color 0.2s ease;
        }

        .sheet-close-btn:hover {
          color: #f43f5e;
        }

        .sheet-content {
          flex: 1;
          overflow-y: auto;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
        }

        .sheet-loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin: auto;
          color: var(--text-secondary, #94a3b8);
          gap: 1rem;
        }

        .sheet-spinner {
          width: 2.2rem;
          height: 2.2rem;
          border: 2px solid rgba(6, 182, 212, 0.1);
          border-top-color: #06b6d4;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .sheet-error-state {
          text-align: center;
          margin: auto;
          max-width: 320px;
        }

        .error-icon {
          width: 3rem;
          height: 3rem;
          color: #f43f5e;
          margin: 0 auto 1rem;
        }

        .retry-btn {
          margin-top: 1rem;
          background: rgba(212, 175, 55, 0.08);
          border: 1px solid rgba(212, 175, 55, 0.3);
          color: #d4af37;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .retry-btn:hover {
          background: #d4af37;
          color: #030407;
        }

        .segredo-banner {
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          border-radius: 4px;
          padding: 0.75rem 1rem;
          color: #f43f5e;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          font-weight: 700;
          margin-bottom: 1.5rem;
        }

        .lock-icon {
          width: 1.1rem;
          height: 1.1rem;
        }

        .detail-section {
          margin-bottom: 1.75rem;
        }

        .detail-section h3 {
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #d4af37;
          border-left: 2px solid #d4af37;
          padding-left: 0.5rem;
          margin: 0 0 1rem;
        }

        .info-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          background: rgba(3, 4, 7, 0.4);
          padding: 0.75rem 1rem;
          border-radius: 4px;
          border: 1px solid rgba(212, 175, 55, 0.05);
        }

        .info-label {
          font-size: 0.65rem;
          color: var(--text-secondary, #94a3b8);
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .info-value {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary, #f8fafc);
        }

        .partes-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .parte-card {
          padding: 0.75rem 1rem;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.03);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.85rem;
        }

        .parte-card.autor, .parte-card.ativo {
          background: rgba(16, 185, 129, 0.03);
          border-left: 3px solid #10b981;
        }

        .parte-card.réu, .parte-card.passivo {
          background: rgba(244, 63, 94, 0.03);
          border-left: 3px solid #f43f5e;
        }

        .parte-identity {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .parte-tipo {
          font-size: 0.62rem;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-secondary, #94a3b8);
        }

        .parte-nome {
          font-weight: 600;
          color: var(--text-primary, #f8fafc);
        }

        .parte-doc {
          font-family: monospace;
          font-size: 0.75rem;
          color: var(--text-secondary, #94a3b8);
        }

        .prazo-box {
          display: flex;
          gap: 0.75rem;
          background: rgba(6, 182, 212, 0.03);
          border: 1px solid rgba(6, 182, 212, 0.15);
          padding: 1rem;
          border-radius: 4px;
          align-items: center;
        }

        .prazo-icon-wrapper {
          color: #06b6d4;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .calendar-icon {
          width: 1.8rem;
          height: 1.8rem;
        }

        .prazo-details {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .prazo-title {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #06b6d4;
          font-weight: 700;
        }

        .prazo-desc {
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--text-primary, #f8fafc);
        }

        .movimentacao-box {
          background: rgba(3, 4, 7, 0.4);
          padding: 1rem;
          border-radius: 4px;
          border: 1px solid rgba(212, 175, 55, 0.05);
        }

        .mov-date {
          font-size: 0.7rem;
          color: #d4af37;
          font-weight: 700;
          display: block;
          margin-bottom: 0.35rem;
        }

        .mov-text {
          font-size: 0.8rem;
          color: var(--text-secondary, #94a3b8);
          margin: 0;
          line-height: 1.4;
        }

        .segredo-bloqueio-container {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          margin-top: 1rem;
        }

        .segredo-banner-vermelho {
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid #f43f5e;
          border-radius: 4px;
          padding: 1rem;
          color: #f43f5e;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.88rem;
          font-weight: 700;
          line-height: 1.4;
          box-shadow: 0 0 15px rgba(244, 63, 94, 0.1);
        }

        .fundamentacao-box {
          background: rgba(3, 4, 7, 0.5);
          border: 1px solid rgba(212, 175, 55, 0.1);
          border-radius: 4px;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .fundamentacao-box h4 {
          font-size: 0.8rem;
          font-weight: 700;
          color: #d4af37;
          text-transform: uppercase;
          margin: 0;
          letter-spacing: 0.05em;
        }

        .fund-desc {
          font-size: 0.82rem;
          color: var(--text-secondary, #94a3b8);
          line-height: 1.5;
          margin: 0;
        }

        .fund-artigo {
          font-family: 'Lora', serif;
          font-size: 0.85rem;
          font-style: italic;
          color: #f3e5ab;
          margin-top: 0.25rem;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideLeft {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Handler auxiliar para permitir reabertura manual se necessário
function onClickRetry(num: string) {
  const customEvent = new CustomEvent('pje_detail_retry', { detail: num });
  window.dispatchEvent(customEvent);
}
