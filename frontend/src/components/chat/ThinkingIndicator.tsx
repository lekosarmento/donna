'use client';

import React from 'react';

export interface ThinkingIndicatorProps {
  activeTool: string | null;
}

/**
 * Componente de status de IA que indica visualmente quais ferramentas
 * do PJe estão sendo executadas pela Donna em tempo real.
 * 
 * WCAG AA & Acessibilidade: Incorpora ARIA status e desativa animações
 * pesadas se o usuário possuir a configuração prefers-reduced-motion ativa.
 */
export function ThinkingIndicator({ activeTool }: ThinkingIndicatorProps): React.JSX.Element | null {
  if (!activeTool) return null;

  // Tradução amigável dos comandos técnicos das ferramentas MCP para linguagem jurídica
  const getMessage = (tool: string): string => {
    switch (tool) {
      case 'pje_buscar_processo':
        return 'Consultando andamentos e partes no PJe do TJPB...';
      case 'pje_listar_processos':
        return 'Filtrando carteira jurídica e buscando processos ativos...';
      case 'pje_configurar':
        return 'Homologando credenciais e certificação digital com o tribunal...';
      default:
        return 'Donna está processando requisições no barramento do PJe...';
    }
  };

  return (
    <div 
      className="thinking-container"
      role="status"
      aria-live="polite"
      aria-label={`Status: ${getMessage(activeTool)}`}
    >
      <div className="thinking-card">
        {/* Ícone de Balança/Justiça Pulsante com Animação CSS Pura */}
        <div className="icon-wrapper">
          <svg className="scale-icon" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
          </svg>
        </div>
        
        <div className="text-wrapper">
          <span className="status-label">Donna Engine</span>
          <span className="status-message">{getMessage(activeTool)}</span>
        </div>

        {/* Barra de Progresso Ciano Fluida */}
        <div className="progress-bar-container">
          <div className="progress-bar-fluid" />
        </div>
      </div>

      <style jsx>{`
        .thinking-container {
          margin: 1rem 0;
          display: flex;
          justify-content: flex-start;
          width: 100%;
        }

        .thinking-card {
          background: rgba(8, 10, 16, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(6, 182, 212, 0.2);
          border-radius: 4px;
          padding: 0.85rem 1.2rem;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.75rem;
          align-items: center;
          position: relative;
          overflow: hidden;
          width: 100%;
          max-width: 480px;
          box-shadow: 0 4px 20px rgba(6, 182, 212, 0.08);
        }

        .icon-wrapper {
          width: 2.2rem;
          height: 2.2rem;
          background: rgba(6, 182, 212, 0.08);
          border: 1px solid rgba(6, 182, 212, 0.3);
          border-radius: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #06b6d4;
          box-shadow: 0 0 8px rgba(6, 182, 212, 0.2);
        }

        .scale-icon {
          width: 1.25rem;
          height: 1.25rem;
          animation: pulseIcon 2s infinite ease-in-out;
        }

        .text-wrapper {
          display: flex;
          flex-direction: column;
        }

        .status-label {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 0.62rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #06b6d4;
        }

        .status-message {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 0.75rem;
          font-weight: 600;
          color: #f8fafc;
          margin-top: 0.15rem;
        }

        .progress-bar-container {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 2px;
          background: rgba(6, 182, 212, 0.05);
        }

        .progress-bar-fluid {
          height: 100%;
          width: 30%;
          background: linear-gradient(90deg, transparent, #06b6d4, transparent);
          animation: flowProgress 1.6s infinite linear;
        }

        /* Animações CSS Puras */
        @keyframes pulseIcon {
          0%, 100% {
            transform: scale(1);
            opacity: 0.9;
          }
          50% {
            transform: scale(1.12);
            opacity: 1;
            filter: drop-shadow(0 0 4px #06b6d4);
          }
        }

        @keyframes flowProgress {
          0% {
            transform: translateX(-150%);
          }
          100% {
            transform: translateX(350%);
          }
        }

        /* Acessibilidade: Respeitar preferências de movimentos reduzidos (prefers-reduced-motion) */
        @media (prefers-reduced-motion: reduce) {
          .scale-icon {
            animation: none !important;
          }
          .progress-bar-fluid {
            animation: none !important;
            width: 100% !important;
            background: #06b6d4 !important;
            opacity: 0.5;
            transform: none !important;
          }
          .thinking-card {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}
