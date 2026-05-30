import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    'AVISO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos no arquivo .env. Certifique-se de preenchê-los.'
  );
}

// Criado com service_role para que o backend possa rodar automações em segundo plano
// ignorando as políticas de RLS onde for necessário (ex: ingestão de webhooks)
export const supabase = createClient(supabaseUrl || '', supabaseServiceKey || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
