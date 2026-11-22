import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = (s) => document.querySelector(s);
const splash = $('#auth-screen');
const shell = $('#app-shell');
const message = $('#auth-message');
const loginButton = $('#google-login');
const logoutButton = $('#google-logout');
const account = $('#account-details');

const configured = Boolean(
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL) &&
  /^(sb_publishable_|eyJ)/.test(SUPABASE_PUBLISHABLE_KEY)
);
let client = null;
let checkSerial = 0;

function alertUser(text, kind = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = false;
}
function showGate() {
  shell.hidden = true;
  splash.hidden = false;
  logoutButton.hidden = true;
  account.textContent = '';
}
function showSystem(user) {
  splash.hidden = true;
  shell.hidden = false;
  account.textContent = user.email || 'Usuário autorizado';
  logoutButton.hidden = false;
}
async function verifySession() {
  const serial = ++checkSerial;
  showGate();
  if (!client) {
    loginButton.disabled = true;
    alertUser('A autenticação ainda precisa ser configurada. Conecte um projeto Supabase independente e cadastre os três e-mails autorizados.', 'warning');
    return;
  }
  loginButton.disabled = false;
  try {
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (serial !== checkSerial) return;
    if (userError || !user) {
      alertUser('Entre com uma das três contas Google autorizadas para continuar.');
      return;
    }
    loginButton.disabled = true;
    alertUser('Conferindo autorização da conta no banco de dados...');
    const { data: allowed, error } = await client.rpc('is_authorized_user');
    if (serial !== checkSerial) return;
    if (error || allowed !== true) {
      await client.auth.signOut();
      if (serial !== checkSerial) return;
      loginButton.disabled = false;
      alertUser('Acesso negado. Essa conta não está na lista autorizada ou a verificação de segurança ainda não foi instalada.', 'error');
      return;
    }
    showSystem(user);
  } catch (_) {
    if (serial !== checkSerial) return;
    loginButton.disabled = false;
    alertUser('Não foi possível validar o acesso. Tente novamente em instantes.', 'error');
  }
}

loginButton.addEventListener('click', async () => {
  if (!client) return;
  loginButton.disabled = true;
  alertUser('Redirecionando para o Google...');
  const redirectTo = location.origin + location.pathname;
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
  if (error) {
    loginButton.disabled = false;
    alertUser('Não foi possível iniciar o login: ' + error.message, 'error');
  }
});
logoutButton.addEventListener('click', async () => {
  ++checkSerial;
  showGate();
  if (client) await client.auth.signOut();
  loginButton.disabled = !configured;
  alertUser('Você saiu do sistema.');
});

if (configured) {
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  });
  client.auth.onAuthStateChange((_event) => {
    // A função assíncrona roda fora do callback, evitando bloqueios na biblioteca Auth.
    queueMicrotask(() => verifySession());
  });
}
verifySession();
