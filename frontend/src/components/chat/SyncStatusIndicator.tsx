'use client';

import React, { useState, useEffect } from 'react';

type SyncState = 'online' | 'local' | 'error';

/**
 * Indicador visual e dinâmico de sincronização da Donna.
 * Consulta o backend para checar a saúde da rede e a fila de sincronizações pendentes.
 */
export function SyncStatusIndicator(): React.JSX.Element {
  const [syncState, setSyncState] = useState<SyncState>('online');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const checkSyncStatus = async () => {
      try {
        const response = await fetch('http://127.0.0.1:3000/health');
        
        if (!response.ok) {
          setSyncState('error');
          return;
        }

        const data = await response.json();
        
        if (data.sync) {
          const pending = data.sync.pendingSync || 0;
          setPendingCount(pending);
          
          if (data.sync.syncErrors > 0) {
            setSyncState('error');
          } else if (pending > 0 || data.components?.database === 'DOWN') {
            setSyncState('local');
          } else {
            setSyncState('online');
          }
        }
      } catch (err) {
        // Falha completa de conexão com o backend Fastify (Offline)
        setSyncState('local');
        setPendingCount(1); // Força exibição de pendência local/offline
      }
    };

    // Consulta imediata e a cada 15 segundos
    checkSyncStatus();
    const interval = setInterval(checkSyncStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const getStatusConfig = () => {
    switch (syncState) {
      case 'online':
        return {
          color: '#10b981', // Verde Emerald
          glow: 'rgba(16, 185, 129, 0.25)',
          text: 'Sincronizado'
        };
      case 'local':
        return {
          color: '#f59e0b', // Amarelo Amber
          glow: 'rgba(245, 158, 11, 0.25)',
          text: pendingCount > 0 ? `${pendingCount} alterações locais` : 'Modo Offline / Local'
        };
      case 'error':
        return {
          color: '#f43f5e', // Vermelho Rose
          glow: 'rgba(244, 63, 94, 0.25)',
          text: 'Erro de Sincronismo'
        };
    }
  };

  const config = getStatusConfig();

  return (
    <>
      <div 
        className="sync-status-indicator" 
        role="status" 
        aria-live="polite"
        aria-label={`Status de sincronização: ${config.text}`}
      >
        <span className="status-dot" />
        <span className="status-text">{config.text}</span>
      </div>

      <style jsx>{`
        .sync-status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          padding: 0.25rem 0.6rem;
          border-radius: 4px;
          font-size: 0.65rem;
          font-weight: 700;
          color: var(--text-secondary, #94a3b8);
        }

        .status-dot {
          width: 0.5rem;
          height: 0.5rem;
          background-color: ${config.color};
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 8px ${config.glow};
          animation: pulseDot 2s infinite ease-in-out;
        }

        .status-text {
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }

        @keyframes pulseDot {
          0%, 100% {
            transform: scale(1);
            opacity: 0.8;
          }
          50% {
            transform: scale(1.15);
            opacity: 1;
            box-shadow: 0 0 12px ${config.color};
          }
        }

        /* Acessibilidade: prefere movimentos reduzidos */
        @media (prefers-reduced-motion: reduce) {
          .status-dot {
            animation: none !important;
          }
        }
      `}</style>
    </>
  );
}
