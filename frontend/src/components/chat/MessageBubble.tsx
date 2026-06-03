'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProcessLink } from './ProcessLink';

export interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  usouPje?: boolean;
  onSelectProcess: (numero: string) => void;
}

export function MessageBubble({
  role,
  content,
  createdAt,
  usouPje = false,
  onSelectProcess,
}: MessageBubbleProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  // Formatar data relativa de forma amigável
  const getRelativeTime = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'agora';
      if (diffMins < 60) return `há ${diffMins} min`;
      
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `há ${diffHours} h`;
      
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'há alguns instantes';
    }
  };

  // Copiar conteúdo para a área de transferência
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar conteúdo:', err);
    }
  };

  // Pré-processar o texto bruto para converter formatos de número CNJ do PJe em links markdown acionáveis.
  // Ex: "0001234-56.2026.8.15.0001" -> "[0001234-56.2026.8.15.0001](pje:0001234-56.2026.8.15.0001)"
  const preprocessContent = (text: string): string => {
    const cnjRegex = /(\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b)/g;
    return text.replace(cnjRegex, '[$1](pje:$1)');
  };

  const processedContent = preprocessContent(content);
  const isAssistant = role === 'assistant';

  return (
    <div className={`message-row ${role}`} role="listitem">
      {isAssistant && (
        <div className="avatar-wrapper" aria-hidden="true">
          <span className="avatar-donna">D</span>
        </div>
      )}

      <div className="message-bubble-wrapper">
        <div className="message-bubble">
          {isAssistant ? (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    if (href && href.startsWith('pje:')) {
                      const numero = href.replace('pje:', '');
                      return <ProcessLink numero={numero} onClick={onSelectProcess} />;
                    }
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {processedContent}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="user-text">{content}</p>
          )}

          {/* Rodapé da Bolha de Mensagem */}
          <div className="message-footer">
            <div className="footer-left">
              <span className="message-time">{getRelativeTime(createdAt)}</span>
              
              {isAssistant && usouPje && (
                <span className="pje-badge" title="Informações extraídas do barramento oficial do PJe">
                  Via PJe TJPB ✓
                </span>
              )}
            </div>

            <button 
              type="button" 
              className="copy-btn" 
              onClick={handleCopy}
              aria-label="Copiar mensagem"
            >
              {copied ? 'Copiado!' : (
                <svg className="copy-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-5 4h6m-6 4h6m-2 5h4" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .message-row {
          display: flex;
          width: 100%;
          margin-bottom: 1.25rem;
          gap: 0.75rem;
          align-items: flex-start;
        }

        .message-row.user {
          justify-content: flex-end;
        }

        .avatar-wrapper {
          width: 2.2rem;
          height: 2.2rem;
          background: linear-gradient(135deg, #030407, #080a10);
          border: 1px solid rgba(212, 175, 55, 0.25);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 10px rgba(212, 175, 55, 0.15);
          flex-shrink: 0;
        }

        .avatar-donna {
          font-family: 'Cinzel', serif;
          font-weight: 900;
          font-size: 0.95rem;
          color: #d4af37;
          text-shadow: 0 0 4px rgba(212, 175, 55, 0.4);
        }

        .message-bubble-wrapper {
          max-width: 75%;
          display: flex;
          flex-direction: column;
        }

        .message-bubble {
          padding: 0.85rem 1.15rem;
          border-radius: 4px;
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          transition: border-color 0.2s ease;
        }

        .user .message-bubble {
          background: #080a10;
          border: 1px solid rgba(255, 255, 255, 0.05);
          color: #f8fafc;
        }

        .assistant .message-bubble {
          background: rgba(8, 10, 16, 0.55);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(212, 175, 55, 0.08);
          color: #f8fafc;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
        }

        .user-text {
          margin: 0;
          font-size: 0.88rem;
          line-height: 1.5;
          word-break: break-word;
          white-space: pre-wrap;
        }

        /* Markdown Styling */
        .markdown-body {
          font-size: 0.88rem;
          line-height: 1.55;
          word-break: break-word;
        }

        .markdown-body :global(p) {
          margin: 0 0 0.75rem 0;
        }

        .markdown-body :global(p:last-child) {
          margin: 0;
        }

        .markdown-body :global(ul), .markdown-body :global(ol) {
          margin: 0 0 0.75rem 1.25rem;
          padding: 0;
        }

        .markdown-body :global(li) {
          margin-bottom: 0.25rem;
        }

        .markdown-body :global(code) {
          background: rgba(212, 175, 55, 0.06);
          border: 1px solid rgba(212, 175, 55, 0.15);
          padding: 0.15rem 0.35rem;
          border-radius: 2px;
          font-family: monospace;
          font-size: 0.8rem;
          color: #f3e5ab;
        }

        .markdown-body :global(pre) {
          background: #030407;
          border: 1px solid rgba(212, 175, 55, 0.1);
          padding: 0.75rem;
          border-radius: 4px;
          overflow-x: auto;
          margin-bottom: 0.75rem;
        }

        .markdown-body :global(pre code) {
          background: none;
          border: none;
          padding: 0;
          font-size: 0.78rem;
          color: inherit;
        }

        .message-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 0.25rem;
          border-top: 1px solid rgba(255, 255, 255, 0.03);
          padding-top: 0.35rem;
          font-size: 0.7rem;
        }

        .footer-left {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .message-time {
          color: var(--text-secondary, #94a3b8);
          opacity: 0.8;
        }

        .pje-badge {
          color: #06b6d4;
          font-weight: 700;
          background: rgba(6, 182, 212, 0.08);
          padding: 0.1rem 0.35rem;
          border-radius: 2px;
          border: 1px solid rgba(6, 182, 212, 0.2);
        }

        .copy-btn {
          background: none;
          border: none;
          color: var(--text-secondary, #94a3b8);
          cursor: pointer;
          padding: 0.1rem 0.25rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.65rem;
          transition: color 0.2s ease;
          border-radius: 2px;
        }

        .copy-btn:hover {
          color: var(--color-gold, #d4af37);
        }

        .copy-icon {
          width: 0.9rem;
          height: 0.9rem;
        }
      `}</style>
    </div>
  );
}
