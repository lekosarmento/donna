'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, getSession, signOut as sbSignOut } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  accessToken: string | null;
}

/**
 * DT-06 — Hook de autenticação global.
 *
 * Gerencia sessão Supabase e redireciona automaticamente para /login
 * quando o usuário não está autenticado.
 *
 * Uso:
 *   const { user, accessToken, signOut } = useAuth();
 *   // usar accessToken no header Authorization: Bearer <token>
 */
export function useAuth(redirectIfUnauthenticated = true): AuthState & { signOut: () => Promise<void> } {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    accessToken: null,
  });

  useEffect(() => {
    // Verificar sessão inicial ao montar o componente
    getSession().then((session) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
        accessToken: session?.access_token ?? null,
      });

      if (!session && redirectIfUnauthenticated) {
        router.push('/login');
      }
    });

    // Listener para mudanças de sessão (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, realSession) => {
      // Como o onAuthStateChange retorna a sessão real (que é nula no dev bypass), re-checamos o wrapper
      const session = await getSession();
      
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
        accessToken: session?.access_token ?? null,
      });

      if (!session && redirectIfUnauthenticated) {
        router.push('/login');
      }
    });

    return () => subscription.unsubscribe();
  }, [router, redirectIfUnauthenticated]);

  const signOut = useCallback(async () => {
    await sbSignOut();
    router.push('/login');
  }, [router]);

  return { ...state, signOut };
}

/**
 * Retorna os headers de autenticação para fetch à API backend.
 * Uso: fetch(url, { headers: await getAuthHeaders() })
 */
export async function getAuthHeaders(): Promise<HeadersInit> {
  const session = await getSession();
  if (!session?.access_token) return {};
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}
