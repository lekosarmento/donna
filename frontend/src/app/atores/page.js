"use client";

import React, { useState } from "react";

export default function Atores() {
  const [atores, setAtores] = useState([
    {
      id: "1",
      nome: "Dr. João Carlos de Albuquerque",
      tipo: "juiz",
      cargo: "Juiz de Direito Titular",
      tribunal: "TJPB",
      comarca: "João Pessoa",
      vara: "2ª Vara Cível",
      telefone: "(83) 3216-1542",
      email: "gab.2civel.jp@tjpb.jus.br",
      atendimento: "13:00 às 17:00 (Melhor via e-mail direto)",
      perfil: "legalista",
      temperamento: "rigido",
      estiloAudiencia: "Pontualidade britânica, exige que as partes estejam prontas 15min antes. Não tolera apartes sem permissão.",
      preferencia: "Prefere petições curtas (máximo 5 páginas) com fundamentação literal da lei, sem excesso de doutrina ou jurisprudência.",
      pontosPositivos: ["Extremamente técnico", "Decide rápido tutela de urgência"],
      pontosAtencao: ["Rígido com prazos de emenda", "Indefere recursos com pequenos vícios formais"],
      meters: [
        { label: "Raciocínio Legalista", val: 85 },
        { label: "Rigidez Processual", val: 90 },
        { label: "Abertura a Acordos", val: 15 }
      ],
      interacoes: [
        { data: "15/05/2026", tipo: "Despacho oral", desc: "Despachada tutela de urgência no proc. 0001234-56. Fomos recebidos em 5min. Ele deferiu a liminar com base estrita no art. 300.", resultado: "Sucesso parcial (liminar concedida com caução)" },
        { data: "10/04/2026", tipo: "Audiência de Instrução", desc: "Muito pontual. Exigiu que as testemunhas fossem objetivas.", resultado: "Depoimentos tomados sem incidentes" }
      ]
    },
    {
      id: "2",
      nome: "Dra. Heloísa Maria Souza",
      tipo: "desembargadora",
      cargo: "Desembargadora Relatora",
      tribunal: "TJRN",
      comarca: "Tribunal de Justiça",
      vara: "3ª Câmara Cível",
      telefone: "(84) 3616-2030",
      email: "heloisa.souza@tjrn.jus.br",
      atendimento: "Terças e quintas pela manhã (Agendar com secretário)",
      perfil: "garantista",
      temperamento: "flexivel",
      estiloAudiencia: "Colaborativa, busca conciliação ativa e ouve os advogados com atenção durante sustentações orais.",
      preferencia: "Valoriza muito precedentes vinculantes do STJ/STF e petições bem estruturadas com tabelas de fatos versus provas.",
      pontosPositivos: ["Acessível para despacho presencial", "Sensibilidade para questões sociais"],
      pontosAtencao: ["Prazos de julgamento mais lentos devido à análise detalhada"],
      meters: [
        { label: "Raciocínio Garantista", val: 80 },
        { label: "Flexibilidade Prazos", val: 75 },
        { label: "Abertura a Acordos", val: 85 }
      ],
      interacoes: [
        { data: "02/05/2026", tipo: "Sustentação Oral", desc: "Apresentado agravo de instrumento. A Desembargadora fez perguntas técnicas pontuais sobre as provas e votou a favor do provimento.", resultado: "Recurso provido por unanimidade" }
      ]
    }
  ]);

  const [novoAtorForm, setNovoAtorForm] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("juiz");
  const [tribunal, setTribunal] = useState("");
  const [vara, setVara] = useState("");
  const [perfil, setPerfil] = useState("legalista");
  const [temperamento, setTemperamento] = useState("rigido");
  const [preferencia, setPreferencia] = useState("");

  const cadastrarAtor = (e) => {
    e.preventDefault();
    if (!nome || !tribunal) return alert("Por favor, preencha Nome e Tribunal!");

    const novo = {
      id: Date.now().toString(),
      nome,
      tipo,
      cargo: tipo === "juiz" ? "Juiz de Direito" : "Membro do Tribunal",
      tribunal,
      comarca: "Capital",
      vara,
      telefone: "(00) 0000-0000",
      email: "contato@tribunal.jus.br",
      atendimento: "Horário padrão de expediente",
      perfil,
      temperamento,
      estiloAudiencia: "Perfil cadastrado recentemente.",
      preferencia: preferencia || "Sem notas de preferências cadastradas.",
      pontosPositivos: ["Cadastrado recentemente"],
      pontosAtencao: ["Aguardando interações históricas"],
      meters: [
        { label: "Raciocínio Estimado", val: perfil === "legalista" ? 80 : 40 },
        { label: "Rigidez Estimada", val: temperamento === "rigido" ? 85 : 30 },
        { label: "Abertura a Acordos", val: 50 }
      ],
      interacoes: []
    };

    setAtores([novo, ...atores]);
    setNovoAtorForm(false);
    setNome("");
    setPreferencia("");
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
            Modelos de decisão e estatística comportamental confidencial para despachos e sustentações.
          </p>
        </div>
        <button 
          className="donna-btn text-xs tracking-wider" 
          onClick={() => setNovoAtorForm(!novoAtorForm)}
        >
          {novoAtorForm ? "Fechar Dossier" : "＋ Cadastrar Novo Dossier"}
        </button>
      </div>

      {/* FORMULÁRIO DE CADASTRO */}
      {novoAtorForm && (
        <form onSubmit={cadastrarAtor} className="glass-card space-y-4 max-w-2xl">
          <h3 className="text-lg font-bold border-b pb-2 border-[var(--border-color)] text-theme-primary">Criar Dossier Cognitivo</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Nome Completo</label>
              <input 
                type="text" 
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Dr. João da Silva" 
                className="donna-input" 
              />
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Função / Cargo</label>
              <select 
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="donna-input"
              >
                <option value="juiz">Juiz</option>
                <option value="desembargador">Desembargador</option>
                <option value="promotor">Promotor</option>
                <option value="servidor_cartorio">Servidor de Cartório</option>
              </select>
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Tribunal</label>
              <input 
                type="text" 
                value={tribunal}
                onChange={(e) => setTribunal(e.target.value)}
                placeholder="Ex: TJPB, TRT2" 
                className="donna-input" 
              />
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Vara / Comarca</label>
              <input 
                type="text" 
                value={vara}
                onChange={(e) => setVara(e.target.value)}
                placeholder="Ex: 3ª Vara do Trabalho" 
                className="donna-input" 
              />
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Perfil Decisório</label>
              <select 
                value={perfil}
                onChange={(e) => setPerfil(e.target.value)}
                className="donna-input"
              >
                <option value="legalista">Legalista (Apego à letra fria da lei)</option>
                <option value="garantista">Garantista (Foco nas garantias fundamentais)</option>
                <option value="pragmatico">Pragmático (Foco na resolução prática de conflitos)</option>
              </select>
            </div>
            <div>
              <label className="text-xxs text-muted font-bold block mb-1">Temperamento em Audiência</label>
              <select 
                value={temperamento}
                onChange={(e) => setTemperamento(e.target.value)}
                className="donna-input"
              >
                <option value="rigido">Rígido (Exigente e pontual)</option>
                <option value="flexivel">Flexível (Colaborativo e aberto)</option>
                <option value="imprevisivel">Imprevisível (Flutuante)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xxs text-muted font-bold block mb-1">Notas de Preferência (Dicas de Petição)</label>
            <textarea 
              value={preferencia}
              onChange={(e) => setPreferencia(e.target.value)}
              placeholder="Ex: Prefere petições sucintas, rejeita jurisprudência sem grifos..." 
              className="donna-input h-20"
            />
          </div>
          <button type="submit" className="donna-btn">Salvar no Banco Confidencial</button>
        </form>
      )}

      {/* GRID DE CARDS DE ATORES */}
      <div className="actor-grid">
        {atores.map((ator) => (
          <div key={ator.id} className="glass-card flex flex-col justify-between">
            <div>
              {/* Cabeçalho do Dossier */}
              <div className="actor-header flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-theme-primary">{ator.nome}</h3>
                  <p className="text-xxs text-accent-cyan font-bold tracking-wider uppercase font-mono">{ator.cargo} • {ator.tribunal}</p>
                  <p className="text-xxs text-muted font-mono">{ator.vara} ({ator.comarca})</p>
                </div>
                <span className="logo-badge">{ator.tipo}</span>
              </div>

              {/* Contatos */}
              <div className="space-y-1.5 text-xs text-secondary mb-5 bg-[var(--bg-primary)] p-3.5 rounded border border-[var(--border-color)]">
                <p className="flex items-center space-x-1.5">
                  <svg className="w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <strong>Tel:</strong> {ator.telefone}
                </p>
                <p className="flex items-center space-x-1.5">
                  <svg className="w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <strong>Email:</strong> {ator.email}
                </p>
                <p className="flex items-center space-x-1.5">
                  <svg className="w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <strong>Atendimento:</strong> {ator.atendimento}
                </p>
              </div>

              {/* Estatística Comportamental (Harvey Cognitive Meters) */}
              <div className="space-y-4">
                <div>
                  <span className="text-xxs font-bold text-muted uppercase tracking-wider block mb-2">Cognitive decision metrics:</span>
                  {ator.meters.map((m, idx) => (
                    <div key={idx} className="cognitive-meter-container">
                      <div className="cognitive-meter-header">
                        <span>{m.label}</span>
                        <span className="font-mono text-accent-cyan">{m.val}%</span>
                      </div>
                      <div className="cognitive-meter-track">
                        <div className="cognitive-meter-bar" style={{ width: `${m.val}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Perfil & Dicas */}
                <div className="text-xs text-secondary leading-relaxed bg-[var(--bg-primary)] p-3 rounded border border-[var(--border-color)] border-l-2 border-color-gold">
                  <p className="mb-2"><strong>Estilo em Audiência:</strong> {ator.estiloAudiencia}</p>
                  <p><strong>Diretriz de Escrita:</strong> {ator.preferencia}</p>
                </div>

                {/* Prós e Contras */}
                <div className="grid grid-cols-2 gap-2 text-xxs leading-relaxed">
                  <div className="p-2.5 bg-emerald-950/10 border border-emerald-900/25 rounded text-accent-emerald">
                    <strong>Pontos Fortes:</strong>
                    <ul className="list-disc pl-3 mt-1 space-y-1">
                      {ator.pontosPositivos.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                  <div className="p-2.5 bg-rose-950/10 border border-rose-900/25 rounded text-accent-rose">
                    <strong>Pontos de Atenção:</strong>
                    <ul className="list-disc pl-3 mt-1 space-y-1">
                      {ator.pontosAtencao.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Histórico de Interações */}
            {ator.interacoes.length > 0 && (
              <div className="mt-5 pt-4 border-t border-[var(--border-color)]">
                <span className="text-xxs font-bold text-muted uppercase tracking-wider block mb-2">Histórico de Confrontos ({ator.interacoes.length}):</span>
                <div className="space-y-2 text-xxs text-secondary">
                  {ator.interacoes.map((item, idx) => (
                    <div key={idx} className="bg-[var(--bg-primary)] p-2.5 rounded border border-[var(--border-color)]">
                      <div className="flex items-center justify-between mb-1">
                        <strong className="text-theme-primary">{item.tipo}</strong>
                        <span className="text-muted font-mono">{item.data}</span>
                      </div>
                      <p className="italic mb-1 text-muted">"{item.desc}"</p>
                      <p className="text-accent-emerald font-bold">→ Resultado: {item.resultado}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
