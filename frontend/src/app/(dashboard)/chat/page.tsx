import React from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabase';
import { ChatConsole, ChatMessage } from '../../../components/chat/ChatConsole';
import { SyncStatusIndicator } from '../../../components/chat/SyncStatusIndicator';

// Tipagem de sessões jurídicas retornadas pelo Supabase
interface ChatSession {
  id: string;
  titulo: string;
  updated_at: string;
}

export default async function ChatPage(props: {
  searchParams: Promise<{ session?: string }>;
}): Promise<React.JSX.Element> {
  const searchParams = await props.searchParams;
  const activeSessionId = searchParams.session;

  // ID do usuário padrão para ambiente local de desenvolvimento (Roberto Silva - OAB/PB)
  const defaultUserId = 'da39b5b2-3864-44df-be9b-e7b8c2d82910';

  let sessions: ChatSession[] = [];
  let initialMessages: ChatMessage[] = [];

  try {
    // 1. Carrega histórico de sessões do Supabase de forma performática
    const { data: dbSessions, error: sessionErr } = await supabase
      .from('chat_sessions')
      .select('id, titulo, updated_at')
      .order('updated_at', { ascending: false });

    if (!sessionErr && dbSessions) {
      sessions = dbSessions;
    }
  } catch (err) {
    console.warn('[Supabase Page Fallback] Falha ao ler sessões do Supabase. Utilizando mocks locais.', err);
  }

  // Fallback de design caso a base esteja vazia ou offline (Demonstração Harvey AI Premium)
  if (sessions.length === 0) {
    sessions = [
      {
        id: 'demo-session-1',
        titulo: 'Análise de prazo - Proc. 0801234-56',
        updated_at: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'demo-session-2',
        titulo: 'Perfil Comportamental Juiz 2ª Vara Cível',
        updated_at: new Date(Date.now() - 7200000).toISOString(),
      },
    ];
  }

  // Resolve a sessão ativa. Se não especificada, cria-se um UUID temporário para nova sessão
  const currentSessionId = activeSessionId || `session-new-${Date.now()}`;
  const isNewSession = !sessions.some(s => s.id === currentSessionId);

  // 2. Carregar mensagens históricas se não for uma conversa nova
  if (!isNewSession) {
    try {
      const { data: dbMessages, error: msgErr } = await supabase
        .from('chat_messages')
        .select('id, role, content, created_at, metadata')
        .eq('session_id', currentSessionId)
        .order('created_at', { ascending: true });

      if (!msgErr && dbMessages) {
        initialMessages = dbMessages.map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          createdAt: m.created_at,
          usouPje: m.metadata?.tools && m.metadata.tools.length > 0,
        }));
      }
    } catch (err) {
      console.warn('[Supabase Page Fallback] Falha ao ler mensagens. Utilizando dados locais.', err);
    }

    // Mocks de dados estruturados para sessões de demonstração
    if (initialMessages.length === 0) {
      if (currentSessionId === 'demo-session-1') {
        initialMessages = [
          {
            id: 'm1',
            role: 'user',
            content: 'Consulte o processo 0001234-56.2026.8.15.0001 no PJe para mim e verifique se há prazos em aberto.',
            createdAt: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Consultei o barramento do PJe do TJPB. Localizei o processo **0001234-56.2026.8.15.0001** (Ação Ordinária de Cobrança), lotado na 2ª Vara Cível de João Pessoa.\n\n### Informações Relevantes:\n* **Polo Ativo:** Banco do Brasil S.A.\n* **Polo Passivo:** Construtora Silva Ltda.\n* **Última Movimentação:** Réplica apresentada pelo autor em **28/05/2026**.\n* **Próximo Vencimento:** Há prazo em aberto de **15 dias úteis** para manifestação do Juízo (Apelação Cível), com vencimento estimado para **19/06/2026**.',
            createdAt: new Date(Date.now() - 3550000).toISOString(),
            usouPje: true,
          },
        ];
      } else if (currentSessionId === 'demo-session-2') {
        initialMessages = [
          {
            id: 'm3',
            role: 'user',
            content: 'Qual o perfil decisório do Juiz Dr. João Carlos de Albuquerque da 2ª Vara Cível de João Pessoa?',
            createdAt: new Date(Date.now() - 7200000).toISOString(),
          },
          {
            id: 'm4',
            role: 'assistant',
            content: 'Com base no prontuário comportamental da carteira da Donna, o **Dr. João Carlos de Albuquerque** possui perfil classificado como **Legalista Rígido**.\n\n### Aspectos de Audiência e Decisão:\n1. **Estilo literal:** Rejeita construções teóricas abstratas ou interpretações analógicas inovadoras. Prefere transcrição de jurisprudência literal e objetiva.\n2. **Infraestrutura:** Não tolera atrasos em audiência e costuma indeferir liminarmente prazos prorrogados sem evidência extrema.\n3. **Recomendação:** Apresentar petições curtas, diretas e focadas na literalidade das súmulas do STJ/TJPB.',
            createdAt: new Date(Date.now() - 7150000).toISOString(),
            usouPje: false,
          },
        ];
      }
    }
  }

  // Obter o título da conversa ativa
  const activeSessionTitle = isNewSession 
    ? 'Nova Conversa Jurídica'
    : sessions.find(s => s.id === currentSessionId)?.titulo || 'Conversa Ativa';

  return (
    <main className="chat-layout-container">
      {/* Sidebar Histórica (Esquerda) */}
      <aside className="chat-sidebar" role="navigation" aria-label="Histórico de Chats">
        <div className="sidebar-header">
          <Link href="/" className="logo-link">
            <span className="logo-text">DONNA</span>
            <span className="logo-badge">V3.0</span>
          </Link>
          
          <Link href="/chat" className="new-chat-btn">
            <svg className="plus-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Nova Conversa
          </Link>
        </div>

        {/* Lista de Sessões Recentes */}
        <div className="sessions-list">
          <span className="section-label">Histórico de Sessões</span>
          {sessions.map((sess) => {
            const isActive = sess.id === currentSessionId;
            return (
              <Link 
                key={sess.id} 
                href={`/chat?session=${sess.id}`}
                className={`session-item-link ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <svg className="chat-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="session-title" title={sess.titulo}>
                  {sess.titulo}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Rodapé da Sidebar */}
        <div className="sidebar-footer">
          <Link href="/" className="back-dashboard-link">
            <svg className="back-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Voltar ao Dashboard
          </Link>
        </div>
      </aside>

      {/* Janela do Console do Chat (Direita) */}
      <section className="chat-main-area" aria-label="Console do Copiloto">
        {/* Header Superior do Chat */}
        <header className="chat-content-header">
          <div className="header-status-info">
            <h1 className="active-session-title">{activeSessionTitle}</h1>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <SyncStatusIndicator />
              <span className="security-tag">
                <svg className="shield-icon" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.9C2.166 4.4 2.5 4 3 4h14a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V4.9zm13.334 2.1a1 1 0 10-2 0v4a1 1 0 102 0v-4zm-4 2a1 1 0 10-2 0v2a1 1 0 102 0v-2zm-4 2a1 1 0 10-2 0v0a1 1 0 102 0v0z" clipRule="evenodd" />
                </svg>
                Conexão ICP-Brasil Segura
              </span>
            </div>
          </div>
        </header>

        {/* Terminal Interativo do Cliente */}
        <div className="chat-console-container">
          <ChatConsole 
            sessionId={currentSessionId} 
            userId={defaultUserId} 
            initialMessages={initialMessages} 
          />
        </div>
      </section>

      <style jsx>{`
        .chat-layout-container {
          display: flex;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
          background: #030407;
        }

        /* Sidebar CSS Layout */
        .chat-sidebar {
          width: 290px;
          height: 100%;
          background: #030407;
          border-right: 1px solid rgba(212, 175, 55, 0.08);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }

        .sidebar-header {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          border-bottom: 1px solid rgba(212, 175, 55, 0.04);
        }

        .logo-link {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          text-decoration: none;
        }

        .new-chat-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          background: rgba(212, 175, 55, 0.04);
          border: 1px solid rgba(212, 175, 55, 0.2);
          color: #d4af37;
          border-radius: 4px;
          padding: 0.65rem;
          font-size: 0.85rem;
          font-weight: 700;
          text-decoration: none;
          transition: all 0.25s ease;
        }

        .new-chat-btn:hover {
          background: #d4af37;
          color: #030407;
          box-shadow: 0 0 15px rgba(212, 175, 55, 0.25);
        }

        .plus-icon {
          width: 1rem;
          height: 1rem;
        }

        .sessions-list {
          flex: 1;
          overflow-y: auto;
          padding: 1.25rem 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .section-label {
          font-size: 0.62rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-secondary, #94a3b8);
          opacity: 0.6;
          padding-left: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .session-item-link {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.65rem 0.75rem;
          color: var(--text-secondary, #94a3b8);
          font-size: 0.82rem;
          text-decoration: none;
          border-radius: 4px;
          border: 1px solid transparent;
          transition: all 0.2s ease;
        }

        .session-item-link:hover {
          background: rgba(255, 255, 255, 0.02);
          color: var(--text-primary, #f8fafc);
        }

        .session-item-link.active {
          background: rgba(212, 175, 55, 0.04);
          border: 1px solid rgba(212, 175, 55, 0.1);
          color: #d4af37;
        }

        .chat-icon {
          width: 1rem;
          height: 1rem;
          flex-shrink: 0;
        }

        .session-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        }

        .sidebar-footer {
          padding: 1rem;
          border-top: 1px solid rgba(212, 175, 55, 0.04);
        }

        .back-dashboard-link {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-secondary, #94a3b8);
          font-size: 0.8rem;
          text-decoration: none;
          padding: 0.5rem;
          transition: color 0.2s ease;
        }

        .back-dashboard-link:hover {
          color: #d4af37;
        }

        .back-icon {
          width: 0.95rem;
          height: 0.95rem;
        }

        /* Main Area CSS Layout */
        .chat-main-area {
          flex: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .chat-content-header {
          height: 60px;
          padding: 0 1.5rem;
          border-bottom: 1px solid rgba(212, 175, 55, 0.08);
          display: flex;
          align-items: center;
          background: #030407;
        }

        .header-status-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
        }

        .active-session-title {
          font-family: 'Lora', serif;
          font-size: 1.15rem;
          font-weight: 500;
          color: var(--text-primary, #f8fafc);
          margin: 0;
        }

        .security-tag {
          font-size: 0.65rem;
          font-weight: 700;
          color: var(--accent-emerald, #10b981);
          background: rgba(16, 185, 129, 0.08);
          border: 1px solid rgba(16, 185, 129, 0.2);
          padding: 0.2rem 0.5rem;
          border-radius: 2px;
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }

        .shield-icon {
          width: 0.8rem;
          height: 0.8rem;
        }

        .chat-console-container {
          flex: 1;
          overflow: hidden;
        }
      `}</style>
    </main>
  );
}
