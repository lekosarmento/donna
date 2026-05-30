"use client";

import { Geist, Geist_Mono } from "next/font/google";
import { useState, useEffect } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({ children }) {
  const [theme, setTheme] = useState("dark"); // Estado do tema (dark por padrão)

  // Carregar preferência salva do usuário ao montar
  useEffect(() => {
    const savedTheme = localStorage.getItem("donna-theme") || "dark";
    setTheme(savedTheme);
    if (savedTheme === "light") {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  }, []);

  // Alternar entre temas
  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("donna-theme", nextTheme);
    
    if (nextTheme === "light") {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  };

  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <title>Donna — Copiloto Jurídico Estratégico</title>
        <meta name="description" content="Inteligência operacional, cálculo de prazos CPC/CNJ, inteligência comportamental de juízes e RAG semântico." />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="min-h-full flex flex-col donna-theme">
        {/* Header e Barra de Navegação Premium */}
        <header className="glass-nav sticky top-0 z-50">
          <div className="nav-container max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="nav-logo flex items-center space-x-2.5">
              <svg className="w-5 h-5 text-color-gold" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="logo-text">Donna</span>
              <span className="logo-badge">Copiloto Estratégico</span>
            </div>
            
            <nav className="nav-links flex items-center space-x-6">
              <a href="/" className="nav-link">Dashboard</a>
              <a href="/donna" className="nav-link">Chat IA Tutor</a>
              <a href="/atores" className="nav-link">Juízes & Atores</a>
            </nav>

            <div className="nav-profile flex items-center space-x-4">
              {/* Botão de Alternância de Tema em SVG (Sun / Moon) */}
              <button 
                onClick={toggleTheme} 
                className="theme-toggle-btn"
                title={theme === "dark" ? "Ativar Modo Claro" : "Ativar Modo Escuro"}
              >
                {theme === "dark" ? (
                  // Ícone do Sol (Ativar Modo Claro)
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
                  </svg>
                ) : (
                  // Ícone da Lua (Ativar Modo Escuro)
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>

              <div className="flex items-center space-x-2">
                <div className="avatar">AD</div>
                <span className="profile-name hidden sm:inline">Dr. Advogado</span>
              </div>
            </div>
          </div>
        </header>

        {/* Conteúdo Principal */}
        <main className="flex-1 bg-gradient">
          <div className="max-w-7xl mx-auto px-6 py-8">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="glass-footer">
          <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between text-xs text-secondary">
            <span>© 2026 Donna Technologies Ltd. Confidencialidade e integridade garantidas.</span>
            <span>Regras CNJ: 16/05/2025 (DJEN)</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
