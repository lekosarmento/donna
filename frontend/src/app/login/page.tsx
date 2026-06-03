'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmail, supabase } from '../../lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Se já está autenticado, redireciona direto para o dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/');
    });
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: authError } = await signInWithEmail(email, password);

    if (authError) {
      setLoading(false);
      // Mensagens amigáveis em português
      if (authError.message.includes('Invalid login credentials')) {
        setError('Email ou senha incorretos. Verifique suas credenciais.');
      } else if (authError.message.includes('Email not confirmed')) {
        setError('Confirme seu email antes de fazer login. Verifique sua caixa de entrada.');
      } else {
        setError('Falha ao conectar. Tente novamente em instantes.');
      }
      return;
    }

    // Sucesso — redireciona para o dashboard
    router.push('/');
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 20% 50%, hsl(220,60%,8%) 0%, hsl(240,40%,4%) 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      padding: '1rem',
    }}>
      {/* Partículas decorativas de fundo */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', top: '20%', left: '10%', width: 300, height: 300,
          background: 'radial-gradient(circle, hsla(220,80%,60%,0.08) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', bottom: '20%', right: '10%', width: 250, height: 250,
          background: 'radial-gradient(circle, hsla(260,70%,60%,0.06) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
      </div>

      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        padding: '2.5rem 2rem',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
        position: 'relative',
        zIndex: 1,
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14,
            background: 'linear-gradient(135deg, hsl(220,80%,55%) 0%, hsl(250,80%,65%) 100%)',
            marginBottom: '0.75rem',
            boxShadow: '0 8px 24px hsla(220,80%,55%,0.3)',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 style={{
            fontSize: '1.5rem', fontWeight: 700, margin: 0,
            background: 'linear-gradient(135deg, #fff 0%, hsl(220,40%,80%) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.02em',
          }}>
            Donna
          </h1>
          <p style={{ color: 'hsl(220,15%,55%)', fontSize: '0.8rem', margin: '0.25rem 0 0', letterSpacing: '0.08em' }}>
            COPILOTO JURÍDICO ESTRATÉGICO
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Mensagem de erro */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 10, padding: '0.75rem 1rem',
              color: 'hsl(0,85%,75%)', fontSize: '0.85rem', lineHeight: 1.4,
              display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
            }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠</span>
              {error}
            </div>
          )}

          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ color: 'hsl(220,15%,65%)', fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.04em' }}>
              EMAIL PROFISSIONAL
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@escritorio.com.br"
              required
              autoComplete="email"
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: '0.75rem 1rem',
                color: '#fff', fontSize: '0.95rem', outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = 'hsla(220,80%,60%,0.5)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
          </div>

          {/* Senha */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ color: 'hsl(220,15%,65%)', fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.04em' }}>
              SENHA
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, padding: '0.75rem 2.75rem 0.75rem 1rem',
                  color: '#fff', fontSize: '0.95rem', outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = 'hsla(220,80%,60%,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'hsl(220,15%,55%)', fontSize: '1rem', padding: '0.25rem',
                }}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {/* Botão de login */}
          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.5rem',
              background: loading
                ? 'rgba(255,255,255,0.08)'
                : 'linear-gradient(135deg, hsl(220,80%,55%) 0%, hsl(250,80%,65%) 100%)',
              border: 'none', borderRadius: 10, padding: '0.85rem',
              color: loading ? 'hsl(220,15%,55%)' : '#fff',
              fontSize: '0.95rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s', letterSpacing: '0.02em',
              boxShadow: loading ? 'none' : '0 4px 20px hsla(220,80%,55%,0.3)',
            }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <span style={{
                  width: 16, height: 16, border: '2px solid rgba(255,255,255,0.2)',
                  borderTopColor: 'rgba(255,255,255,0.7)', borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 0.8s linear infinite',
                }} />
                Entrando...
              </span>
            ) : 'Entrar no Sistema'}
          </button>
        </form>

        {/* Footer */}
        <div style={{ marginTop: '1.75rem', textAlign: 'center' }}>
          <p style={{ color: 'hsl(220,15%,40%)', fontSize: '0.75rem', lineHeight: 1.5 }}>
            Acesso restrito a advogados cadastrados.<br/>
            Problemas? Contate o administrador do escritório.
          </p>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        input::placeholder { color: hsl(220,15%,35%); }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}
