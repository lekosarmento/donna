'use client';

import React from 'react';

export interface ProcessLinkProps {
  numero: string;
  onClick: (numero: string) => void;
}

/**
 * Componente ProcessLink - Renderiza números de processos CNJ como links clicáveis.
 * Utiliza o design system obsidiana e dourado e suporta navegação por teclado.
 */
export function ProcessLink({ numero, onClick }: ProcessLinkProps): React.JSX.Element {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(numero);
    }
  };

  return (
    <>
      <button
        type="button"
        className="process-link"
        onClick={() => onClick(numero)}
        onKeyDown={handleKeyPress}
        aria-label={`Visualizar detalhes do processo ${numero}`}
      >
        {numero}
      </button>
      <style jsx>{`
        .process-link {
          background: none;
          border: none;
          color: var(--color-gold, #d4af37);
          text-decoration: underline;
          font-family: inherit;
          font-size: inherit;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          display: inline;
          transition: color 0.2s ease, text-shadow 0.2s ease;
        }
        .process-link:hover,
        .process-link:focus {
          color: var(--color-gold-hover, #f3e5ab);
          outline: none;
          text-shadow: 0 0 8px var(--color-gold-glow, rgba(212, 175, 55, 0.3));
        }
      `}</style>
    </>
  );
}
