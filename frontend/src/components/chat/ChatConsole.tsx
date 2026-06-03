'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useDonnaStream } from './useDonnaStream';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ProcessDetailSheet } from './ProcessDetailSheet';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  usouPje?: boolean;
}

export interface ChatConsoleProps {
  sessionId: string;
  userId: string;
  initialMessages: ChatMessage[];
}

export function ChatConsole({ sessionId, userId, initialMessages }: ChatConsoleProps): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [selectedProcessCnj, setSelectedProcessCnj] = useState<string | null>(null);
  
  // Métricas de consumo de tokens na sessão ativa
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const streamingContainerRef = useRef<HTMLSpanElement>(null);

  // Efeito para resetar mensagens quando trocar de sessão no Server Component
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages, sessionId]);

  // Função para descer o scroll até o fim de forma suave
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Rolar ao carregar ou atualizar histórico fixo de mensagens
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Callback acionado quando a geração de streaming SSE da Donna for concluída com sucesso
  const handleStreamDone = (fullText: string, usage?: { input_tokens: number; output_tokens: number }) => {
    const assistantMessage: ChatMessage = {
      id: `donna-msg-${Date.now()}`,
      role: 'assistant',
      content: fullText,
      createdAt: new Date().toISOString(),
      usouPje: toolsUsed.length > 0
    };

    setMessages((prev) => [...prev, assistantMessage]);

    if (usage) {
      setTokenUsage((prev) => ({
        input: prev.input + (usage.input_tokens || 0),
        output: prev.output + (usage.output_tokens || 0)
      }));
    }
  };

  const {
    startStream,
    thinking,
    activeTool,
    toolsUsed,
    isStreaming,
    error
  } = useDonnaStream({
    containerRef: streamingContainerRef,
    onDone: handleStreamDone,
    onError: (err) => console.error('[Donna Stream Error]:', err.message)
  });

  // Rolagem automática inteligente em tempo real durante o streaming de tokens (Mutation Observer)
  useEffect(() => {
    if (!isStreaming) return;

    const observer = new MutationObserver(() => {
      // Auto scroll apenas se o usuário não rolou manualmente para cima
      if (scrollContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 120;
        if (isNearBottom) {
          scrollToBottom();
        }
      }
    });

    if (streamingContainerRef.current) {
      observer.observe(streamingContainerRef.current, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    return () => observer.disconnect();
  }, [isStreaming]);

  // Ouvinte global para reabrir o prontuário se solicitado pelo modal de erro
  useEffect(() => {
    const handleRetryEvent = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        setSelectedProcessCnj(customEvent.detail);
      }
    };
    window.addEventListener('pje_detail_retry', handleRetryEvent);
    return () => window.removeEventListener('pje_detail_retry', handleRetryEvent);
  }, []);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || isStreaming) return;

    const messageText = inputValue.trim();
    setInputValue('');

    // Adiciona a mensagem do usuário na tela
    const userMessage: ChatMessage = {
      id: `user-msg-${Date.now()}`,
      role: 'user',
      content: messageText,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMessage]);
    
    // Rola para o fim antes do stream começar
    setTimeout(scrollToBottom, 50);

    // Inicia a conexão SSE com o backend da Donna
    await startStream(messageText, sessionId, userId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-console-wrapper">
      {/* Corpo do Chat com as Bolhas */}
      <div className="chat-scroll-container" ref={scrollContainerRef} role="log" aria-label="Histórico de mensagens">
        {messages.length === 0 && (
          <div className="empty-chat-state">
            <h3 className="supreme-font">DONNA LEGAL CO-PILOT</h3>
            <p className="welcome-desc">
              Bem-vindo ao centro estratégico da Donna. Digite sua instrução jurídica para consultar andamentos no PJe do TJPB, analisar peças judiciais ou mapear comportamentos de magistrados.
            </p>
            <div className="suggested-prompts">
              <button 
                type="button" 
                className="suggested-chip"
                onClick={() => setInputValue('Busque o processo 0801234-56.2025.8.15.0001 no PJe do TJPB e me resuma as movimentações.')}
              >
                🔍 Consultar processo 0801234-56.2025.8.15.0001 no PJe
              </button>
              <button 
                type="button" 
                className="suggested-chip"
                onClick={() => setInputValue('Quais são os prazos processuais em aberto para esta semana?')}
              >
                📅 Prazos em aberto da semana
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            createdAt={msg.createdAt}
            usouPje={msg.usouPje}
            onSelectProcess={(cnj) => setSelectedProcessCnj(cnj)}
          />
        ))}

        {/* Bolha de streaming temporária (exibe tokens dinâmicos) */}
        {isStreaming && (
          <div className="message-row assistant streaming" role="listitem">
            <div className="avatar-wrapper" aria-hidden="true">
              <span className="avatar-donna">D</span>
            </div>
            <div className="message-bubble-wrapper">
              <div className="message-bubble">
                <div className="markdown-body">
                  <span ref={streamingContainerRef} className="streaming-content-text" />
                </div>
                <div className="message-footer">
                  <span className="message-time">Processando resposta...</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Indicador visual de processamento de ferramentas do MCP (PjeService) */}
        <ThinkingIndicator activeTool={activeTool} />

        {/* Mensagem de Erro de Execução no Barramento */}
        {error && (
          <div className="chat-error-banner" role="alert">
            <svg className="error-icon-small" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Falha na comunicação: {error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Caixa de Entrada e Envio */}
      <div className="chat-input-container">
        <form onSubmit={handleSend} className="chat-form">
          <textarea
            className="donna-textarea"
            placeholder="Pergunte à Donna sobre processos, prazos ou magistrados (Pressione Enter para enviar)..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={isStreaming}
            aria-label="Mensagem para a Donna"
          />
          
          <button 
            type="submit" 
            className="donna-send-btn" 
            disabled={isStreaming || !inputValue.trim()}
            aria-label="Enviar mensagem"
          >
            {isStreaming ? (
              <div className="btn-spinner" />
            ) : (
              <svg className="send-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            )}
          </button>
        </form>

        {/* Indicador discreto de Consumo de Tokens da Sessão */}
        {(tokenUsage.input > 0 || tokenUsage.output > 0) && (
          <div className="token-usage-bar" aria-live="polite">
            Consumo da Sessão: {tokenUsage.input + tokenUsage.output} tokens (Input: {tokenUsage.input} | Output: {tokenUsage.output})
          </div>
        )}
      </div>

      {/* Painel lateral (Sheet) deslizante para prontuário de processo judicial */}
      <ProcessDetailSheet
        numero={selectedProcessCnj}
        onClose={() => setSelectedProcessCnj(null)}
      />

      <style jsx>{`
        .chat-console-wrapper {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          background: #030407;
          position: relative;
        }

        .chat-scroll-container {
          flex: 1;
          overflow-y: auto;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
        }

        .empty-chat-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin: auto;
          max-width: 460px;
          text-align: center;
          color: var(--text-secondary, #94a3b8);
        }

        .empty-chat-state h3 {
          font-size: 1.5rem;
          color: #d4af37;
          margin: 0 0 0.5rem 0;
          letter-spacing: 0.15em;
          text-shadow: 0 0 12px var(--color-gold-glow, rgba(212, 175, 55, 0.2));
        }

        .welcome-desc {
          font-size: 0.85rem;
          line-height: 1.5;
          margin-bottom: 1.5rem;
        }

        .suggested-prompts {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          width: 100%;
        }

        .suggested-chip {
          background: rgba(8, 10, 16, 0.65);
          border: 1px solid rgba(212, 175, 55, 0.1);
          border-radius: 4px;
          color: var(--text-primary, #f8fafc);
          padding: 0.6rem 1rem;
          font-size: 0.8rem;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .suggested-chip:hover {
          border-color: rgba(212, 175, 55, 0.4);
          background: rgba(8, 10, 16, 0.95);
          box-shadow: 0 4px 12px rgba(212, 175, 55, 0.05);
        }

        .chat-error-banner {
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.2);
          border-radius: 4px;
          padding: 0.6rem 1rem;
          color: #f43f5e;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
          margin-top: 0.5rem;
          animation: shake 0.4s ease;
        }

        .error-icon-small {
          width: 1rem;
          height: 1rem;
        }

        /* Input Bar area */
        .chat-input-container {
          padding: 1rem 1.5rem;
          border-top: 1px solid rgba(212, 175, 55, 0.08);
          background: #030407;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .chat-form {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          position: relative;
        }

        .donna-textarea {
          flex: 1;
          background: #080a10;
          border: 1px solid rgba(212, 175, 55, 0.08);
          border-radius: 4px;
          color: #f8fafc;
          padding: 0.75rem 3.5rem 0.75rem 0.85rem;
          font-family: inherit;
          font-size: 0.88rem;
          resize: none;
          line-height: 1.4;
          transition: all 0.2s ease;
        }

        .donna-textarea:focus {
          border-color: rgba(212, 175, 55, 0.35);
          outline: none;
          box-shadow: 0 0 15px rgba(212, 175, 55, 0.05);
        }

        .donna-send-btn {
          position: absolute;
          right: 0.5rem;
          top: 50%;
          transform: translateY(-50%);
          width: 2.2rem;
          height: 2.2rem;
          background: linear-gradient(135deg, #d4af37, #f3e5ab);
          border: none;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #030407;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .donna-send-btn:hover:not(:disabled) {
          transform: translateY(-50%) scale(1.04);
          box-shadow: 0 0 12px rgba(212, 175, 55, 0.3);
        }

        .donna-send-btn:disabled {
          background: #1e293b;
          color: #475569;
          cursor: not-allowed;
          transform: translateY(-50%);
        }

        .send-icon {
          width: 1.1rem;
          height: 1.1rem;
        }

        .btn-spinner {
          width: 1rem;
          height: 1rem;
          border: 2px solid rgba(0, 0, 0, 0.1);
          border-top-color: #030407;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .token-usage-bar {
          align-self: flex-end;
          font-size: 0.65rem;
          color: var(--text-secondary, #94a3b8);
          opacity: 0.6;
        }

        /* Message streaming classes matching bubble design */
        .message-row {
          display: flex;
          width: 100%;
          margin-bottom: 1.25rem;
          gap: 0.75rem;
          align-items: flex-start;
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
          background: rgba(8, 10, 16, 0.55);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(212, 175, 55, 0.08);
          color: #f8fafc;
        }

        .streaming-content-text {
          font-size: 0.88rem;
          line-height: 1.55;
          word-break: break-word;
          white-space: pre-wrap;
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

        .message-time {
          color: var(--text-secondary, #94a3b8);
          opacity: 0.8;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
