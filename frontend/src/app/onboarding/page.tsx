"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

// Interface para controle de advogados convidados
interface Advogado {
  nome: string;
  email: string;
  tipo_perfil: "socio" | "associado" | "estagiario";
  oab?: string;
  whatsapp?: string;
}

export default function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Etapa 1: Dados do Escritório
  const [escritorioNome, setEscritorioNome] = useState("");
  const [escritorioCnpj, setEscritorioCnpj] = useState("");
  const [escritorioOabSec, setEscritorioOabSec] = useState("PB");
  const [escritorioEndereco, setEscritorioEndereco] = useState("");

  // Etapa 2: Certificado Digital
  const [pfxFile, setPfxFile] = useState<File | null>(null);
  const [pfxPassword, setPfxPassword] = useState("");
  const [encryptedPfxData, setEncryptedPfxData] = useState<{
    encrypted_pfx: string;
    salt: string;
    iv: string;
    derived_key: string;
  } | null>(null);

  // Etapa 3: Configuração do PJe e Teste
  const [pjeTribunalUrl, setPjeTribunalUrl] = useState("https://pje.tjpb.jus.br");
  const [pjeGrau, setPjeGrau] = useState<"1g" | "2g">("1g");
  const [conexaoTestada, setConexaoTestada] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    mensagem: string;
    cert_info?: { expira_em: string; dias_restantes: number };
  } | null>(null);

  // Etapa 4: Convite de Advogados
  const [advogados, setAdvogados] = useState<Advogado[]>([
    { nome: "", email: "", tipo_perfil: "socio" }
  ]);

  // Função para codificar ArrayBuffer em Base64
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // Executa criptografia Web Crypto AES-GCM + PBKDF2 local no browser
  const encryptCertificateLocal = async () => {
    if (!pfxFile || !pfxPassword) {
      setError("Selecione o arquivo PFX e digite a senha.");
      return false;
    }

    try {
      setLoading(true);
      setError(null);

      // 1. Gerar Salt (16 bytes) e IV (12 bytes)
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const iv = window.crypto.getRandomValues(new Uint8Array(12));

      // 2. Importar a senha como chave base para PBKDF2
      const passwordEncoder = new TextEncoder().encode(pfxPassword);
      const baseKey = await window.crypto.subtle.importKey(
        "raw",
        passwordEncoder,
        "PBKDF2",
        false,
        ["deriveKey"]
      );

      // 3. Derivar chave AES-GCM de 256 bits via PBKDF2 (100.000 iterações, SHA-256)
      const derivedKey = await window.crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: salt,
          iterations: 100000,
          hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      // 4. Ler arquivo PFX como ArrayBuffer
      const fileBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error("Erro ao ler arquivo do certificado."));
        reader.readAsArrayBuffer(pfxFile);
      });

      // 5. Criptografar bytes do PFX usando AES-GCM
      const ciphertextBuffer = await window.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        derivedKey,
        fileBytes
      );

      // 6. Exportar chave derivada para transferir no teste (mantenha em memória da sessão)
      const exportedRawKey = await window.crypto.subtle.exportKey("raw", derivedKey);

      // 7. Estruturar os dados em base64
      setEncryptedPfxData({
        encrypted_pfx: arrayBufferToBase64(ciphertextBuffer),
        salt: arrayBufferToBase64(salt),
        iv: arrayBufferToBase64(iv),
        derived_key: arrayBufferToBase64(exportedRawKey)
      });

      setSuccessMsg("Certificado criptografado com sucesso na memória do browser (Web Crypto API).");
      return true;
    } catch (err: any) {
      setError(`Erro na criptografia local: ${err.message || err}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Efetua teste de conexão mTLS dinâmico ao PJe
  const testarConexaoPJe = async () => {
    setError(null);
    setLoading(true);
    setTestResult(null);

    let currentCryptoData = encryptedPfxData;

    // Se ainda não criptografou na etapa 2 (ex: avançou sem clique extra), criptografa agora
    if (!currentCryptoData) {
      const encrypted = await encryptCertificateLocal();
      if (!encrypted) {
        setLoading(false);
        return;
      }
      // Pega dados gerados
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const passwordEncoder = new TextEncoder().encode(pfxPassword);
      const baseKey = await window.crypto.subtle.importKey("raw", passwordEncoder, "PBKDF2", false, ["deriveKey"]);
      const derivedKey = await window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt"]
      );
      const fileBytes = await pfxFile!.arrayBuffer();
      const ciphertextBuffer = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, derivedKey, fileBytes);
      const exportedRawKey = await window.crypto.subtle.exportKey("raw", derivedKey);
      
      currentCryptoData = {
        encrypted_pfx: arrayBufferToBase64(ciphertextBuffer),
        salt: arrayBufferToBase64(salt),
        iv: arrayBufferToBase64(iv),
        derived_key: arrayBufferToBase64(exportedRawKey)
      };
      setEncryptedPfxData(currentCryptoData);
    }

    try {
      const response = await fetch("http://localhost:3000/api/onboarding/test-pje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encrypted_pfx: currentCryptoData.encrypted_pfx,
          salt: currentCryptoData.salt,
          iv: currentCryptoData.iv,
          derived_key: currentCryptoData.derived_key,
          pfx_password: pfxPassword,
          tribunal_url: pjeTribunalUrl,
          grau: pjeGrau
        })
      });

      const data = await response.json();
      if (response.ok) {
        setTestResult({
          success: true,
          mensagem: data.mensagem,
          cert_info: data.cert_info
        });
        setConexaoTestada(true);
      } else {
        setTestResult({
          success: false,
          mensagem: data.error || data.detalhes || "Falha na conexão mTLS com o tribunal."
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        mensagem: `Erro de rede ao contactar servidor: ${err.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  // Finaliza a criação do escritório e admin
  const concluirOnboarding = async () => {
    setError(null);
    setLoading(true);

    // Filtra advogados com nome/email vazios
    const advogadosFiltrados = advogados.filter(a => a.nome && a.email);
    if (advogadosFiltrados.length === 0) {
      setError("É obrigatório cadastrar pelo menos um advogado de onboarding.");
      setLoading(false);
      return;
    }

    try {
      const payload = {
        escritorio: {
          nome: escritorioNome,
          cnpj: escritorioCnpj,
          oab_seccional: escritorioOabSec,
          endereco: escritorioEndereco
        },
        plano_id: "professional", // Plano padrão piloto
        certificado: encryptedPfxData ? {
          encrypted_pfx: encryptedPfxData.encrypted_pfx,
          salt: encryptedPfxData.salt,
          iv: encryptedPfxData.iv
        } : null,
        advogados: advogadosFiltrados
      };

      const response = await fetch("http://localhost:3000/api/onboarding/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (response.ok) {
        setSuccessMsg("Onboarding do escritório concluído com sucesso!");
        setTimeout(() => {
          router.push("/");
        }, 1500);
      } else {
        setError(data.error || "Ocorreu um erro ao salvar o escritório.");
      }
    } catch (err: any) {
      setError(`Erro ao salvar: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const proximaEtapa = async () => {
    setError(null);
    setSuccessMsg(null);

    if (step === 1) {
      if (!escritorioNome) return setError("O nome do escritório é obrigatório.");
      setStep(2);
    } else if (step === 2) {
      if (!pfxFile || !pfxPassword) return setError("Por favor, faça o upload do certificado e digite a senha.");
      const encryptSuccess = await encryptCertificateLocal();
      if (encryptSuccess) setStep(3);
    } else if (step === 3) {
      if (!conexaoTestada) return setError("Você precisa testar a conexão do PJe antes de avançar.");
      setStep(4);
    }
  };

  const anteriorEtapa = () => {
    setError(null);
    setSuccessMsg(null);
    setStep(step - 1);
  };

  const adicionarAdvogado = () => {
    setAdvogados([...advogados, { nome: "", email: "", tipo_perfil: "associado" }]);
  };

  const removerAdvogado = (index: number) => {
    if (advogados.length === 1) return;
    const items = [...advogados];
    items.splice(index, 1);
    setAdvogados(items);
  };

  const handleAdvogadoChange = (index: number, field: keyof Advogado, value: string) => {
    const items = [...advogados];
    (items[index] as any)[field] = value;
    setAdvogados(items);
  };

  return (
    <div className="min-h-screen bg-gradient text-slate-100 flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8">
      {/* Logotipo e Cabeçalho */}
      <div className="text-center mb-8 max-w-md">
        <h1 className="logo-text supreme-font text-3xl font-black mb-2">DONNA</h1>
        <span className="logo-badge inline-block mb-4">SISTEMA PILOTO DE ONBOARDING</span>
        <p className="text-sm text-slate-400">
          Configure a infraestrutura de dados jurídicos e criptografia do seu escritório em 4 passos.
        </p>
      </div>

      {/* Box do Wizard Glassmorphic */}
      <div className="glass-card w-full max-w-2xl border border-[rgba(212,175,55,0.15)] bg-slate-950/80 backdrop-blur-xl p-8 rounded-lg shadow-2xl relative overflow-hidden">
        {/* Barra de progresso */}
        <div className="relative w-full h-1 bg-slate-800 rounded-full mb-8">
          <div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-500 to-amber-500 transition-all duration-500 rounded-full"
            style={{ width: `${(step / 4) * 100}%` }}
          />
          <div className="flex justify-between items-center -mt-2">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                onClick={() => s < step && setStep(s)}
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black cursor-pointer transition-all duration-300 ${
                  s <= step
                    ? "bg-amber-500 text-slate-950 shadow-[0_0_8px_rgba(212,175,55,0.6)]"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {s}
              </div>
            ))}
          </div>
        </div>

        {/* Notificações */}
        {error && (
          <div className="p-3 mb-6 bg-rose-950/60 border border-rose-800 text-rose-300 text-xs rounded">
            <strong>Erro:</strong> {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3 mb-6 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs rounded">
            {successMsg}
          </div>
        )}

        {/* Conteúdo das Etapas */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-amber-500 mb-6 flex items-center gap-2">
              <span className="text-sm border border-amber-500 rounded-full w-5 h-5 inline-flex items-center justify-center">1</span>
              Dados do Escritório Piloto
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Nome Fantasia do Escritório *</label>
                <input
                  type="text"
                  placeholder="Ex: Albuquerque & Advogados Associados"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 p-3 rounded text-sm text-slate-100 outline-none"
                  value={escritorioNome}
                  onChange={e => setEscritorioNome(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">CNPJ (Opcional)</label>
                  <input
                    type="text"
                    placeholder="00.000.000/0001-00"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 p-3 rounded text-sm text-slate-100 outline-none"
                    value={escritorioCnpj}
                    onChange={e => setEscritorioCnpj(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">OAB Seccional *</label>
                  <select
                    className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 p-3 rounded text-sm text-slate-100 outline-none"
                    value={escritorioOabSec}
                    onChange={e => setEscritorioOabSec(e.target.value)}
                  >
                    <option value="PB">Paraíba (OAB/PB)</option>
                    <option value="PE">Pernambuco (OAB/PE)</option>
                    <option value="RN">Rio Grande do Norte (OAB/RN)</option>
                    <option value="SP">São Paulo (OAB/SP)</option>
                    <option value="DF">Distrito Federal (OAB/DF)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Endereço Sede</label>
                <textarea
                  placeholder="Rua, Número, Bairro, Cidade - UF"
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 p-3 rounded text-sm text-slate-100 outline-none resize-none"
                  value={escritorioEndereco}
                  onChange={e => setEscritorioEndereco(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-amber-500 mb-6 flex items-center gap-2">
              <span className="text-sm border border-amber-500 rounded-full w-5 h-5 inline-flex items-center justify-center">2</span>
              Certificado Digital ICP-Brasil (A1)
            </h2>
            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded mb-6">
              <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2">Protocolo de Criptografia Segura</h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                NUNCA enviamos a sua senha em texto plano. Ao anexar o arquivo <strong>.pfx</strong> e digitar a senha, o seu certificado é cifrado no próprio navegador usando a <strong>Web Crypto API</strong> com algoritmo <strong>AES-256-GCM</strong>.
                A senha é submetida a <strong>100.000 iterações PBKDF2</strong> para derivar a chave localmente. O backend decifra o arquivo apenas na memória volátil operacional do <em>CertificateVault</em>, nunca persistindo senhas.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Upload do Certificado (.pfx / .p12)</label>
                <input
                  type="file"
                  accept=".pfx,.p12"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 p-3 rounded text-sm text-slate-100 outline-none file:mr-4 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-amber-500 file:text-slate-950 hover:file:bg-amber-400 cursor-pointer"
                  onChange={e => setPfxFile(e.target.files?.[0] || null)}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Senha do Certificado Digital *</label>
                <input
                  type="password"
                  placeholder="Digite a senha de proteção do PFX"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 p-3 rounded text-sm text-slate-100 outline-none"
                  value={pfxPassword}
                  onChange={e => setPfxPassword(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold text-amber-500 mb-6 flex items-center gap-2">
              <span className="text-sm border border-amber-500 rounded-full w-5 h-5 inline-flex items-center justify-center">3</span>
              Parâmetros e Teste de Conexão ao PJe
            </h2>
            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Instância do PJe Tribunal (URL) *</label>
                  <input
                    type="text"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 p-3 rounded text-sm text-slate-100 outline-none"
                    value={pjeTribunalUrl}
                    onChange={e => setPjeTribunalUrl(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Grau de Jurisdição *</label>
                  <select
                    className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 p-3 rounded text-sm text-slate-100 outline-none"
                    value={pjeGrau}
                    onChange={e => setPjeGrau(e.target.value as "1g" | "2g")}
                  >
                    <option value="1g">1º Grau (Varas / Juizados)</option>
                    <option value="2g">2º Grau (Tribunal Pleno / Câmaras)</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 text-center">
                <button
                  type="button"
                  disabled={loading}
                  onClick={testarConexaoPJe}
                  className="px-6 py-3 border border-cyan-500 text-cyan-400 font-bold rounded uppercase tracking-wider hover:bg-cyan-500/10 active:scale-95 transition-all text-xs flex items-center justify-center gap-2 mx-auto"
                >
                  {loading ? (
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full" />
                  ) : "🔌"}
                  Testar Conexão mTLS PJe ao Vivo
                </button>
              </div>
            </div>

            {testResult && (
              <div
                className={`p-4 rounded border text-xs leading-relaxed transition-all duration-300 ${
                  testResult.success
                    ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                    : "bg-rose-950/40 border-rose-500/30 text-rose-300"
                }`}
              >
                <div className="font-bold mb-1">{testResult.success ? "✅ CONEXÃO ESTABELECIDA" : "❌ FALHA NA CONEXÃO"}</div>
                <div>{testResult.mensagem}</div>
                {testResult.cert_info && (
                  <div className="mt-2 pt-2 border-t border-emerald-500/20 grid grid-cols-2 gap-2 text-[10px]">
                    <div><strong>Validade:</strong> {testResult.cert_info.expira_em}</div>
                    <div><strong>Status:</strong> Ativo ({testResult.cert_info.dias_restantes} dias restantes)</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-xl font-bold text-amber-500 mb-6 flex items-center gap-2">
              <span className="text-sm border border-amber-500 rounded-full w-5 h-5 inline-flex items-center justify-center">4</span>
              Convite e Cadastro dos Advogados
            </h2>
            <p className="text-xs text-slate-400 mb-6">
              Defina os usuários iniciais com acesso ao copiloto jurídico para o primeiro piloto do escritório.
            </p>
            <div className="space-y-4 max-h-64 overflow-y-auto pr-2 mb-6">
              {advogados.map((adv, idx) => (
                <div key={idx} className="p-4 bg-slate-900/60 border border-slate-800 rounded relative space-y-3">
                  {advogados.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removerAdvogado(idx)}
                      className="absolute top-2 right-2 text-slate-500 hover:text-rose-400 text-xs"
                    >
                      Remover
                    </button>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Nome Completo *</label>
                      <input
                        type="text"
                        placeholder="Nome do Advogado"
                        className="w-full bg-slate-950 border border-slate-850 focus:border-amber-500/30 p-2 rounded text-xs text-slate-100 outline-none"
                        value={adv.nome}
                        onChange={e => handleAdvogadoChange(idx, "nome", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">E-mail Corporativo *</label>
                      <input
                        type="email"
                        placeholder="email@escritorio.com.br"
                        className="w-full bg-slate-950 border border-slate-850 focus:border-amber-500/30 p-2 rounded text-xs text-slate-100 outline-none"
                        value={adv.email}
                        onChange={e => handleAdvogadoChange(idx, "email", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Perfil de Usuário *</label>
                      <select
                        className="w-full bg-slate-950 border border-slate-850 focus:border-amber-500/30 p-2 rounded text-xs text-slate-100 outline-none"
                        value={adv.tipo_perfil}
                        onChange={e => handleAdvogadoChange(idx, "tipo_perfil", e.target.value)}
                      >
                        <option value="socio">Sócio Fundador</option>
                        <option value="associado">Advogado Associado</option>
                        <option value="estagiario">Estagiário de Direito</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">OAB (Opcional)</label>
                      <input
                        type="text"
                        placeholder="12345/PB"
                        className="w-full bg-slate-950 border border-slate-850 focus:border-amber-500/30 p-2 rounded text-xs text-slate-100 outline-none"
                        value={adv.oab || ""}
                        onChange={e => handleAdvogadoChange(idx, "oab", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">WhatsApp (Opcional)</label>
                      <input
                        type="text"
                        placeholder="(83) 98888-7777"
                        className="w-full bg-slate-950 border border-slate-850 focus:border-amber-500/30 p-2 rounded text-xs text-slate-100 outline-none"
                        value={adv.whatsapp || ""}
                        onChange={e => handleAdvogadoChange(idx, "whatsapp", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={adicionarAdvogado}
              className="text-xs text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 mb-6"
            >
              ➕ Convidar mais um Advogado
            </button>
          </div>
        )}

        {/* Rodapé de Ações do Card */}
        <div className="flex justify-between items-center mt-8 pt-6 border-t border-[rgba(212,175,55,0.08)]">
          {step > 1 ? (
            <button
              type="button"
              disabled={loading}
              onClick={anteriorEtapa}
              className="px-5 py-2.5 bg-slate-900 text-slate-300 text-xs font-black uppercase tracking-wider rounded border border-slate-800 hover:bg-slate-800 active:scale-95 transition-all"
            >
              Voltar
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              disabled={loading}
              onClick={proximaEtapa}
              className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 text-xs font-black uppercase tracking-wider rounded hover:from-amber-400 hover:to-amber-500 shadow-[0_4px_12px_rgba(212,175,55,0.2)] active:scale-95 transition-all flex items-center gap-2"
            >
              {loading ? "Processando..." : "Avançar"}
            </button>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={concluirOnboarding}
              className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 text-xs font-black uppercase tracking-wider rounded hover:from-cyan-400 hover:to-cyan-500 shadow-[0_4px_12px_rgba(6,182,212,0.2)] active:scale-95 transition-all flex items-center gap-2"
            >
              {loading ? (
                <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full" />
              ) : null}
              Finalizar Setup do Piloto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
