'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase, getSession } from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── Fetch autenticado base ────────────────────────────────────────────────────

/**
 * Fetch wrapper que injeta automaticamente o JWT da sessão Supabase.
 * Em caso de 401, força logout e redireciona para /login.
 */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = await getSession();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (response.status === 401) {
    // Token expirado — força logout
    await supabase.auth.signOut();
    window.location.href = '/login';
    throw new Error('Sessão expirada. Redirecionando para login...');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ── Tipos de resposta da API ──────────────────────────────────────────────────

export interface Prazo {
  id: string;
  cnj: string;
  tipo: string;
  dias: number;
  vencimento: string;
  responsavel: string;
  prioridade: 'urgente' | 'alta' | 'media' | 'baixa';
  status: 'aberto' | 'cumprido' | 'vencido';
  tribunal: string;
  comarca: string;
  motivo?: string;
}

export interface Processo {
  id: string;
  cnj: string;
  titulo: string;
  cliente: string;
  adverso: string;
  tribunal: string;
  comarca: string;
  vara: string;
  juiz: string;
  distribuicao: string;
  valor: string;
  fase: string;
  status: 'ativo' | 'arquivado' | 'suspenso';
  andamentoRecente: string;
  timeline?: Array<{ data: string; evento: string }>;
}

export interface DashboardStats {
  totalProcessosAtivos: number;
  totalPrazosAbertos: number;
  prazosUrgentes: number;
  proximaAudiencia: string | null;
  alertas: number;
}

// ── Hooks de dados com loading/error state ───────────────────────────────────

/**
 * Hook para buscar prazos ativos do usuário.
 * DT-05: substitui o useState hardcoded de `prazos` no dashboard.
 */
export function usePrazos() {
  const [prazos, setPrazos] = useState<Prazo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrazos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<Prazo[]>('/prazos?status=aberto&limit=20');
      setPrazos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar prazos');
      // Fallback gracioso: mantém array vazio (não quebra a UI)
      setPrazos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrazos(); }, [fetchPrazos]);

  return { prazos, loading, error, refetch: fetchPrazos };
}

/**
 * Hook para buscar processos ativos.
 * DT-05: substitui o `processosAtivosMock` hardcoded.
 */
export function useProcessos() {
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProcessos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<Processo[]>('/processos?status=ativo&limit=10');
      setProcessos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar processos');
      setProcessos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProcessos(); }, [fetchProcessos]);

  return { processos, loading, error, refetch: fetchProcessos };
}

/**
 * Hook para buscar métricas do dashboard (KPIs do topo).
 */
export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats>({
    totalProcessosAtivos: 0,
    totalPrazosAbertos: 0,
    prazosUrgentes: 0,
    proximaAudiencia: null,
    alertas: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<DashboardStats>('/processos/stats')
      .then(setStats)
      .catch(() => {
        // Silencioso — o dashboard ainda funciona sem os KPIs
      })
      .finally(() => setLoading(false));
  }, []);

  return { stats, loading };
}

/**
 * Atualiza um prazo (ex: marcar como cumprido).
 */
export async function updatePrazoStatus(prazoId: string, status: string): Promise<void> {
  await apiFetch(`/prazos/${prazoId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}
