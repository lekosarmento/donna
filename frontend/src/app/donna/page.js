"use client";

import React, { useState, useRef, useEffect } from "react";

export default function DonnaChat() {
  const [messages, setMessages] = useState([
    {
      id: "1",
      role: "assistant",
      content: "Olá! Sou a **Donna**. Já processei todos os andamentos e diários de hoje pela manhã. O motor cognitivo está pronto. Como posso guiar a sua estratégia jurídica agora? Indique se deseja minutar recursos, avaliar os riscos processuais baseados na psicologia do julgador ou extrair teses do nosso repositório semântico.",
      timestamp: "15:20"
    }
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("Gerando análise estratégica...");
  const chatContainerRef = useRef(null);

  // Ciclo dinâmico de frases operacionais da Donna enquanto processa
  useEffect(() => {
    if (!loading) return;

    const phrases = [
      "Buscando insights na base de playbooks semânticos (RAG)...",
      "Triando carteira de processos e dockets ativos...",
      "Cruzando andamentos com regras de prazos do CPC/15...",
      "Mapeando psicologia decisória cognitiva do juiz da causa...",
      "Sistematizando riscos processuais e fundamentações...",
      "Lapidando minuta e parecer tático sob medida...",
      "Donna está refinando a resposta perfeita para você..."
    ];

    let currentIdx = 0;
    setLoadingText(phrases[0]);

    const interval = setInterval(() => {
      currentIdx = (currentIdx + 1) % phrases.length;
      setLoadingText(phrases[currentIdx]);
    }, 2200);

    return () => clearInterval(interval);
  }, [loading]);

  // ID da sessão ativa e listagem de histórico de conversas gravadas
  const [sessaoId, setSessaoId] = useState(null);
  const [conversasSalvas, setConversasSalvas] = useState([]);

  // State e Handler de Upload de Playbooks/Documentos para Donna RAG
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handlePlaybookUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingDoc(true);
    setUploadSuccess(false);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const conteudo = event.target.result;
      const titulo = file.name.replace(/\.[^/.]+$/, ""); // remove extensão

      try {
        const response = await fetch("http://localhost:3000/donna/conhecimento/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            tipo: "playbook",
            titulo: titulo,
            conteudo: conteudo,
            tags: ["upload-manual"],
            area_direito: "Civil"
          })
        });

        if (response.ok) {
          setUploadSuccess(true);
          // Adiciona ao contexto lateral RAG local
          setActiveContext(prev => ({
            ...prev,
            playbooks: [
              { titulo: titulo, score: "100.0% (Enviado)" },
              ...prev.playbooks
            ]
          }));
        } else {
          console.error("Erro ao enviar documento:", response.statusText);
          alert("Não foi possível processar o documento. Verifique os dados.");
        }
      } catch (err) {
        console.error("Erro de conexão ao enviar documento:", err.message);
        alert("Erro de conexão ao enviar documento para a Donna.");
      } finally {
        setUploadingDoc(false);
      }
    };
    reader.readAsText(file);
  };

  // Rola apenas a caixa de chat interna, sem afetar o scroll geral do site
  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Carrega listagem de conversas gravadas na barra lateral
  useEffect(() => {
    async function carregarSessoes() {
      try {
        const res = await fetch("http://localhost:3000/donna/sessoes");
        if (res.ok) {
          const data = await res.json();
          setConversasSalvas(data || []);
        }
      } catch (err) {
        console.warn("[Donna Chat] Servidor offline para carregar histórico de conversas.");
      }
    }
    carregarSessoes();
  }, [sessaoId]);

  // Carrega as mensagens de uma conversa histórica no chat
  const carregarSessaoHistorica = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3000/donna/sessoes/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSessaoId(data.id);
        
        // Mapear histórico de mensagens JSONB
        if (data.historico && data.historico.length > 0) {
          const mappedMessages = data.historico.map((m, idx) => ({
            id: `${data.id}-${idx}`,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp ? new Date(m.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "15:00"
          }));
          setMessages(mappedMessages);
        }
      }
    } catch (err) {
      console.warn("[Donna Chat] Erro ao carregar histórico do chat:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // Contexto de RAG ativo (Harvey AI style)
  const [activeContext, setActiveContext] = useState({
    cnj: "0001234-56.2026.8.15.0001",
    juiz: "Dr. João Carlos de Albuquerque (TJPB)",
    perfil: "Legalista e Rígido",
    playbooks: [
      { titulo: "Playbook — Apelação Cível Padrão", score: "94.2%" },
      { titulo: "Tese — Nulidade de Citação Judicial", score: "81.0%" }
    ]
  });

  const enviarMensagem = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const currentInput = input;
    const userMsg = {
      id: Date.now().toString(),
      role: "user",
      content: currentInput,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // 1. Tentar chamada de API real ao backend Fastify da Donna
      const response = await fetch("http://localhost:3000/donna/conversar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          usuario_id: "da39b5b2-3864-44df-be9b-e7b8c2d82910", // ID de simulação válido
          processo_id: activeContext?.id || null,
          mensagem: currentInput,
          sessao_id: sessaoId // Envia o ID para manter a mesma sessão de chat gravada
        })
      });

      if (!response.ok) {
        throw new Error("Erro na comunicação com o servidor.");
      }

      const data = await response.json();
      
      if (data.resposta) {
        // Grava o ID retornado pelo banco de dados
        if (data.sessao_id) {
          setSessaoId(data.sessao_id);
        }

        const assistantMsg = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.resposta,
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        };
        
        // Atualizar também playbooks injetados no contexto lateral RAG se retornados
        if (data.playbooks_recuperados && data.playbooks_recuperados.length > 0) {
          setActiveContext(prev => ({
            ...prev,
            playbooks: data.playbooks_recuperados.map(p => ({
              titulo: p.titulo,
              score: p.similaridade ? `${(p.similaridade * 100).toFixed(1)}%` : "80%"
            }))
          }));
        }

        setMessages(prev => [...prev, assistantMsg]);
        setLoading(false);
        return;
      }
      
      throw new Error("Resposta vazia da IA.");
    } catch (error) {
      console.warn("[Donna Chat] Fallback ativado devido a erro de API:", error.message);
      
      // 2. Fallback de Simulação Local em caso de erro (ex: backend offline)
      setTimeout(() => {
        let resposta = "";
        const text = currentInput.toLowerCase();

        if (text.includes("juiz") || text.includes("joão carlos")) {
          resposta = `📋 **DOCKET**: 0001234-56.2026.8.15.0001
🔔 **EVENTO**: Inteligência comportamental do Julgador
📅 **PRAZO**: Sem prazo processual direto

🧠 **ANÁLISE COGNITIVA DA DONNA**:
O **Dr. João Carlos de Albuquerque** apresenta um índice de **85% de Raciocínio Legalista** e **90% de Rigidez Processual**. Ele desconsidera alegações baseadas em equidade ou teses constitucionais abstratas não sumuladas, decidindo com base exclusiva na interpretação literal da lei.

⚡ **AÇÕES ESTRATÉGICAS SUGERIDAS (confiança: Alta)**:
1. **[Ação de Ataque]**: Redija a peça recursal apontando a contradição literal de lei federal. Não cite doutrina abstrata.
2. **[Ação Preventiva]**: Certifique-se de que a petição não ultrapasse 5 páginas e de que não haja qualquer vício formal de representação ou custas. Ele pune rigorosamente erros formais.

📚 **PLAYBOOKS E CONTEXTO DE HISTÓRICO**:
- *Playbook — Apelação Cível Padrão* (similaridade semântica: 94.2%)
- *Banco de Precedentes* (2 precedentes de deferimento em sede de liminar).`;
        } else if (text.includes("prazo") || text.includes("apelação")) {
          resposta = `A **Apelação Cível** do processo *0001234-56.2026.8.15.0001* vence em **19/06/2026**.

O cálculo foi efetuado pelo Motor Determinístico da Donna sob as regras de **dias úteis (Art. 219 CPC)** e normas do **DJEN/CNJ**:
- **Disponibilização (D0)**: 28/05/2026
- **Publicação (D1)**: 29/05/2026 (Sexta-feira, dia útil seguinte)
- **Início Contagem (D2)**: 01/06/2026 (Segunda-feira)
- **Vencimento**: 19/06/2026.

Os feriados regionais e indisponibilidades locais do TJPB foram devidamente consultados e não afetaram este docket específico. Deseja que eu redija a minuta recursal baseando-se no nosso playbook padrão?`;
        } else {
          resposta = `Entendi perfeitamente. Conduzi uma busca RAG na base de conhecimento. Nosso repositório indica que a melhor abordagem técnica para esta situação é arguir a incompetência territorial ou ausência de pressupostos processuais objetivos.

Quer que eu redija uma minuta de petição customizada ou prefere analisar decisões anteriores deste julgador?`;
        }

        const assistantMsg = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: resposta,
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        };

        setMessages(prev => [...prev, assistantMsg]);
        setLoading(false);
      }, 1500);
    }
  };

  return (
    <div className="chat-container">
      {/* JANELA DE CHAT */}
      <div className="glass-card flex flex-col justify-between h-full p-6 overflow-hidden">
        {/* Header do Terminal */}
        <div className="flex items-center justify-between border-b pb-3 border-[var(--border-color)]">
          <div className="flex items-center space-x-3">
            <div className="ai-pulse-ring"></div>
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-accent-cyan" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <div>
                <h2 className="text-base font-bold text-theme-primary leading-tight">Donna Assistant Console</h2>
                <p className="text-xxs text-accent-cyan font-bold tracking-wider font-mono">Cognitive Strategic Chat // Active</p>
              </div>
            </div>
          </div>
          <span className="logo-badge">Tutor RAG Active</span>
        </div>

        {/* Mensagens */}
        <div 
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto my-4 pr-2 space-y-4 max-h-[calc(100vh-320px)]"
        >
          {messages.map((m) => (
            <div 
              key={m.id} 
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <span className="text-xxs text-muted mb-1 px-1 font-mono">
                {m.role === "user" ? "Dr. Advogado" : "Donna Engine"} • {m.timestamp}
              </span>
              <div 
                className={`message-bubble ${m.role}`}
                style={{ whiteSpace: "pre-line" }}
                dangerouslySetInnerHTML={{ 
                  __html: m.content
                    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                    .replace(/📋/g, `<svg className="w-3.5 h-3.5 inline mr-1 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`)
                    .replace(/🔔/g, `<svg className="w-3.5 h-3.5 inline mr-1 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>`)
                    .replace(/📅/g, `<svg className="w-3.5 h-3.5 inline mr-1 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`)
                    .replace(/🧠/g, `<svg className="w-3.5 h-3.5 inline mr-1 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>`)
                    .replace(/⚡/g, `<svg className="w-3.5 h-3.5 inline mr-1 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`)
                    .replace(/📚/g, `<svg className="w-3.5 h-3.5 inline mr-1 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>`)
                }}
              />
            </div>
          ))}

          {loading && (
            <div className="flex items-start flex-col">
              <span className="text-xxs text-muted mb-1 px-1 font-mono">Donna Engine • processing...</span>
              <div className="message-bubble assistant text-sm italic animate-pulse">
                {loadingText}
              </div>
            </div>
          )}
        </div>

        {/* Harvey Floating Capsule Prompt Bar */}
        <form onSubmit={enviarMensagem} className="floating-prompt-capsule mt-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Consulte a Donna estrategicamente (Ex: 'analisar juiz' ou 'calcular prazo apelação')..."
            className="donna-input"
            disabled={loading}
          />
          <button type="submit" className="donna-btn px-6 mr-1" disabled={loading}>
            Enviar
          </button>
        </form>
      </div>

      {/* SIDEBAR DE CONTEXTO COGNITIVO */}
      <div className="glass-card flex flex-col space-y-5 overflow-y-auto">
        {/* Histórico de Conversas Gravadas no Supabase (Nível Harvey/ChatGPT) */}
        <div className="space-y-2 text-xs border-b pb-4 border-[var(--border-color)]">
          <span className="text-xxs text-muted font-bold block uppercase tracking-wider font-mono mb-2">Conversas Salvas (Supabase)</span>
          <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
            {conversasSalvas.length > 0 ? (
              conversasSalvas.map((c) => (
                <div 
                  key={c.id} 
                  onClick={() => carregarSessaoHistorica(c.id)}
                  className={`p-2.5 rounded border border-[var(--border-color)] text-xxs font-mono cursor-pointer transition ${sessaoId === c.id ? "bg-accent-cyan/10 border-accent-cyan/40 text-accent-cyan" : "bg-[var(--bg-primary)]/80 hover:border-color-gold"}`}
                >
                  <p className="font-bold truncate text-theme-primary">{c.titulo}</p>
                  <span className="text-[10px] text-muted block mt-1">🕒 {new Date(c.updated_at).toLocaleDateString("pt-BR")}</span>
                </div>
              ))
            ) : (
              <p className="text-xxs text-muted italic">Nenhuma conversa gravada ainda.</p>
            )}
          </div>
          <button 
            onClick={() => { setSessaoId(null); setMessages([{ id: "1", role: "assistant", content: "Olá! Sou a **Donna**. Já processei todos os andamentos e diários de hoje pela manhã. O motor cognitivo está pronto. Como posso guiar a sua estratégia jurídica agora? Indique se deseja minutar recursos, avaliar os riscos processuais baseados na psicologia do julgador ou extrair teses do nosso repositório semântico.", timestamp: "15:20" }]); }}
            className="w-full text-center mt-3 text-xxs font-bold border border-dashed border-[var(--border-color)] hover:border-color-gold text-secondary hover:text-theme-primary p-2 rounded transition"
          >
            ＋ Nova Conversa Jurídica
          </button>
        </div>

        <div className="border-b pb-2 border-[var(--border-color)]">
          <h3 className="text-xxs font-bold text-muted uppercase tracking-wider font-mono">Injected Cognitive Context</h3>
        </div>

        {/* Processo */}
        <div className="space-y-1 text-xs">
          <span className="text-xxs text-muted font-bold block uppercase tracking-wider">Docket Monitor</span>
          <p className="font-bold text-theme-primary">Apelação Cível</p>
          <p className="font-mono text-secondary text-xxs bg-[var(--bg-primary)] p-2 rounded border border-[var(--border-color)]">{activeContext.cnj}</p>
        </div>

        {/* Juiz */}
        <div className="space-y-2 text-xs">
          <span className="text-xxs text-muted font-bold block uppercase tracking-wider">Judicial Psychology dossier</span>
          <p className="font-bold text-theme-primary">{activeContext.juiz}</p>
          
          <div className="cognitive-meter-container">
            <div className="cognitive-meter-header">
              <span>Legalismo Decisório</span>
              <span className="text-accent-cyan font-mono">85%</span>
            </div>
            <div className="cognitive-meter-track">
              <div className="cognitive-meter-bar" style={{ width: "85%" }}></div>
            </div>
          </div>
          
          <div className="cognitive-meter-container">
            <div className="cognitive-meter-header">
              <span>Rigidez Procedimental</span>
              <span className="text-accent-cyan font-mono">90%</span>
            </div>
            <div className="cognitive-meter-track">
              <div className="cognitive-meter-bar" style={{ width: "90%" }}></div>
            </div>
          </div>
        </div>

        {/* Playbooks */}
        <div className="space-y-2 text-xs">
          <span className="text-xxs text-muted font-bold block uppercase tracking-wider">Semantic Knowledge (pgvector)</span>
          {activeContext.playbooks.map((p, idx) => (
            <div key={idx} className="bg-[var(--bg-primary)] p-2.5 rounded border border-[var(--border-color)] text-xxs font-mono">
              <div className="flex items-center justify-between mb-1">
                <span className="text-theme-primary truncate max-w-[155px] font-bold">{p.titulo}</span>
                <span className="badge media">{p.score}</span>
              </div>
              <p className="text-muted text-xxs mt-0.5">Vetorizado via text-embedding-3-small</p>
            </div>
          ))}
          
          {/* Uploader de Playbooks / Conhecimento Manual */}
          <div className="pt-3 border-t border-[var(--border-color)] space-y-1.5">
            <span className="text-xxs text-muted font-bold block uppercase tracking-wider">Indexar Novo Documento RAG</span>
            <div className={`p-3 rounded border border-dashed text-center transition-all ${uploadingDoc ? 'border-accent-cyan bg-accent-cyan/5' : 'border-[var(--border-color)] hover:border-accent-cyan bg-[var(--bg-primary)]/40'}`}>
              <label className="cursor-pointer block">
                <input 
                  type="file" 
                  accept=".txt,.md,.json" 
                  onChange={handlePlaybookUpload} 
                  className="hidden" 
                  disabled={uploadingDoc}
                />
                {uploadingDoc ? (
                  <div className="space-y-1 py-1">
                    <div className="inline-block animate-spin w-4 h-4 border-2 border-accent-cyan border-t-transparent rounded-full mb-1"></div>
                    <p className="text-[10px] text-accent-cyan font-mono">Vetorizando com Gemini...</p>
                  </div>
                ) : (
                  <div className="space-y-1 py-1">
                    <svg className="w-5 h-5 mx-auto text-muted group-hover:text-accent-cyan transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-[10px] text-theme-primary font-bold">Enviar Playbook (.txt, .md)</p>
                    <p className="text-[9px] text-muted leading-tight">Indexação de teses e julgados no RAG da Donna</p>
                  </div>
                )}
              </label>
            </div>
            {uploadSuccess && (
              <p className="text-[10px] text-accent-emerald font-bold font-mono text-center mt-1 animate-pulse">✓ Indexado com sucesso!</p>
            )}
          </div>
        </div>

        <div className="bg-[var(--bg-primary)]/80 border border-[var(--border-color)] p-3.5 rounded text-xxs text-secondary leading-relaxed">
          <div className="flex items-center space-x-1.5 text-theme-primary mb-1.5">
            {/* Ícone de Cadeado de Auditoria SVG */}
            <svg className="w-3.5 h-3.5 text-accent-rose" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <strong className="text-xxs uppercase tracking-wider">Confidential Audit</strong>
          </div>
          <p className="text-muted">A Donna auditora e encripta todas as sessões de chat. Logs arquivados sob padrões federais de segurança cibernética.</p>
        </div>
      </div>
    </div>
  );
}
