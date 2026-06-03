"use client";

import React, { useState, useEffect, useCallback } from "react";

const API_BASE = "http://127.0.0.1:3000/api";

export default function Atores() {
  const [atores, setAtores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Estados de processamento por Magistrado
  const [ingestingMap, setIngestingMap] = useState({});
  const [profilingMap, setProfilingMap] = useState({});
  
  // Dados de analise adicionais por Magistrado (Timeline & Distribuição de Resultados)
  const [analyticsMap, setAnalyticsMap] = useState({});

  // Formulário de Cadastro
  const [novoAtorForm, setNovoAtorForm] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("juiz");
  const [tribunal, setTribunal] = useState("TJPB");
  const [comarca, setComarca] = useState("João Pessoa");
  const [vara, setVara] = useState("");
  const [perfil, setPerfil] = useState("legalista");
  const [temperamento, setTemperamento] = useState("rigido");
  const [preferencia, setPreferencia] = useState("");

  /**
   * Busca a lista de magistrados no backend
   */
  const carregarMagistrados = useCallback(async (query = "") => {
    setLoading(true);
    try {
      const url = query ? `${API_BASE}/magistrados?q=${encodeURIComponent(query)}` : `${API_BASE}/magistrados`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Falha ao obter lista do backend.");
      const data = await res.json();
      setAtores(data);

      // Carrega timeline e estatísticas para cada um de forma paralela e não bloqueante
      data.forEach(ator => {
        carregarTimelineEEstatisticas(ator.id);
      });
    } catch (err) {
      console.error("[Front] Erro ao carregar magistrados:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Carrega dados do histórico e estatísticas decisórias de um magistrado específico
   */
  const carregarTimelineEEstatisticas = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/magistrados/${id}/timeline`);
      if (!res.ok) throw new Error("Erro ao obter analítico.");
      const data = await res.json();
      setAnalyticsMap(prev => ({
        ...prev,
        [id]: data
      }));
    } catch (err) {
      console.error(`[Front] Falha ao carregar timeline de ${id}:`, err);
    }
  };

  useEffect(() => {
    carregarMagistrados();
  }, [carregarMagistrados]);

  /**
   * Executa a busca com debounce manual ou clique
   */
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    // Dispara a busca
    carregarMagistrados(val);
  };

  /**
   * Cadastra um novo magistrado (Dossier)
   */
  const cadastrarAtor = async (e) => {
    e.preventDefault();
    if (!nome || !tribunal) return alert("Por favor, preencha Nome e Tribunal!");

    try {
      const res = await fetch(`${API_BASE}/magistrados`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          nome,
          tipo,
          tribunal,
          comarca,
          vara,
          cargo_atual: tipo === "juiz" ? "Juiz de Direito" : "Membro do Tribunal",
          perfil_decisorio: perfil,
          temperamento,
          preferencias_processuais: preferencia
        })
      });

      if (!res.ok) throw new Error("Erro ao cadastrar.");
      
      alert("Dossier cadastrado com sucesso! Prossiga com a Ingestão de Decisões.");
      setNovoAtorForm(false);
      setNome("");
      setPreferencia("");
      carregarMagistrados(searchTerm);
    } catch (err) {
      alert(`Falha ao cadastrar magistrado: ${err.message}`);
    }
  };

  /**
   * Executa a coleta/ingestão respeitosa de jurisprudência (100 decisões)
   */
  const handleIngest = async (id) => {
    setIngestingMap(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`${API_BASE}/magistrados/${id}/ingest`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro de rede.");

      alert(data.mensagem);
      // Recarrega analítico e lista
      await carregarTimelineEEstatisticas(id);
      await carregarMagistrados(searchTerm);
    } catch (err) {
      alert(`Erro na coleta de decisões: ${err.message}`);
    } finally {
      setIngestingMap(prev => ({ ...prev, [id]: false }));
    }
  };

  /**
   * Executa a análise cognitiva do perfil via Claude 3.5 Sonnet
   */
  const handleProfile = async (id) => {
    setProfilingMap(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`${API_BASE}/magistrados/${id}/profile`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao invocar IA.");

      alert("Análise cognitiva concluída com sucesso via Claude 3.5 Sonnet!");
      // Recarrega analítico e lista
      await carregarTimelineEEstatisticas(id);
      await carregarMagistrados(searchTerm);
    } catch (err) {
      alert(`Falha no processamento qualitativo: ${err.message}`);
    } finally {
      setProfilingMap(prev => ({ ...prev, [id]: false }));
    }
  };

  // Renderizador auxiliar de estrelas ★★★★☆
  const renderStars = (rating) => {
    const stars = [];
    const clampRating = Math.max(1, Math.min(rating || 3, 5));
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <span key={i} className={i <= clampRating ? "text-color-gold text-lg" : "text-gray-600 text-lg"}>
          ★
        </span>
      );
    }
    return (
      <div className="flex items-center space-x-1 group relative cursor-help">
        {stars}
        <span className="tooltip hidden group-hover:block absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-[var(--bg-primary)] border border-[var(--border-color)] text-xxs p-2.5 rounded text-secondary w-48 shadow-lg z-50">
          Metodologia: baseado no volume de decisões brutas analisadas e na dispersão temporal (fidelidade estatística).
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 border-b border-[var(--border-color)] pb-6">
        <div>
          <div className="flex items-center space-x-2 mb-2">
            <span className="logo-badge">Harvey level intelligence</span>
          </div>
          <h1 className="text-3xl font-light tracking-tight text-theme-primary leading-none">
            Cognitive Dossiers // <strong className="text-color-gold font-medium">Judicial Profiles</strong>
          </h1>
          <p className="text-xs text-secondary mt-2 tracking-wide">
            Profiling qualitativo e estatística de decisões de magistrados (TJPB/CNJ) processados cognitivamente por IA.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Pesquisar por juiz, comarca..."
            className="donna-input w-64 text-xs"
          />
          <button 
            className="donna-btn text-xs tracking-wider" 
            onClick={() => setNovoAtorForm(!novoAtorForm)}
          >
            {novoAtorForm ? "Fechar Cadastro" : "＋ Cadastrar Magistrado"}
          </button>
        </div>
      </div>

      {/* FORMULÁRIO DE CADASTRO */}
      {novoAtorForm && (
        <form onSubmit={cadastrarAtor} className="glass-card space-y-4 max-w-2xl mx-auto">
          <h3 className="text-lg font-bold border-b pb-2 border-[var(--border-color)] text-theme-primary">Cadastrar Magistrado para Dossier</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Nome Completo</label>
              <input 
                type="text" 
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Dra. Patricia de Albuquerque" 
                className="donna-input text-xs" 
                required
              />
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Cargo / Função</label>
              <select 
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="donna-input text-xs"
              >
                <option value="juiz">Juiz de Direito</option>
                <option value="desembargador">Desembargador</option>
                <option value="ministro">Ministro</option>
              </select>
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Tribunal</label>
              <input 
                type="text" 
                value={tribunal}
                onChange={(e) => setTribunal(e.target.value)}
                placeholder="Ex: TJPB" 
                className="donna-input text-xs"
                required
              />
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Comarca</label>
              <input 
                type="text" 
                value={comarca}
                onChange={(e) => setComarca(e.target.value)}
                className="donna-input text-xs"
              />
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Vara ou Secretaria</label>
              <input 
                type="text" 
                value={vara}
                onChange={(e) => setVara(e.target.value)}
                placeholder="Ex: 2ª Vara Cível" 
                className="donna-input text-xs"
              />
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Perfil Prévio Estimado</label>
              <select 
                value={perfil}
                onChange={(e) => setPerfil(e.target.value)}
                className="donna-input text-xs"
              >
                <option value="legalista">Legalista (Apego formal à lei)</option>
                <option value="garantista">Garantista (Direitos e garantias fundamentais)</option>
                <option value="pragmatico">Pragmático (Resolução de conflitos e economia)</option>
              </select>
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Temperamento Prévio</label>
              <select 
                value={temperamento}
                onChange={(e) => setTemperamento(e.target.value)}
                className="donna-input text-xs"
              >
                <option value="rigido">Rígido (Exigente e severo)</option>
                <option value="flexivel">Flexível (Aberto e tolerante)</option>
                <option value="imprevisivel">Imprevisível</option>
                <option value="colaborativo">Colaborativo</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xxs text-muted font-bold block mb-1">Notas de Orientação de Petição</label>
            <textarea 
              value={preferencia}
              onChange={(e) => setPreferencia(e.target.value)}
              placeholder="Ex: Rejeita ementas repetitivas, prefere artigos marcados..." 
              className="donna-input h-20 text-xs"
            />
          </div>
          <button type="submit" className="donna-btn text-xs">Salvar no Banco Estratégico</button>
        </form>
      )}

      {/* LOADING */}
      {loading ? (
        <div className="text-center py-12 text-secondary font-mono text-xs">
          [Carregando inteligência de magistrados...]
        </div>
      ) : atores.length === 0 ? (
        <div className="text-center py-12 text-secondary font-mono text-xs">
          Nenhum dossiê de magistrado localizado. Cadastre um novo acima.
        </div>
      ) : (
        /* GRID DE DOSSIÊS */
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {atores.map((ator) => {
            const analytics = analyticsMap[ator.id] || { timeline: [], estatisticas: { total: 0 } };
            const stats = analytics.estatisticas;
            const timeline = analytics.timeline;

            return (
              <div key={ator.id} className="glass-card flex flex-col justify-between space-y-6">
                <div>
                  {/* Cabeçalho do Card */}
                  <div className="flex items-start justify-between border-b border-[var(--border-color)] pb-4 mb-4">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-lg font-bold text-theme-primary">{ator.nome}</h3>
                        {ator.sync_pending === 1 && (
                          <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono">
                            PENDENTE
                          </span>
                        )}
                      </div>
                      <p className="text-xxs text-accent-cyan font-bold tracking-wider uppercase font-mono">
                        {ator.cargo_atual || "Magistrado"} • {ator.tribunal}
                      </p>
                      <p className="text-xxs text-muted font-mono">{ator.vara || "Secretaria Plena"} ({ator.comarca || "Geral"})</p>
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <span className="logo-badge uppercase text-[9px]">{ator.tipo}</span>
                      {renderStars(ator.grau_confianca_perfil)}
                    </div>
                  </div>

                  {/* Informações Funcionais / Contatos */}
                  <div className="grid grid-cols-2 gap-4 text-xs text-secondary bg-[var(--bg-primary)] p-3 rounded border border-[var(--border-color)] mb-4">
                    <p><strong>E-mail:</strong> {ator.email_gabinete || "Não coletado"}</p>
                    <p><strong>Telefone:</strong> {ator.telefone_gabinete || "Não coletado"}</p>
                    <p className="col-span-2"><strong>Atendimento:</strong> {ator.horario_atendimento || "Horário do tribunal"}</p>
                  </div>

                  {/* Estatísticas Decisórias (SVG Conic Gradient ou Progress Bars) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center mb-6">
                    {/* Gráfico de Pizza SVG/CSS */}
                    <div className="flex flex-col items-center justify-center p-3 bg-[var(--bg-primary)] rounded border border-[var(--border-color)]">
                      <span className="text-xxs font-bold text-muted uppercase tracking-wider mb-3">Distribuição de Resultados:</span>
                      {stats.total > 0 ? (
                        <div className="flex items-center space-x-4">
                          <div 
                            className="w-20 h-20 rounded-full border border-[var(--border-color)]"
                            style={{
                              background: `conic-gradient(
                                #10b981 0% ${stats.procedente_pct}%, 
                                #f59e0b ${stats.procedente_pct}% ${stats.procedente_pct + stats.parcial_pct}%, 
                                #ef4444 ${stats.procedente_pct + stats.parcial_pct}% ${stats.procedente_pct + stats.parcial_pct + stats.improcedente_pct}%, 
                                #64748b ${stats.procedente_pct + stats.parcial_pct + stats.improcedente_pct}% 100%
                              )`
                            }}
                          />
                          <div className="text-xxs space-y-1 text-secondary">
                            <p className="flex items-center space-x-1.5">
                              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block" />
                              <span>Procedente: <strong>{stats.procedente_pct}%</strong></span>
                            </p>
                            <p className="flex items-center space-x-1.5">
                              <span className="w-2.5 h-2.5 bg-amber-500 rounded-full inline-block" />
                              <span>Parcial: <strong>{stats.parcial_pct}%</strong></span>
                            </p>
                            <p className="flex items-center space-x-1.5">
                              <span className="w-2.5 h-2.5 bg-rose-500 rounded-full inline-block" />
                              <span>Improcedente: <strong>{stats.improcedente_pct}%</strong></span>
                            </p>
                            <p className="flex items-center space-x-1.5">
                              <span className="w-2.5 h-2.5 bg-slate-500 rounded-full inline-block" />
                              <span>Outro: <strong>{stats.outro_pct}%</strong></span>
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="text-muted text-xxs italic py-6">[Sem dados estatísticos. Inicie a Ingestão]</div>
                      )}
                      <span className="text-[10px] text-muted mt-2 font-mono">{stats.total} decisões coletadas</span>
                    </div>

                    {/* Métricas Cognitivas */}
                    <div className="space-y-3.5">
                      <span className="text-xxs font-bold text-muted uppercase tracking-wider block">Métricas Comportamentais Estimadas:</span>
                      
                      <div className="cognitive-meter-container">
                        <div className="cognitive-meter-header">
                          <span>Tendência {ator.perfil_decisorio ? ator.perfil_decisorio.toUpperCase() : "LEGALISTA"}</span>
                          <span className="font-mono text-accent-cyan">
                            {ator.perfil_decisorio === "legalista" ? "85%" : ator.perfil_decisorio === "garantista" ? "80%" : "75%"}
                          </span>
                        </div>
                        <div className="cognitive-meter-track">
                          <div 
                            className="cognitive-meter-bar" 
                            style={{ width: ator.perfil_decisorio === "legalista" ? "85%" : ator.perfil_decisorio === "garantista" ? "80%" : "75%" }} 
                          />
                        </div>
                      </div>

                      <div className="cognitive-meter-container">
                        <div className="cognitive-meter-header">
                          <span>Temperamento {ator.temperamento ? ator.temperamento.toUpperCase() : "RÍGIDO"}</span>
                          <span className="font-mono text-accent-cyan">
                            {ator.temperamento === "rigido" ? "90%" : ator.temperamento === "flexivel" ? "40%" : "60%"}
                          </span>
                        </div>
                        <div className="cognitive-meter-track">
                          <div 
                            className="cognitive-meter-bar" 
                            style={{ width: ator.temperamento === "rigido" ? "90%" : ator.temperamento === "flexivel" ? "40%" : "60%" }} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Estilo em Audiência e Preferências */}
                  <div className="text-xs text-secondary leading-relaxed bg-[var(--bg-primary)] p-3 rounded border border-[var(--border-color)] border-l-2 border-color-gold space-y-2 mb-4">
                    <p><strong>Estilo em Audiência:</strong> {ator.estilo_audiencia || "Aguardando processamento qualitativo do perfil."}</p>
                    <p><strong>Diretriz de Escrita (Preferências):</strong> {ator.preferencias_processuais || "Nenhuma dica de escrita cadastrada para este magistrado."}</p>
                  </div>

                  {/* Linha do Tempo (Consistency Timeline) */}
                  {timeline.length > 0 && (
                    <div className="bg-[var(--bg-primary)] p-3 rounded border border-[var(--border-color)] mb-4">
                      <span className="text-xxs font-bold text-muted uppercase tracking-wider block mb-2">Timeline de Consistência Cognitiva:</span>
                      <div className="relative border-l border-gray-700 pl-4 ml-2 space-y-3.5 py-1">
                        {timeline.map((item, idx) => (
                          <div key={idx} className="relative text-xxs text-secondary">
                            <span className="absolute -left-[21.5px] top-1.5 w-2 h-2 rounded-full bg-accent-cyan border border-[var(--bg-primary)]" />
                            <div className="flex justify-between font-mono text-muted text-[10px] mb-0.5">
                              <span>Análise #{idx + 1}</span>
                              <span>{item.data_registro}</span>
                            </div>
                            <p>
                              Classificado como <strong className="text-theme-primary uppercase">{item.perfil_decisorio}</strong> ({item.temperamento}) 
                              com base em <strong>{item.decisoes_analisadas} decisões</strong>.
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Prós e Contras */}
                  {ator.pontos_positivos?.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 text-xxs leading-relaxed">
                      <div className="p-2.5 bg-emerald-950/10 border border-emerald-900/25 rounded text-accent-emerald">
                        <strong>Pontos Fortes:</strong>
                        <ul className="list-disc pl-3 mt-1 space-y-1">
                          {ator.pontos_positivos.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                      <div className="p-2.5 bg-rose-950/10 border border-rose-900/25 rounded text-accent-rose">
                        <strong>Pontos de Atenção:</strong>
                        <ul className="list-disc pl-3 mt-1 space-y-1">
                          {ator.pontos_atencao.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>

                {/* Botões de Ação para Ingestão e Mapeamento de Perfil */}
                <div className="flex items-center space-x-3 pt-4 border-t border-[var(--border-color)]">
                  <button 
                    onClick={() => handleIngest(ator.id)}
                    disabled={ingestingMap[ator.id] || profilingMap[ator.id]}
                    className="donna-btn text-xxs tracking-wider bg-slate-800 hover:bg-slate-700 text-theme-primary flex-1"
                  >
                    {ingestingMap[ator.id] ? "Coletando Decisões..." : "📥 Ingestão DJe/TJPB"}
                  </button>
                  <button 
                    onClick={() => handleProfile(ator.id)}
                    disabled={profilingMap[ator.id] || ingestingMap[ator.id] || stats.total < 10}
                    className="donna-btn text-xxs tracking-wider bg-accent-cyan/20 border border-accent-cyan/35 text-accent-cyan hover:bg-accent-cyan/30 flex-1 disabled:opacity-40"
                    title={stats.total < 10 ? "Requer no mínimo 10 decisões coletadas para perfilamento" : ""}
                  >
                    {profilingMap[ator.id] ? "Mapeando com Claude..." : "🧠 Mapear Perfil Cognitivo"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
