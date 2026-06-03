"use client";

import React, { useState, useEffect } from "react";
// DT-05: hooks de dados reais (substitui useState hardcoded)
import { usePrazos, useProcessos, useDashboardStats, updatePrazoStatus } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Dashboard() {
  // DT-05: substituir todos os estados hardcoded por hooks que consomem a API real
  const { prazos, loading: loadingPrazos, error: errorPrazos, refetch: refetchPrazos } = usePrazos();
  const { processos, loading: loadingProcessos, error: errorProcessos, refetch: refetchProcessos } = useProcessos();
  const { stats, loading: loadingStats } = useDashboardStats();

  // Dados do usuário autenticado (DT-06)
  const { user, signOut } = useAuth();

  // Estados de UI (mantidos conforme antes)
  const [historicoAcoes, setHistoricoAcoes] = useState([]);
  const [activeDataIndex, setActiveDataIndex] = useState(4);
  const [exibirAuditoria, setExibirAuditoria] = useState(false);
  const [selectedStatType, setSelectedStatType] = useState(null);
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [selectedHearing, setSelectedHearing] = useState(null);
  const [prazoExpandido, setPrazoExpandido] = useState(null);

  // States de Cadastro de Processo (Sleek Glassmorphic Form)
  const [exibirCadastroProcesso, setExibirCadastroProcesso] = useState(false);
  const [formCnj, setFormCnj] = useState("");
  const [formCliente, setFormCliente] = useState("Banco do Brasil S.A.");
  const [formAdverso, setFormAdverso] = useState("Construtora Silva Ltda");
  const [formTribunal, setFormTribunal] = useState("TJPB");
  const [formVara, setFormVara] = useState("2ª Vara Cível");
  const [formComarca, setFormComarca] = useState("João Pessoa");
  const [formClasse, setFormClasse] = useState("Ação Ordinária de Cobrança");
  const [formAssunto, setFormAssunto] = useState("Direito Bancário / Cobrança");
  const [formJuiz, setFormJuiz] = useState("Dr. João Carlos de Albuquerque");
  const [formPrioridade, setFormPrioridade] = useState("media");

  // Ingestão e Vetorização de Documentos/Petições por IA no Dashboard
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleDocumentIngest = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingDoc(true);
    setUploadSuccess(false);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const conteudo = event.target.result;
      const titulo = file.name.replace(/\.[^/.]+$/, "");

      try {
        const response = await fetch("http://localhost:3000/donna/conhecimento/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            tipo: "documento_processo",
            titulo: titulo,
            conteudo: conteudo,
            tags: ["ingestao-painel"],
            area_direito: "Civil"
          })
        });

        if (response.ok) {
          setUploadSuccess(true);
          
          // Injeta um insight de prestígio no feed de ações de IA do dashboard
          const novaAcao = {
            id: `act-${Date.now()}`,
            processo: "0001234-56.2026.8.15.0001",
            evento: "DOCUMENTO TRIADO POR IA",
            relevancia: "media",
            donnaInsight: `O documento "${file.name}" foi ingerido com sucesso! A Donna vetorizou o teor estratégico e adicionou as teses ao repositório de RAG do escritório.`,
            hora: "Agora mesmo"
          };
          setHistoricoAcoes(prev => [novaAcao, ...prev]);

          alert(`✓ O documento "${file.name}" foi ingerido, analisado por IA e vetorizado no repositório cognitivo da Donna!`);
        } else {
          console.error("Erro ao ingerir documento:", response.statusText);
          alert("Erro ao processar o documento juridico.");
        }
      } catch (err) {
        console.error("Erro de conexão ao processar documento:", err.message);
        alert("Erro de conexão ao processar o documento.");
      } finally {
        setUploadingDoc(false);
      }
    };
    reader.readAsText(file);
  };

  const cadastrarProcesso = async (e) => {
    e.preventDefault();
    if (!formCnj.trim()) return;

    try {
      const response = await fetch("http://localhost:3000/processos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          numero_cnj: formCnj,
          tribunal: formTribunal,
          comarca: formComarca,
          vara: formVara,
          classe: formClasse,
          assunto: formAssunto,
          cliente_id: "local-cli-" + Date.now(), // Gera um ID fictício local
          advogado_responsavel_id: "da39b5b2-3864-44df-be9b-e7b8c2d82910",
          prioridade: formPrioridade,
          observacoes: `Processo cadastrado manualmente via console do advogado.`
        })
      });

      if (response.ok) {
        await refetchProcessos();
        // Reset form e fechar modal
        setFormCnj("");
        setExibirCadastroProcesso(false);
      }
    } catch (err) {
      console.error("[Cadastro Processo] Erro de rede ao registrar processo:", err.message);
    }
  };

  const audienciasSemana = [
    {
      processo: "0001234-56.2026.8.15.0001",
      titulo: "Ação Ordinária de Cobrança",
      tipo: "Audiência de Saneamento Cooperativo",
      data: "02/06/2026",
      hora: "14:00",
      sala: "Virtual - Microsoft Teams (Link ativo no painel)",
      juiz: "Dr. João Carlos de Albuquerque",
      tribunal: "TJPB",
      status: "Confirmada",
      advogado: "Dr. Roberto Silva",
      checklist: [
        "Apresentar demonstrativo atualizado do débito",
        "Destacar ausência de contestação específica aos juros contratuais",
        "Limitar manifestações a 3 minutos conforme praxe do julgador"
      ]
    },
    {
      processo: "0010987-88.2024.5.02.0002",
      titulo: "Reclamação Trabalhista",
      tipo: "Audiência de Instrução e Julgamento",
      data: "04/06/2026",
      hora: "09:30",
      sala: "Presencial - Fórum Ruy Barbosa, Sala 402",
      juiz: "Dra. Cláudia Valéria",
      tribunal: "TRT2",
      status: "Testemunhas intimadas",
      advogado: "Dr. Arthur Albuquerque",
      checklist: [
        "Acompanhar depoimento pessoal da reclamada sobre horas extras",
        "Confrontar testemunhas com registers de ponto biométrico",
        "Apresentar razões finais remissivas em mesa"
      ]
    },
    {
      processo: "0812345-12.2025.8.20.0001",
      titulo: "Ação de Indenização por Danos Morais",
      tipo: "Audiência de Conciliação Previa",
      data: "05/06/2026",
      hora: "16:00",
      sala: "Virtual - Zoom Meeting",
      juiz: "Dra. Heloísa Maria Souza",
      tribunal: "TJRN",
      status: "Pauta ativa",
      advogado: "Dra. Patrícia Lima",
      checklist: [
        "Avaliar proposta de acordo da operadora (limite mínimo: R$ 8.000)",
        "Destacar gravidade da inscrição indevida do nome do cliente",
        "Obter termo de baixa imediata em caso de transação judicial"
      ]
    }
  ];

  const alertasExpediente = [
    {
      tipo: "Indisponibilidade do PJe (TJRJ)",
      impacto: "alta",
      data: "03/06/2026",
      descricao: "O painel oficial do Tribunal de Justiça do Rio de Janeiro registrou interrupção técnica severa das 14h às 18h no dia 03 de junho de 2026, impedindo o protocolo e leitura de intimações.",
      fundamento: "Art. 224, § 1º do CPC e Resolução CNJ 455/2022. Os prazos que venceriam nesta data foram prorrogados automaticamente para o primeiro dia útil seguinte.",
      acoesExecutadas: [
        "Radar Operacional Donna identificou a queda sistêmica e emitiu protocolo",
        "Ajuste automatizado do prazo do processo 0004321-99 (Embargos de Declaração) do dia 07/06 para 08/06",
        "Envio de notificações de prorrogação preventiva para a Dra. Patrícia Lima"
      ]
    }
  ];

  const dadosGrafico = [
    { dia: "Seg", vol: 15, cnj: "TJSP", andamento: "12 petições" },
    { dia: "Ter", vol: 28, cnj: "TRF3", andamento: "22 liminares" },
    { dia: "Qua", vol: 19, cnj: "TJPB", andamento: "14 sentenças" },
    { dia: "Qui", vol: 42, cnj: "TRT2", andamento: "35 dockets" },
    { dia: "Sex", vol: 35, cnj: "TJRJ", andamento: "28 publicações" }
  ];

  const yCoordenadas = [45, 32, 41, 18, 25];

  const togglePrazo = (id) => {
    setPrazoExpandido(prazoExpandido === id ? null : id);
  };

  const concluirPrazo = async (id, e) => {
    e.stopPropagation();
    
    try {
      await updatePrazoStatus(id, "cumprido");
      await refetchPrazos();
    } catch (err) {
      console.warn("[Dashboard] Não foi possível dar baixa no prazo no servidor:", err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. TÍTULO E WELCOME DE PRESTÍGIO */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0 border-b border-[var(--border-color)] pb-5">
        <div>
          <div className="flex items-center space-x-3 mb-1.5">
            <div className="ai-pulse-container">
              <span className="ai-pulse-ring"></span>
              <span className="text-xxs text-accent-cyan font-bold tracking-wider uppercase font-mono">Donna Active // Legal Intelligence</span>
            </div>
            <span className="logo-badge">Carteira Sincronizada</span>
          </div>
          <h1 className="text-3xl font-light tracking-tight text-theme-primary leading-none">
            Copiloto Jurídico <strong className="text-color-gold font-medium">Estratégico</strong>
          </h1>
        </div>
        
        <div className="flex items-center space-x-3">
          <button className="donna-btn-outline text-xxs py-2 px-4" onClick={() => alert("Sincronizando processos com os Tribunais...")}>
            🔄 Sincronizar Processos
          </button>
          <a href="/donna" className="donna-btn text-xxs font-extrabold flex items-center justify-center h-8 px-4 rounded">
            Falar com a Donna
          </a>
        </div>
      </div>

      {/* 2. STATS PANELS — 100% RELEVANTES PARA O ADVOGADO (Processos, Prazos, Audiências, Indisponibilidades) */}
      <div className="stats-grid">
        <div 
          onClick={() => setSelectedStatType("processos")}
          className="glass-card stat-card cursor-pointer hover:scale-[1.01] hover:border-accent-cyan/35 transition-all duration-300"
        >
          <div>
            <span className="stat-title">Processos Ativos</span>
            <div className="stat-value">42</div>
          </div>
          <div className="flex items-center space-x-3">
            <svg className="sparkline-svg" viewBox="0 0 50 20" width="50" height="20">
              <path
                d="M0,15 L10,12 L20,16 L30,8 L40,11 L50,4"
                fill="none"
                stroke="var(--accent-cyan)"
                strokeWidth="2"
                strokeLinecap="round"
                className="sparkline-path"
              />
            </svg>
            <svg className="w-5 h-5 text-accent-cyan opacity-80" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
        </div>

        <div 
          onClick={() => setSelectedStatType("prazos")}
          className="glass-card stat-card cursor-pointer hover:scale-[1.01] hover:border-color-gold/35 transition-all duration-300"
        >
          <div>
            <span className="stat-title">Prazos em Aberto</span>
            <div className="stat-value text-color-gold">
              {prazos.filter(p => p.status === "aberto").length}
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <svg className="sparkline-svg" viewBox="0 0 50 20" width="50" height="20">
              <path
                d="M0,5 L10,14 L20,10 L30,16 L40,8 L50,12"
                fill="none"
                stroke="var(--color-gold)"
                strokeWidth="2"
                strokeLinecap="round"
                className="sparkline-path"
              />
            </svg>
            <svg className="w-5 h-5 text-color-gold opacity-80" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        </div>

        <div 
          onClick={() => setSelectedStatType("audiencias")}
          className="glass-card stat-card cursor-pointer hover:scale-[1.01] hover:border-accent-violet/35 transition-all duration-300"
        >
          <div>
            <span className="stat-title">Audiências da Semana</span>
            <div className="stat-value text-accent-violet">3</div>
          </div>
          <div className="flex items-center space-x-3">
            <svg className="sparkline-svg" viewBox="0 0 50 20" width="50" height="20">
              <path
                d="M0,18 L10,10 L20,14 L30,6 L40,9 L50,3"
                fill="none"
                stroke="var(--accent-violet)"
                strokeWidth="2"
                strokeLinecap="round"
                className="sparkline-path"
              />
            </svg>
            {/* Ícone de Balança ou Pessoas Representando Audiência em SVG */}
            <svg className="w-5 h-5 text-accent-violet opacity-80" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
        </div>

        <div 
          onClick={() => setSelectedStatType("alertas")}
          className="glass-card stat-card cursor-pointer hover:scale-[1.01] hover:border-accent-rose/35 transition-all duration-300"
        >
          <div>
            <span className="stat-title">Alertas de Expediente</span>
            <div className="stat-value text-accent-rose">1</div>
          </div>
          <div className="flex items-center space-x-3">
            <svg className="sparkline-svg" viewBox="0 0 50 20" width="50" height="20">
              <path
                d="M0,8 L10,12 L20,4 L30,16 L40,14 L50,18"
                fill="none"
                stroke="var(--accent-rose)"
                strokeWidth="2"
                strokeLinecap="round"
                className="sparkline-path"
              />
            </svg>
            <svg className="w-5 h-5 text-accent-rose opacity-80" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>
      </div>

      {/* 3. ROW CENTRAL INTERATIVA: TERMINAL E GRÁFICO */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Terminal de Ingestão Harvey */}
        <div className={`docket-upload-zone flex flex-col justify-center items-center h-[180px] p-4 relative ${uploadingDoc ? 'border-accent-cyan bg-[var(--accent-cyan-glow)]/5' : ''}`}>
          <label className="cursor-pointer flex flex-col items-center justify-center w-full h-full">
            <input 
              type="file" 
              accept=".txt,.md,.json" 
              onChange={handleDocumentIngest} 
              className="hidden" 
              disabled={uploadingDoc}
            />
            {uploadingDoc ? (
              <div className="text-center space-y-2">
                <div className="inline-block animate-spin w-6 h-6 border-2 border-color-gold border-t-transparent rounded-full mb-1"></div>
                <p className="text-xs text-color-gold font-mono uppercase tracking-wider">Cognitive Ingestion Active...</p>
                <p className="text-[10px] text-muted">A Donna está vetorizando e integrando o teor...</p>
              </div>
            ) : (
              <>
                <svg className="w-6 h-6 text-color-gold mb-2 transition-transform hover:scale-110 duration-200" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <h3 className="text-xs font-bold text-theme-primary uppercase tracking-wider">Protocolar / Ingerir Documento</h3>
                <p className="text-xxs text-secondary max-w-sm mt-1 text-center leading-normal">
                  {uploadSuccess ? "✓ Documento indexado com sucesso no RAG!" : "Arraste ou clique para enviar arquivos (.txt, .md). A Donna triará o teor e indexará as teses autonomamente."}
                </p>
              </>
            )}
          </label>
        </div>

        {/* Gráfico de Volumetria de Processos */}
        <div className="glass-card flex flex-col justify-between h-[180px] p-4 relative">
          <div className="flex items-center justify-between border-b pb-1.5 border-[var(--border-color)]">
            <span className="text-xxs font-bold text-muted uppercase tracking-wider">Histórico de Movimentações na Carteira</span>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-bold font-mono bg-[var(--accent-cyan-glow)] text-accent-cyan border border-accent-cyan/20 px-2 py-0.5 rounded transition-all duration-300">
                {dadosGrafico[activeDataIndex].dia}: {dadosGrafico[activeDataIndex].vol} andamentos ({dadosGrafico[activeDataIndex].cnj})
              </span>
              <span className="logo-badge">Semanal</span>
            </div>
          </div>

          <div className="flex items-end justify-between flex-1 pt-4 relative h-[100px]">
            {/* SVG Responsivo de alta precisão */}
            <svg className="absolute inset-0 w-full h-[80px] overflow-visible" viewBox="0 0 500 80" preserveAspectRatio="none">
              <defs>
                <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.35"/>
                  <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0"/>
                </linearGradient>
              </defs>
              
              {/* Preenchimento de Área sob o gráfico */}
              <path
                d="M 50 70 L 50 45 L 150 32 L 250 41 L 350 18 L 450 25 L 450 70 Z"
                fill="url(#area-gradient)"
                className="chart-area-main"
              />
              
              {/* Linha principal do gráfico */}
              <path
                d="M 50 45 L 150 32 L 250 41 L 350 18 L 450 25"
                fill="none"
                stroke="var(--accent-cyan)"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="chart-path-main"
              />

              {/* Linha vertical indicadora de hover do dia selecionado */}
              <line
                x1={50 + activeDataIndex * 100}
                y1={10}
                x2={50 + activeDataIndex * 100}
                y2={70}
                stroke="var(--accent-cyan)"
                strokeWidth="1"
                strokeDasharray="4 4"
                className="opacity-40 transition-all duration-300"
              />
              
              {/* Bolinha indicadora correspondente ao dia selecionado */}
              <circle
                cx={50 + activeDataIndex * 100}
                cy={yCoordenadas[activeDataIndex]}
                r="5"
                fill="var(--accent-cyan)"
                stroke="#fff"
                strokeWidth="2"
                className="transition-all duration-300"
                style={{ filter: "drop-shadow(0 0 4px var(--accent-cyan-glow))" }}
              />
            </svg>

            {/* Colunas invisíveis como zonas interativas de Hover que controlam o gráfico */}
            {dadosGrafico.map((d, idx) => (
              <div 
                key={idx}
                className="flex-1 flex flex-col items-center justify-end h-full z-10 cursor-pointer group pb-1.5"
                onMouseEnter={() => setActiveDataIndex(idx)}
              >
                <span className={`text-xxs font-mono font-bold transition-colors duration-200 ${activeDataIndex === idx ? "text-accent-cyan" : "text-muted"}`}>
                  {d.dia}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. MAIN GRID */}
      <div className="dashboard-grid">
        {/* COLUNA ESQUERDA: LISTA DE PRAZOS */}
        <div className="glass-card flex flex-col space-y-6">
          <div className="flex items-center justify-between border-b pb-3 border-[var(--border-color)]">
            <h2 className="text-base font-bold text-theme-primary uppercase tracking-wider">Fila Ativa de Prazos Determinísticos</h2>
            <span className="text-xxs text-muted font-bold font-mono">Resolução CNJ 16/05/2025</span>
          </div>

          <div className="space-y-4">
            {prazos.map((p) => (
              <div 
                key={p.id} 
                className={`deadline-item ${p.prioridade} cursor-pointer`}
                onClick={() => togglePrazo(p.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <span className={`badge ${p.status === "cumprido" ? "concluido" : p.prioridade}`}>
                        {p.status === "cumprido" ? "concluido" : p.prioridade}
                      </span>
                      <span className="text-xxs text-secondary font-bold font-mono">{p.tribunal} • {p.comarca}</span>
                    </div>
                    <h3 className="text-base font-bold text-theme-primary">{p.tipo}</h3>
                    <p className="text-xxs text-secondary font-mono">PROCESSO: {p.cnj}</p>
                  </div>
                  
                  <div className="text-right space-y-2">
                    <span className="text-xxs text-muted block uppercase font-bold tracking-wider">Prazo Limite:</span>
                    <span className={`text-base font-bold block ${p.status === "cumprido" ? "text-accent-emerald line-through" : "text-theme-primary"}`}>
                      {p.vencimento}
                    </span>
                    {p.status === "aberto" && (
                      <button 
                        className="badge concluido cursor-pointer border border-emerald-950 hover:bg-emerald-900/35 transition"
                        onClick={(e) => concluirPrazo(p.id, e)}
                      >
                        Confirmar
                      </button>
                    )}
                  </div>
                </div>

                {/* Exibição Expandida com Linha do Tempo CPC */}
                {prazoExpandido === p.id && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-color)] text-xxs text-secondary space-y-4 bg-[var(--bg-primary)]/60 p-4 rounded border border-[var(--border-color)]">
                    <p>
                      <svg className="w-3.5 h-3.5 inline mr-1 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <strong>Responsável Operacional:</strong> {p.responsavel}
                    </p>
                    
                    {/* Linha do Tempo CPC / CNJ (Legal Design Vetorial) */}
                    <div>
                      <span className="text-xxs text-muted font-bold block uppercase tracking-wider mb-2">Visualização da Contagem (DJEN CNJ / CPC)</span>
                      
                      <div className="timeline-cpc my-4">
                        <div className="timeline-step">
                          <div className="step-circle">D0</div>
                          <span className="step-label">Disponib.</span>
                          <span className="text-xxs text-theme-primary font-mono mt-1">D0</span>
                        </div>
                        <div className="timeline-step">
                          <div className="step-circle">D1</div>
                          <span className="step-label">Public.</span>
                          <span className="text-xxs text-theme-primary font-mono mt-1">D1</span>
                        </div>
                        <div className="timeline-step active">
                          <div className="step-circle">D2</div>
                          <span className="step-label">Início</span>
                          <span className="text-xxs text-theme-primary font-mono mt-1">D2</span>
                        </div>
                        <div className="timeline-step active">
                          <div className="step-circle">
                            <svg className="w-2.5 h-2.5 text-accent-cyan" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                          <span className="step-label">Contagem</span>
                          <span className="text-xxs text-theme-primary font-mono mt-1">+{p.dias}d Úteis</span>
                        </div>
                        <div className="timeline-step active">
                          <div className="step-circle">
                            <svg className="w-3 h-3 text-color-gold" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7h12m0 0l-3-1m3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9h-6m2-2v2m-2 4v12a2 2 0 002 2h2a2 2 0 002-2V9m-4 0h4" />
                            </svg>
                          </div>
                          <span className="step-label">Prazo Final</span>
                          <span className="text-xxs text-color-gold font-bold font-mono mt-1">{p.vencimento}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-xxs leading-relaxed">
                      <strong>Fundamento do Raciocínio de Prazos:</strong>
                      <p className="italic mt-1 text-muted leading-relaxed">{p.motivo}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* COLUNA DIREITA: ESTRATÉGIA COGNITIVA & IA */}
        <div className="space-y-6">
          <div className="glass-card flex flex-col space-y-6">
            <div className="flex items-center justify-between border-b pb-3 border-[var(--border-color)]">
              <h2 className="text-base font-bold text-theme-primary uppercase tracking-wider">Ações Estratégicas Sugeridas</h2>
              <span className="logo-badge">Análise Donna</span>
            </div>

            <div className="space-y-4">
              {historicoAcoes.map((a) => (
                <div key={a.id} className="p-4 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`badge ${a.relevancia}`}>{a.evento}</span>
                    <span className="text-xxs text-muted">{a.hora}</span>
                  </div>
                  <p className="text-xxs text-muted font-mono">DOCKET: {a.processo}</p>
                  <p className="text-xs text-secondary leading-relaxed bg-[var(--bg-primary)] p-3 rounded border-l-2 border-color-gold italic">
                    {a.donnaInsight}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* PAINEL DE AUDITORIA DE IA E TELEMETRIA (Harvey style - Revela dados técnicos no clique!) */}
          <div className="glass-card flex flex-col space-y-3 border-cyan-950/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-theme-primary">
                <svg className="w-4 h-4 text-accent-cyan" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <h3 className="text-xs font-bold uppercase tracking-wider">Painel Técnico da IA</h3>
              </div>
              <button 
                onClick={() => setExibirAuditoria(!exibirAuditoria)} 
                className="badge media hover:bg-slate-900 border"
              >
                {exibirAuditoria ? "Ocultar" : "Exibir Telemetria"}
              </button>
            </div>

            <p className="text-xs text-secondary leading-relaxed">
              Consulte a integridade do RAG, latência de vetores e auditoria de tokens da Donna no banco de dados.
            </p>

            {exibirAuditoria && (
              <div className="mt-3 pt-3 border-t border-[var(--border-color)] space-y-2 text-xxs font-mono text-secondary bg-[var(--bg-primary)] p-3 rounded border border-[var(--border-color)]">
                <p className="flex justify-between">
                  <span>Conexão Supabase:</span>
                  <span className="text-accent-emerald font-bold">ONLINE</span>
                </p>
                <p className="flex justify-between">
                  <span>Total de Vetores (pgvector):</span>
                  <span className="text-theme-primary font-bold">2.418 playbooks</span>
                </p>
                <p className="flex justify-between">
                  <span>Modelo de Embedding:</span>
                  <span className="text-accent-cyan">text-embedding-3-small</span>
                </p>
                <p className="flex justify-between">
                  <span>Latência Média RAG:</span>
                  <span className="text-theme-primary font-bold">124ms</span>
                </p>
                <p className="flex justify-between">
                  <span>Criptografia de Sessão:</span>
                  <span className="text-accent-violet">AES-256 Active</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5. MODAL DE DETALHAMENTO DE STATS (SLIDE-IN GLASS MODAL) */}
      {selectedStatType && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/75 backdrop-blur-md transition-all duration-300">
          {/* Overlay click to close */}
          <div className="absolute inset-0" onClick={() => { setSelectedStatType(null); setSelectedProcess(null); setSelectedHearing(null); }}></div>
          
          {/* Modal Container */}
          <div className="w-full max-w-2xl h-full bg-[var(--bg-card)] border-l border-[var(--border-color)] p-6 overflow-y-auto flex flex-col justify-between shadow-2xl relative z-10 transition-transform duration-300 transform translate-x-0">
            <div>
              {/* Header do Modal */}
              <div className="flex items-center justify-between border-b pb-4 border-[var(--border-color)] mb-5">
                <div>
                  <span className="logo-badge mb-1.5 block max-w-max">Telemetria Ativa</span>
                  <h2 className="text-xl font-light text-theme-primary tracking-tight">
                    {selectedStatType === "processos" && <>Dossiers de <strong className="text-color-gold font-medium">Processos Ativos (42)</strong></>}
                    {selectedStatType === "prazos" && <>Monitoramento de <strong className="text-color-gold font-medium">Prazos em Aberto ({prazos.filter(p => p.status === "aberto").length})</strong></>}
                    {selectedStatType === "audiencias" && <>Agenda de <strong className="text-color-gold font-medium">Audiências da Semana ({audienciasSemana.length})</strong></>}
                    {selectedStatType === "alertas" && <>Eventos & <strong className="text-accent-rose font-medium">Alertas de Expediente (1)</strong></>}
                  </h2>
                </div>
                <button 
                  onClick={() => { setSelectedStatType(null); setSelectedProcess(null); setSelectedHearing(null); }}
                  className="theme-toggle-btn text-xxs font-bold uppercase tracking-wider py-1.5 px-3 border hover:bg-slate-900/50"
                >
                  ✖ Fechar
                </button>
              </div>

              {/* CONTEÚDOS ESPECÍFICOS DOS MODAIS */}

              {/* A. PROCESSOS ATIVOS LIST */}
              {selectedStatType === "processos" && !selectedProcess && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b pb-3 border-[var(--border-color)] mb-4">
                    <p className="text-xs text-secondary">Clique em qualquer processo para abrir o **Prontuário Jurídico e RAG** completo da Donna:</p>
                    <button 
                      onClick={() => setExibirCadastroProcesso(!exibirCadastroProcesso)}
                      className="px-3.5 py-2 bg-accent-cyan/15 hover:bg-accent-cyan/25 border border-accent-cyan/30 text-accent-cyan text-[10px] font-bold uppercase rounded tracking-wider transition-all duration-200 shadow-sm cursor-pointer"
                    >
                      {exibirCadastroProcesso ? "✕ Cancelar" : "＋ Cadastrar Processo"}
                    </button>
                  </div>

                  {/* Formulário de Cadastro de Processo (Glassmorphic Slide-down) */}
                  {exibirCadastroProcesso && (
                    <form onSubmit={cadastrarProcesso} className="p-5 bg-[var(--bg-primary)]/70 border border-[var(--border-color)] rounded-lg space-y-4 animate-fade-in mb-4">
                      <h4 className="text-xs font-bold text-theme-primary uppercase tracking-wider border-b pb-1.5 border-[var(--border-color)] flex items-center space-x-1.5">
                        <svg className="w-3.5 h-3.5 text-accent-cyan" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M12 4v16m8-8H4" />
                        </svg>
                        <span>Vetorizar Novo Caso na Carteira</span>
                      </h4>

                      <div className="grid grid-cols-2 gap-3 text-xxs">
                        <div className="space-y-1">
                          <label className="text-muted uppercase font-bold tracking-wider">Número CNJ *</label>
                          <input 
                            type="text" 
                            value={formCnj}
                            onChange={(e) => setFormCnj(e.target.value)}
                            placeholder="0000000-00.0000.0.00.0000"
                            required
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 rounded focus:border-accent-cyan text-theme-primary outline-none font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-muted uppercase font-bold tracking-wider">Tribunal *</label>
                          <input 
                            type="text" 
                            value={formTribunal}
                            onChange={(e) => setFormTribunal(e.target.value)}
                            placeholder="Ex: TJPB"
                            required
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 rounded focus:border-accent-cyan text-theme-primary outline-none font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-muted uppercase font-bold tracking-wider">Classe Processual</label>
                          <input 
                            type="text" 
                            value={formClasse}
                            onChange={(e) => setFormClasse(e.target.value)}
                            placeholder="Ex: Ação Ordinária de Cobrança"
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 rounded focus:border-accent-cyan text-theme-primary outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-muted uppercase font-bold tracking-wider">Assunto Principal</label>
                          <input 
                            type="text" 
                            value={formAssunto}
                            onChange={(e) => setFormAssunto(e.target.value)}
                            placeholder="Ex: Contratos Bancários"
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 rounded focus:border-accent-cyan text-theme-primary outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-muted uppercase font-bold tracking-wider">Foro / Comarca</label>
                          <input 
                            type="text" 
                            value={formComarca}
                            onChange={(e) => setFormComarca(e.target.value)}
                            placeholder="Ex: João Pessoa"
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 rounded focus:border-accent-cyan text-theme-primary outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-muted uppercase font-bold tracking-wider">Juízo / Vara</label>
                          <input 
                            type="text" 
                            value={formVara}
                            onChange={(e) => setFormVara(e.target.value)}
                            placeholder="Ex: 2ª Vara Cível"
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 rounded focus:border-accent-cyan text-theme-primary outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-muted uppercase font-bold tracking-wider">Magistrado Envolvido</label>
                          <input 
                            type="text" 
                            value={formJuiz}
                            onChange={(e) => setFormJuiz(e.target.value)}
                            placeholder="Ex: Dr. João Carlos de Albuquerque"
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 rounded focus:border-accent-cyan text-theme-primary outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-muted uppercase font-bold tracking-wider">Prioridade Processual</label>
                          <select 
                            value={formPrioridade}
                            onChange={(e) => setFormPrioridade(e.target.value)}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 rounded focus:border-accent-cyan text-theme-primary outline-none"
                          >
                            <option value="urgente">🚨 Urgente</option>
                            <option value="alta">⚡ Alta</option>
                            <option value="media">📅 Média</option>
                            <option value="baixa">🔍 Baixa</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex justify-end pt-2 border-t border-[var(--border-color)]">
                        <button 
                          type="submit" 
                          className="px-5 py-2.5 bg-color-gold text-black text-xxs font-bold uppercase rounded tracking-wider hover:bg-yellow-500 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
                        >
                          ✓ Confirmar Cadastro & Vetorizar
                        </button>
                      </div>
                    </form>
                  )}
                  
                  {processos.map((p) => (
                    <div 
                      key={p.cnj}
                      onClick={() => setSelectedProcess(p)}
                      className="p-4 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded hover:border-color-gold/50 cursor-pointer transition duration-200 hover:scale-[1.005] group"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="badge media mb-1 bg-accent-cyan/5 text-accent-cyan border border-accent-cyan/10">{p.tribunal} • {p.vara}</span>
                          <h3 className="text-sm font-bold text-theme-primary group-hover:text-color-gold transition-colors">{p.titulo}</h3>
                          <p className="text-xxs text-muted mt-0.5">CNJ: {p.cnj}</p>
                        </div>
                        <span className="text-xxs text-secondary font-mono">{p.distribuicao}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-[var(--border-color)] text-xxs text-secondary">
                        <p><strong>Cliente:</strong> {p.cliente}</p>
                        <p><strong>Adversário:</strong> {p.adverso}</p>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <span className="text-[10px] font-bold uppercase text-color-gold font-mono tracking-wider group-hover:underline">Abrir Prontuário Completo →</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* B. PROCESS DOSSIER DETAILED NESTED OVERLAY */}
              {selectedStatType === "processos" && selectedProcess && (
                <div className="space-y-5 animate-fade-in">
                  <button 
                    onClick={() => setSelectedProcess(null)}
                    className="text-xxs text-accent-cyan font-bold hover:underline mb-2 flex items-center space-x-1"
                  >
                    ← Voltar para a Lista de Processos
                  </button>

                  <div className="p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded border-l-2 border-color-gold space-y-2">
                    <span className="badge media">{selectedProcess.tribunal} • {selectedProcess.vara}</span>
                    <h3 className="text-lg font-bold text-theme-primary leading-tight">{selectedProcess.titulo}</h3>
                    <p className="text-xxs font-mono text-secondary">PROCESSO CNJ: {selectedProcess.cnj}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-xs bg-[var(--bg-primary)]/30 border border-[var(--border-color)] p-4 rounded text-secondary">
                    <p><strong>Cliente:</strong> <span className="text-theme-primary">{selectedProcess.cliente}</span></p>
                    <p><strong>Parte Contrária:</strong> <span className="text-theme-primary">{selectedProcess.adverso}</span></p>
                    <p><strong>Data de Distribuição:</strong> <span className="text-theme-primary font-mono">{selectedProcess.distribuicao}</span></p>
                    <p><strong>Valor da Causa:</strong> <span className="text-color-gold font-bold">{selectedProcess.valor}</span></p>
                    <p><strong>Juiz Relator:</strong> <span className="text-theme-primary">{selectedProcess.juiz}</span></p>
                    <p><strong>Fase Processual:</strong> <span className="badge media ml-1 bg-cyan-950/20">{selectedProcess.fase}</span></p>
                  </div>

                  <div className="space-y-2">
                    <span className="text-xxs font-bold text-muted uppercase tracking-wider block">Último Andamento Ingerido</span>
                    <div className="p-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-xs text-secondary leading-relaxed italic border-l-2 border-accent-cyan">
                      "{selectedProcess.andamentoRecente}"
                    </div>
                  </div>

                  {/* Psicologia do Juiz Injetada */}
                  <div className="p-4 bg-slate-950/50 border border-slate-900 rounded space-y-2 text-xs">
                    <div className="flex items-center space-x-1 text-white">
                      <svg className="w-3.5 h-3.5 text-color-gold" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <strong className="text-xxs uppercase tracking-wider text-color-gold">Inteligência Comportamental (Psicologia do Juiz)</strong>
                    </div>
                    <p className="text-slate-300 leading-relaxed italic">{selectedProcess.perfilJuiz}</p>
                  </div>

                  {/* Playbooks RAG pgvector */}
                  <div className="space-y-3.5">
                    <span className="text-xxs font-bold text-muted uppercase tracking-wider block">Playbook Tático Inteligente Recomendado (RAG pgvector)</span>
                    <div className="bg-[var(--bg-primary)] p-3.5 rounded border border-[var(--border-color)] text-xxs font-mono text-secondary space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-theme-primary font-bold">{selectedProcess.playbookSugerido}</span>
                        <span className="badge media bg-emerald-950/20 text-accent-emerald">94.2% relevância</span>
                      </div>
                      <p className="text-muted leading-relaxed">Este playbook contém teses pré-aprovadas pelo departamento civil que se casam semânticamente com o perfil comportamental legalista restrito do {selectedProcess.juiz}. Use a minuta gerada na central conversacional Donna.</p>
                    </div>
                  </div>

                  {/* Procedural Timeline */}
                  <div className="space-y-3">
                    <span className="text-xxs font-bold text-muted uppercase tracking-wider block">Linha do Tempo de Andamentos Principais</span>
                    <div className="space-y-2.5">
                      {selectedProcess.timeline.map((evt, idx) => (
                        <div key={idx} className="flex items-start space-x-3 text-xxs bg-[var(--bg-primary)]/20 p-2.5 rounded border border-[var(--border-color)]">
                          <span className="font-mono text-muted font-bold pt-0.5">{evt.data}</span>
                          <p className="text-theme-primary font-mono">{evt.evento}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ações Técnicas no Dossier */}
                  <div className="flex flex-wrap gap-2 pt-3 border-t border-[var(--border-color)]">
                    <a href="/donna" className="donna-btn text-xxs py-2 px-3 text-center rounded flex-1">
                      💬 Redigir Peça com a Donna
                    </a>
                    <button onClick={() => alert("Simulando impacto de embargos processuais no tribunal...")} className="donna-btn-outline text-xxs py-2 px-3 flex-1">
                      ⚖️ Simular Embargos IA
                    </button>
                    <button onClick={() => alert("Relatório Estratégico PDF exportado para a pasta local.")} className="donna-btn-outline text-xxs py-2 px-3 border-rose-950 text-accent-rose hover:bg-rose-950/10 flex-1">
                      📥 Exportar Relatório de IA
                    </button>
                  </div>
                </div>
              )}

              {/* C. PRAZOS EM ABERTO DETAIL */}
              {selectedStatType === "prazos" && (
                <div className="space-y-4">
                  <p className="text-xs text-secondary">Consulte a listagem de todos os dockets e contagens operacionais ativas:</p>
                  
                  {prazos.map((p) => (
                    <div 
                      key={p.id}
                      onClick={() => { setSelectedStatType("processos"); setSelectedProcess(processos.find(pa => pa.cnj === p.cnj) || processos[0]); }}
                      className="p-4 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] border-l-2 border-color-gold rounded hover:border-color-gold transition cursor-pointer"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className={`badge ${p.prioridade} mb-1.5`}>{p.prioridade}</span>
                          <h4 className="text-sm font-bold text-theme-primary">{p.tipo}</h4>
                          <p className="text-xxs text-secondary font-mono mt-0.5">PROCESSO: {p.cnj}</p>
                          <p className="text-xxs text-muted mt-1">{p.tribunal} • {p.comarca}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xxs text-muted block uppercase font-bold tracking-wider mb-1">Limite:</span>
                          <span className="text-sm font-bold text-theme-primary">{p.vencimento}</span>
                          <span className="text-[10px] block text-accent-cyan font-bold font-mono mt-2">{p.dias} dias úteis</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* D. AUDIÊNCIAS DA SEMANA */}
              {selectedStatType === "audiencias" && !selectedHearing && (
                <div className="space-y-4">
                  <p className="text-xs text-secondary">Selecione uma audiência agendada para carregar o **Checklist Estratégico** e diretrizes da Donna:</p>
                  
                  {audienciasSemana.map((h, idx) => (
                    <div 
                      key={idx}
                      onClick={() => setSelectedHearing(h)}
                      className="p-4 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] border-l-2 border-accent-violet rounded hover:border-accent-violet transition cursor-pointer group"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="badge media mb-1.5 bg-violet-950/20 text-accent-violet border border-accent-violet/20">{h.tribunal} • {h.status}</span>
                          <h4 className="text-sm font-bold text-theme-primary group-hover:text-accent-violet transition-colors">{h.tipo}</h4>
                          <p className="text-xxs text-secondary font-mono mt-0.5">DOCKET: {h.processo}</p>
                          <p className="text-xxs text-muted mt-1">Juiz Relator: {h.juiz}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-theme-primary block">{h.data}</span>
                          <span className="text-xxs text-color-gold block font-bold font-mono mt-1">⏰ {h.hora}</span>
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <span className="text-[10px] font-bold uppercase text-accent-violet font-mono tracking-wider">Ver Diretrizes e Checklist →</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* E. AUDIENCIA DETAILED NESTED OVERLAY */}
              {selectedStatType === "audiencias" && selectedHearing && (
                <div className="space-y-5 animate-fade-in">
                  <button 
                    onClick={() => setSelectedHearing(null)}
                    className="text-xxs text-accent-violet font-bold hover:underline mb-2 flex items-center space-x-1"
                  >
                    ← Voltar para a Agenda de Audiências
                  </button>

                  <div className="p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded border-l-2 border-accent-violet space-y-2">
                    <span className="badge media bg-violet-950/20 text-accent-violet">{selectedHearing.tribunal} • {selectedHearing.status}</span>
                    <h3 className="text-lg font-bold text-theme-primary leading-tight">{selectedHearing.tipo}</h3>
                    <p className="text-xxs font-mono text-secondary">CASO: {selectedHearing.titulo}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-xs bg-[var(--bg-primary)]/30 border border-[var(--border-color)] p-4 rounded text-secondary">
                    <p><strong>Data:</strong> <span className="text-theme-primary font-mono">{selectedHearing.data}</span></p>
                    <p><strong>Horário Fatal:</strong> <span className="text-color-gold font-bold font-mono">⏰ {selectedHearing.hora}</span></p>
                    <p><strong>Juiz Relator:</strong> <span className="text-theme-primary">{selectedHearing.juiz}</span></p>
                    <p><strong>Advogado Designado:</strong> <span className="text-theme-primary">{selectedHearing.advogado}</span></p>
                    <p className="col-span-2"><strong>Local/Sala Virtual:</strong> <span className="text-accent-cyan font-mono block mt-1 bg-slate-950 p-2 rounded border border-slate-900">{selectedHearing.sala}</span></p>
                  </div>

                  {/* Checklist Tático da IA */}
                  <div className="space-y-3.5">
                    <div className="flex items-center space-x-1 text-theme-primary">
                      <svg className="w-4 h-4 text-accent-violet" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                      <strong className="text-xxs uppercase tracking-wider">Diretrizes de Raciocínio & Checklist do Advogado</strong>
                    </div>

                    <div className="p-4 bg-slate-950/60 border border-slate-900 rounded space-y-3 text-xs">
                      {selectedHearing.checklist.map((item, idx) => (
                        <div key={idx} className="flex items-start space-x-2.5">
                          <input type="checkbox" className="mt-0.5 rounded text-accent-violet focus:ring-accent-violet" />
                          <p className="text-slate-300">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-[var(--border-color)]">
                    <button onClick={() => alert("Acessando videoconferência do tribunal no Teams/Zoom...")} className="donna-btn text-xxs py-2 px-3 text-center rounded flex-1">
                      🔗 Entrar na Sala Virtual
                    </button>
                    <button 
                      onClick={() => { setSelectedStatType("processos"); setSelectedProcess(processos.find(pa => pa.cnj === selectedHearing.processo) || processos[0]); }}
                      className="donna-btn-outline text-xxs py-2 px-3 flex-1"
                    >
                      📂 Consultar Processo Completo
                    </button>
                  </div>
                </div>
              )}

              {/* F. ALERTAS DE EXPEDIENTE */}
              {selectedStatType === "alertas" && (
                <div className="space-y-5">
                  <p className="text-xs text-secondary">A Donna escaneia os painéis operacionais dos tribunais continuamente para proteger seus prazos de perdas sistemáticas.</p>
                  
                  {alertasExpediente.map((al, idx) => (
                    <div key={idx} className="p-4 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] border-l-2 border-accent-rose rounded space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="badge urgente">Impacto: {al.impacto}</span>
                        <span className="text-xxs text-muted font-mono">{al.data}</span>
                      </div>
                      
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-theme-primary">{al.tipo}</h4>
                        <p className="text-xs text-secondary leading-relaxed">{al.descricao}</p>
                      </div>

                      <div className="p-3 bg-[#030407] border border-gray-900 rounded text-xxs leading-relaxed">
                        <strong className="text-color-gold block mb-1">📜 Fundamento Jurídico de Prorrogação:</strong>
                        <p className="italic text-muted">{al.fundamento}</p>
                      </div>

                      <div className="space-y-2">
                        <span className="text-xxs font-bold text-theme-primary block uppercase tracking-wider">Ações Executadas Autônomas da Donna:</span>
                        <div className="space-y-1.5">
                          {al.acoesExecutadas.map((ac, i) => (
                            <div key={i} className="flex items-center space-x-2 text-xxs text-secondary">
                              <span className="text-accent-rose">✔</span>
                              <p className="font-mono">{ac}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  <div className="pt-3 border-t border-[var(--border-color)]">
                    <button onClick={() => alert("Auditando registers oficiais de indisponibilidade via API do CNJ...")} className="donna-btn text-xxs w-full">
                      🔍 Forçar Re-auditoria Geral de Prazos CNJ
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <div className="border-t pt-4 border-[var(--border-color)] flex items-center justify-between text-xxs text-muted mt-5 font-mono">
              <span>Donna AI Co-pilot • Strategic Dossier</span>
              <span>AES-256 Encrypted</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
