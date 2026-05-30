import axios from 'axios';
import dotenv from 'dotenv';
import { supabase } from '../config/supabase.js';

dotenv.config();

const evolutionUrl = process.env.EVOLUTION_API_URL;
const evolutionApiKey = process.env.EVOLUTION_API_KEY;
const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'donna_whatsapp';

const resendApiKey = process.env.RESEND_API_KEY;
const emailRemetente = process.env.EMAIL_REMETENTE || 'donna@copiloto.com.br';

/**
 * MOTOR DE NOTIFICAÇÕES — Donna Core
 * Realiza envios de alertas via WhatsApp (Evolution API) e E-mail (Resend) e registra logs.
 */

/**
 * Envia uma mensagem de texto via WhatsApp utilizando a Evolution API.
 * @param {string} telefone - Telefone com DDI e DDD (ex: "5583988887777" ou "5511999998888")
 * @param {string} mensagem - Texto da mensagem
 * @returns {Promise<Object>} Resposta da API
 */
export async function enviarWhatsApp(telefone, mensagem) {
  if (!evolutionUrl || !evolutionApiKey) {
    throw new Error('Evolution API URL ou API Key não configuradas no arquivo .env.');
  }

  // Sanitiza o número para conter apenas dígitos e garantir o padrão brasileiro
  let numeroLimpo = telefone.replace(/\D/g, '');
  if (!numeroLimpo.startsWith('55')) {
    numeroLimpo = `55${numeroLimpo}`;
  }

  const url = `${evolutionUrl}/message/sendText/${instanceName}`;

  try {
    const response = await axios.post(
      url,
      {
        number: numeroLimpo,
        options: {
          delay: 1200,
          presence: 'composing',
          linkPreview: false,
        },
        textMessage: {
          text: mensagem,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          apikey: evolutionApiKey,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error('Erro ao enviar mensagem por WhatsApp via Evolution API:', error.response?.data || error.message);
    throw new Error(`Falha no envio de WhatsApp: ${error.message}`);
  }
}

/**
 * Envia um e-mail utilizando a API do Resend.
 * @param {string} destinatario - Endereço de e-mail do destinatário
 * @param {string} assunto - Assunto da mensagem
 * @param {string} htmlContent - Corpo do e-mail em formato HTML
 * @returns {Promise<Object>} Resposta do Resend
 */
export async function enviarEmail(destinatario, assunto, htmlContent) {
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY não configurada no arquivo .env.');
  }

  try {
    const response = await axios.post(
      'https://api.resend.com/emails',
      {
        from: `Donna Copiloto <${emailRemetente}>`,
        to: [destinatario],
        subject: assunto,
        html: htmlContent,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendApiKey}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error('Erro ao enviar e-mail via Resend:', error.response?.data || error.message);
    throw new Error(`Falha no envio de E-mail: ${error.message}`);
  }
}

/**
 * Orquestra o disparo de alertas registrando um log de histórico no Supabase.
 * 
 * @param {Object} params
 * @param {string} params.usuarioId - ID do advogado responsável no banco
 * @param {string} [params.processoId] - ID do processo atrelado (opcional)
 * @param {string} [params.prazoId] - ID do prazo atrelado (opcional)
 * @param {string} [params.tarefaId] - ID da tarefa atrelada (opcional)
 * @param {string} params.canal - Canal de envio ('whatsapp', 'email', 'ambos')
 * @param {string} params.titulo - Título formal (usado como assunto de e-mail e cabeçalho do WhatsApp)
 * @param {string} params.mensagem - Conteúdo textual da mensagem
 * @returns {Promise<Object>} Resumo dos status dos disparos
 */
export async function dispararAlerta({
  usuarioId,
  processoId = null,
  prazoId = null,
  tarefaId = null,
  canal,
  titulo,
  mensagem,
}) {
  // 1. Carregar contatos do usuário/advogado no banco
  const { data: usuario, error: userError } = await supabase
    .from('usuarios')
    .select('nome, email, whatsapp')
    .eq('id', usuarioId)
    .single();

  if (userError || !usuario) {
    throw new Error(`Advogado responsável não encontrado no banco: ${userError?.message}`);
  }

  const logEnvios = [];

  // Formatar mensagem para WhatsApp (com emojis e negritos markdown do whats)
  const corpoWhatsApp = `*${titulo.toUpperCase()}*\n\nOlá, Dr(a). ${usuario.nome},\n\n${mensagem}`;

  // Formatar corpo para e-mail (HTML elegante e limpo)
  const corpoEmailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; color: #333333;">
      <h2 style="color: #2b4c7e; border-bottom: 2px solid #2b4c7e; padding-bottom: 10px;">Donna — Copiloto Jurídico</h2>
      <p style="font-size: 16px; font-weight: bold;">${titulo}</p>
      <p>Prezado(a) Dr(a). ${usuario.nome},</p>
      <div style="background-color: #f7f9fc; padding: 15px; border-left: 4px solid #2b4c7e; margin: 15px 0; font-size: 14px; line-height: 1.6;">
        ${mensagem.replace(/\n/g, '<br/>')}
      </div>
      <p style="font-size: 12px; color: #666666; margin-top: 30px;">
        Esta é uma notificação automática gerada pela Donna. Por favor, confirme o andamento no painel interno.
      </p>
    </div>
  `;

  // 2. Executar disparos com base no canal
  const enviarPorWhats = canal === 'whatsapp' || canal === 'ambos';
  const enviarPorEmail = canal === 'email' || canal === 'ambos';

  // WhatsApp
  if (enviarPorWhats) {
    if (!usuario.whatsapp) {
      logEnvios.push({ canal: 'whatsapp', status: 'falha', log_erro: 'Contato de WhatsApp não cadastrado no perfil do usuário.' });
    } else {
      try {
        await enviarWhatsApp(usuario.whatsapp, corpoWhatsApp);
        logEnvios.push({ canal: 'whatsapp', status: 'enviado' });
      } catch (err) {
        logEnvios.push({ canal: 'whatsapp', status: 'falha', log_erro: err.message });
      }
    }
  }

  // E-mail
  if (enviarPorEmail) {
    if (!usuario.email) {
      logEnvios.push({ canal: 'email', status: 'falha', log_erro: 'E-mail não cadastrado no perfil do usuário.' });
    } else {
      try {
        await enviarEmail(usuario.email, titulo, corpoEmailHtml);
        logEnvios.push({ canal: 'email', status: 'enviado' });
      } catch (err) {
        logEnvios.push({ canal: 'email', status: 'falha', log_erro: err.message });
      }
    }
  }

  // 3. Gravar os logs no banco de dados para controle e auditoria do escritório
  const inserts = logEnvios.map(log => ({
    usuario_id: usuarioId,
    processo_id: processoId,
    prazo_id: prazoId,
    tarefa_id: tarefaId,
    canal: log.canal,
    conteudo: log.canal === 'whatsapp' ? corpoWhatsApp : corpoEmailHtml,
    status: log.status,
    log_erro: log.log_erro || null,
  }));

  if (inserts.length > 0) {
    const { error: insertError } = await supabase.from('alertas_enviados').insert(inserts);
    if (insertError) {
      console.error('Erro ao salvar histórico de alertas no Supabase:', insertError.message);
    }
  }

  return {
    destinatario: usuario.nome,
    relatorio_envio: logEnvios,
  };
}
