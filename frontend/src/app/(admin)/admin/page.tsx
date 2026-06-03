"use client";

import React, { useState, useEffect } from "react";

interface Escritorio {
  id: string;
  nome: string;
  cnpj: string | null;
  oab_seccional: string | null;
  endereco: string | null;
  ativo: number;
  plano_id: string | null;
  assinatura_status: string | null;
  total_usuarios: number;
  ultima_atividade: string | null;
}

interface Metricas {
  queries_dia: { data: string; total: number }[];
  tokens_mes: number;
  processos_monitorados: number;
}

interface Alerta {
  tipo: string;
  nivel: "warn" | "error";
  mensagem: string;
}

export default function AdminDashboard() {
  const [escritorios, setEscritorios] = useState<Escritorio[]>([]);
  const [metricas, setMetricas] = useState<Metricas>({
    queries_dia: [],
    tokens_mes: 0,
    processos_monitorados: 0
  });
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Carrega os dados estatísticos
  const carregarPainel = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch("http://localhost:3000/api/admin/summary", {
        headers: {
          "x-user-role": "admin", // Bypass/Simula papel de superadmin
          "x-user-id": "superadmin-local-id"
        }
      });

      if (!response.ok) {
        throw new Error("Não foi possível carregar as informações do painel administrativo.");
      }

      const data = await response.json();
      setEscritorios(data.escritorios || []);
      setMetricas(data.metricas || { queries_dia: [], tokens_mes: 0, processos_monitorados: 0 });
      setAlertas(data.alertas || []);
    } catch (err: any) {
      setError(err.message || "Erro desconhecido ao carregar painel.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarPainel();
  }, []);

  // Altera o status do escritório (Suspender/Reativar)
  const toggleStatusEscritorio = async (id: string, currentStatus: string | null) => {
    const targetStatus = currentStatus === "active" ? "suspended" : "active";
    
    try {
      setActionSuccessMsg(null);
      const response = await fetch(`http://localhost:3000/api/admin/escritorios/${id}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": "admin"
        },
        body: JSON.stringify({ status: targetStatus })
      });

      if (response.ok) {
        setActionSuccessMsg(`Assinatura do escritório alterada para ${targetStatus === "active" ? "Ativa" : "Suspensa"}.`);
        carregarPainel();
        setTimeout(() => setActionSuccessMsg(null), 3000);
      } else {
        const errData = await response.json();
        setError(errData.error || "Falha ao alterar status do escritório.");
      }
    } catch (err: any) {
      setError(`Erro ao alterar status: ${err.message}`);
    }
  };

  // Força rotação de certificado digital
  const rotacionarCertificado = async (id: string) => {
    const confirmacao = window.confirm("Deseja realmente rotacionar o certificado digital deste escritório? Isso removerá as chaves ativas do cofre e exigirá um novo upload.");
    if (!confirmacao) return;

    try {
      setActionSuccessMsg(null);
      const response = await fetch(`http://localhost:3000/api/admin/escritorios/${id}/rotate-cert`, {
        method: "POST",
        headers: {
          "x-user-role": "admin"
        }
      });

      if (response.ok) {
        setActionSuccessMsg("Certificado rotacionado com sucesso. Chaves e memórias limpas.");
        carregarPainel();
        setTimeout(() => setActionSuccessMsg(null), 3000);
      } else {
        const errData = await response.json();
        setError(errData.error || "Falha ao rotacionar certificado.");
      }
    } catch (err: any) {
      setError(`Erro na rotação: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient text-slate-100 p-8">
      {/* Cabeçalho do Painel */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center border-b border-[rgba(212,175,55,0.15)] pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="logo-text supreme-font text-2xl font-black">DONNA</h1>
            <span className="logo-badge">ADMIN CONTROL</span>
          </div>
          <p className="text-xs text-slate-400">
            Painel Central do Superadmin - Monitoramento de Queries PJe, Assinaturas e Compliance LGPD/Certificados.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={carregarPainel}
            disabled={loading}
            className="px-4 py-2 border border-slate-700 hover:border-amber-500/50 hover:bg-slate-900 active:scale-95 transition-all text-xs rounded font-bold uppercase tracking-wider flex items-center gap-2"
          >
            {loading ? "🔄 Sincronizando..." : "🔄 Atualizar Dados"}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-8">
        {/* Notificações e Sucessos de Ações */}
        {error && (
          <div className="p-4 bg-rose-950/60 border border-rose-800 text-rose-300 text-xs rounded-lg flex justify-between items-center shadow-lg">
            <span><strong>Erro Operacional:</strong> {error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200">Fechar</button>
          </div>
        )}
        {actionSuccessMsg && (
          <div className="p-4 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs rounded-lg flex justify-between items-center shadow-lg animate-pulse">
            <span><strong>Sucesso:</strong> {actionSuccessMsg}</span>
            <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200">Fechar</button>
          </div>
        )}

        {/* Grid de Cards de Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-card bg-slate-950/70 border border-slate-900 p-6 rounded-lg shadow-lg flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Processos Monitorados</span>
            <div className="my-4">
              <span className="text-3xl font-black text-amber-500 supreme-font">
                {metricas.processos_monitorados}
              </span>
              <p className="text-[11px] text-slate-400 mt-1">Total de processos sincronizados e vigentes na base.</p>
            </div>
            <div className="text-[10px] text-slate-500 border-t border-slate-900 pt-2 flex justify-between">
              <span>Sincronismo: Online</span>
              <span className="text-emerald-400">● Operacional</span>
            </div>
          </div>

          <div className="glass-card bg-slate-950/70 border border-slate-900 p-6 rounded-lg shadow-lg flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tokens Consumidos / Mês</span>
            <div className="my-4">
              <span className="text-3xl font-black text-cyan-400">
                {metricas.tokens_mes.toLocaleString("pt-BR")}
              </span>
              <p className="text-[11px] text-slate-400 mt-1">Uso de LLM (Claude/OpenAI) na triagem e chat de playbooks.</p>
            </div>
            <div className="text-[10px] text-slate-500 border-t border-slate-900 pt-2 flex justify-between">
              <span>Custo Estimado: R$ {((metricas.tokens_mes / 1000) * 0.08).toFixed(2)}</span>
              <span className="text-cyan-400">● Dentro da margem</span>
            </div>
          </div>

          <div className="glass-card bg-slate-950/70 border border-slate-900 p-6 rounded-lg shadow-lg flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Alertas e Compliance</span>
            <div className="my-4">
              <span className={`text-3xl font-black ${alertas.length > 0 ? "text-rose-500" : "text-emerald-400"}`}>
                {alertas.length}
              </span>
              <p className="text-[11px] text-slate-400 mt-1">Problemas críticos, expiração de certificados ou drifts do sync.</p>
            </div>
            <div className="text-[10px] text-slate-500 border-t border-slate-900 pt-2 flex justify-between">
              <span>Pendências: {alertas.filter(a => a.nivel === "error").length} Críticas</span>
              <span className={alertas.length > 0 ? "text-rose-500 animate-pulse" : "text-emerald-400"}>● Status Geral</span>
            </div>
          </div>
        </div>

        {/* Alertas Ativos e Gráfico de Atividade PJe */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Caixa de Alertas Ativos */}
          <div className="glass-card bg-slate-950/70 border border-slate-900 p-6 rounded-lg shadow-lg lg:col-span-1">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-900 pb-3 mb-4">
              Alertas de Conformidade e Conectividade
            </h2>
            <div className="space-y-4 max-h-60 overflow-y-auto pr-2">
              {alertas.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  ✅ Nenhum problema de conformidade ou conexão detectado.
                </div>
              ) : (
                alertas.map((alerta, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded border text-[11px] leading-relaxed flex gap-2 ${
                      alerta.nivel === "error"
                        ? "bg-rose-950/30 border-rose-900/50 text-rose-300"
                        : "bg-amber-950/30 border-amber-900/50 text-amber-300"
                    }`}
                  >
                    <span>{alerta.nivel === "error" ? "🚨" : "⚠️"}</span>
                    <div>{alerta.mensagem}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Gráfico de Atividade PJe (SVG) */}
          <div className="glass-card bg-slate-950/70 border border-slate-900 p-6 rounded-lg shadow-lg lg:col-span-2">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-900 pb-3 mb-4">
              Volume de Consultas ao Barramento PJe (Últimos 7 dias)
            </h2>
            {metricas.queries_dia.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-xs">
                Nenhum log de consulta disponível para compilar o gráfico.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Renderização de gráfico SVG limpo de alta fidelidade */}
                <div className="w-full h-44 flex items-end justify-between px-4 pb-2 border-b border-slate-900 pt-4">
                  {metricas.queries_dia.map((q, idx) => {
                    const maxVal = Math.max(...metricas.queries_dia.map(d => d.total), 1);
                    const pctHeight = (q.total / maxVal) * 80; // max 80% height
                    return (
                      <div key={idx} className="flex flex-col items-center group relative w-1/8">
                        {/* Tooltip de valor */}
                        <div className="absolute bottom-full mb-2 bg-slate-900 border border-slate-800 text-[10px] text-amber-400 px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                          {q.total} queries
                        </div>
                        {/* Barra */}
                        <div
                          className="w-8 bg-gradient-to-t from-amber-500/20 to-amber-500 hover:to-amber-400 rounded-t transition-all duration-500 cursor-pointer"
                          style={{ height: `${Math.max(pctHeight, 10)}%` }}
                        />
                        <span className="text-[9px] text-slate-500 mt-2 rotate-12 md:rotate-0">
                          {new Date(q.data).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tabela de Escritórios Ativos */}
        <div className="glass-card bg-slate-950/70 border border-slate-900 p-6 rounded-lg shadow-lg">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-900 pb-3 mb-6">
            Escritórios Pilotos Monitorados
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-900 text-slate-500 font-bold uppercase tracking-widest text-[10px]">
                  <th className="py-3 px-4">Razão Social / Identificador</th>
                  <th className="py-3 px-4">OAB Seccional / CNPJ</th>
                  <th className="py-3 px-4">Plano / Status</th>
                  <th className="py-3 px-4">Advogados</th>
                  <th className="py-3 px-4">Última Atividade</th>
                  <th className="py-3 px-4 text-right">Ações de Compliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-950">
                {escritorios.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-500">
                      Nenhum escritório cadastrado no sistema.
                    </td>
                  </tr>
                ) : (
                  escritorios.map((esc) => (
                    <tr key={esc.id} className="hover:bg-slate-900/30 transition-colors">
                      <td className="py-4 px-4 font-bold text-slate-100">
                        <div>{esc.nome}</div>
                        <span className="text-[9px] font-mono text-slate-500">{esc.id}</span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-slate-300">OAB/{esc.oab_seccional || "N/A"}</div>
                        <span className="text-[10px] text-slate-500">{esc.cnpj || "Sem CNPJ"}</span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                            esc.plano_id === "starter"
                              ? "bg-blue-950 text-blue-300 border border-blue-900"
                              : esc.plano_id === "professional"
                              ? "bg-amber-950 text-amber-300 border border-amber-900"
                              : "bg-purple-950 text-purple-300 border border-purple-900"
                          }`}>
                            {esc.plano_id || "N/A"}
                          </span>
                          <span className={`w-2 h-2 rounded-full ${
                            esc.assinatura_status === "active" ? "bg-emerald-500" : "bg-rose-500"
                          }`} />
                          <span className="text-[10px] text-slate-400 capitalize">{esc.assinatura_status || "N/A"}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 font-bold text-slate-300">{esc.total_usuarios} advogados</td>
                      <td className="py-4 px-4 text-slate-400">
                        {esc.ultima_atividade
                          ? new Date(esc.ultima_atividade).toLocaleDateString("pt-BR", {
                              day: "numeric",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit"
                            })
                          : "Nenhuma atividade registrada"}
                      </td>
                      <td className="py-4 px-4 text-right space-x-2">
                        <button
                          onClick={() => toggleStatusEscritorio(esc.id, esc.assinatura_status)}
                          className={`px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-all duration-300 border ${
                            esc.assinatura_status === "active"
                              ? "border-rose-900 text-rose-400 hover:bg-rose-950/20"
                              : "border-emerald-900 text-emerald-400 hover:bg-emerald-950/20"
                          }`}
                        >
                          {esc.assinatura_status === "active" ? "🔑 Suspender" : "🔑 Reativar"}
                        </button>
                        <button
                          onClick={() => rotacionarCertificado(esc.id)}
                          className="px-3 py-1.5 border border-slate-800 hover:border-amber-500/50 text-[10px] text-slate-400 hover:text-amber-400 font-bold uppercase tracking-wider rounded transition-all duration-300"
                        >
                          🔄 Rotacionar Cert
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
