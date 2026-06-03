import { createClient } from '@supabase/supabase-js';

// DT-06: usar NEXT_PUBLIC_ para variáveis expostas ao browser (obrigatório Next.js)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton — reutilizado em toda a aplicação
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Helpers de Autenticação ──────────────────────────────────────────────────

// Sessão falsa para desenvolvimento local, armazenada na memória (ou localStorage se quiser persistir entre abas no dev)
function setFakeDevSession() {
  if (typeof window !== 'undefined') {
    localStorage.setItem('donna_dev_session', JSON.stringify({
      access_token: 'donna_dev_bypass_token',
      user: { id: 'admin-dev-user', email: 'admin@donna.com.br' }
    }));
  }
}

function getFakeDevSession() {
  if (typeof window !== 'undefined') {
    const s = localStorage.getItem('donna_dev_session');
    if (s) return JSON.parse(s);
  }
  return null;
}

/** Retorna sessão + usuário correntes (null se não autenticado) */
export async function getSession() {
  const devSession = getFakeDevSession();
  if (devSession) return devSession;

  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/** Retorna o usuário atual ou null */
export async function getUser() {
  const devSession = getFakeDevSession();
  if (devSession) return devSession.user;

  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Login com email + senha */
export async function signInWithEmail(email: string, password: string) {
  // DEV BYPASS: Se for o email admin, aceita qualquer senha localmente
  if (process.env.NODE_ENV !== 'production' && email === 'admin@donna.com.br') {
    setFakeDevSession();
    // Simula evento de mudança de auth para o useAuth disparar
    setTimeout(() => {
      window.dispatchEvent(new Event('storage'));
      // Simular onAuthStateChange recarregando a pág
      window.location.href = '/';
    }, 500);
    return { error: null, data: { user: getFakeDevSession().user } };
  }

  return supabase.auth.signInWithPassword({ email, password });
}

/** Logout */
export async function signOut() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('donna_dev_session');
  }
  return supabase.auth.signOut();
}
