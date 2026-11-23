import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const el = id => document.getElementById(id);
const loginButton = el('google-login');
const logoutButton = el('google-logout');
const screen = el('auth-screen');
const shell = el('app-shell');
const status = el('auth-message');
const account = el('account-details');
let supabase = null;
let verificationVersion = 0;
let scheduledCheck = null;
let signingOut = false;
let lastVerifiedAt = 0;
const RECHECK_MS = 10 * 60 * 1000;

function tell(text, kind = 'info') {
  status.textContent = text;
  status.dataset.kind = kind;
  status.hidden = false;
}
function locked() {
  screen.hidden = false;
  shell.hidden = true;
  logoutButton.hidden = true;
  account.textContent = '';
  lastVerifiedAt = 0;
  if (window.pbwsSession) { window.pbwsSession = null; window.dispatchEvent(new Event('pbws:logout')); }
}
function unlocked(user) {
  shell.hidden = false;
  screen.hidden = true;
  account.textContent = user.email || 'Conta autorizada';
  logoutButton.hidden = false;
}
function explain(error) {
  const message = error?.message || String(error || 'Erro desconhecido');
  if (/redirect|callback|invalid.*client|oauth/i.test(message)) {
    return 'Erro de configuração do Google OAuth: ' + message;
  }
  return message;
}
function scheduleVerification(force = false) {
  if (signingOut) return;
  // O Supabase pode reenviar SIGNED_IN quando o aplicativo volta ao primeiro plano.
  // Não desmontar a tela nem reabrir o login durante esta verificação.
  if (!force && window.pbwsSession && Date.now() - lastVerifiedAt < RECHECK_MS) return;
  clearTimeout(scheduledCheck);
  scheduledCheck = setTimeout(() => { void verify(); }, 120);
}
async function verify() {
  const version = ++verificationVersion;
  const activeSession = window.pbwsSession;
  const alreadyVisible = !!activeSession && !shell.hidden;
  if (!alreadyVisible) {
    loginButton.disabled = true;
    tell('Verificando acesso...');
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (version !== verificationVersion || signingOut) return;
    if (error) {
      loginButton.disabled = false;
      // Falha temporária de rede não apaga a tela que já estava em edição.
      if (!alreadyVisible) tell('Falha ao verificar a sessão. ' + explain(error), 'error');
      else console.warn('Verificação de sessão temporariamente indisponível.', error);
      return;
    }
    if (!user) {
      locked();
      loginButton.disabled = false;
      tell('Use uma das três contas Google autorizadas.');
      return;
    }
    if (!alreadyVisible) tell('Conta Google confirmada. Validando autorização...');
    const { data: authorized, error: authorizationError } = await supabase.rpc('is_authorized_user');
    if (version !== verificationVersion || signingOut) return;
    if (authorizationError) {
      loginButton.disabled = false;
      if (!alreadyVisible) tell('Falha ao consultar a autorização no Supabase: ' + explain(authorizationError), 'error');
      else console.warn('Não foi possível revalidar a autorização agora.', authorizationError);
      return;
    }
    if (authorized !== true) {
      locked();
      tell('Este e-mail não está autorizado. Entre com a conta cadastrada.', 'error');
      signingOut = true;
      try { await supabase.auth.signOut(); } finally { signingOut = false; }
      loginButton.disabled = false;
      return;
    }
    // Permissões são confirmadas no banco, nunca inferidas a partir do e-mail.
    const { data: appRole, error: roleError } = await supabase.rpc('current_app_role');
    if (version !== verificationVersion || signingOut) return;
    if (roleError && !/PGRST202|could not find the function|does not exist|schema cache/i.test(roleError.message || '')) {
      loginButton.disabled = false;
      if (!alreadyVisible) tell('Falha ao validar permissões: ' + explain(roleError), 'error');
      else console.warn('Não foi possível revalidar o perfil agora.', roleError);
      return;
    }
    if (!roleError && !['admin','power','ws'].includes(appRole)) {
      locked();
      loginButton.disabled = false;
      tell('Sua conta não tem um perfil empresarial ativo.', 'error');
      return;
    }
    const role = roleError ? 'setup' : appRole;
    lastVerifiedAt = Date.now();
    // Se a conta e a função não mudaram, manter DOM, modal e rascunho intactos.
    if (window.pbwsSession?.user?.id === user.id && window.pbwsSession.role === role) {
      window.pbwsSession.user = user;
      return;
    }
    unlocked(user);
    window.pbwsSession = { client: supabase, user, role };
    window.dispatchEvent(new CustomEvent('pbws:ready', { detail: window.pbwsSession }));
  } catch (err) {
    if (version !== verificationVersion) return;
    loginButton.disabled = false;
    if (!alreadyVisible) tell('Não foi possível validar o login. ' + explain(err), 'error');
    else console.warn('Falha temporária ao revalidar sessão ativa.', err);
  }
}
async function start() {
  locked();
  loginButton.disabled = true;

  // Carregamento assíncrono permite exibir um erro em vez de um botão sem resposta.
  try {
    const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL);
    const validKey = /^(sb_publishable_|eyJ)/.test(SUPABASE_PUBLISHABLE_KEY);
    if (!validUrl || !validKey) {
      tell('O Supabase ainda não foi configurado no arquivo config.js.', 'error');
      return;
    }
    tell('Preparando conexão segura com o Google...');
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.1');
    supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: 'pkce' }
    });

    const query = new URLSearchParams(location.search);
    const hashQuery = new URLSearchParams(location.hash.replace(/^#/, ''));
    const oauthError = query.get('error_description') || hashQuery.get('error_description');
    if (oauthError) {
      tell('O Google não concluiu o login: ' + oauthError, 'error');
      history.replaceState(null, '', location.pathname);
    }
    supabase.auth.onAuthStateChange((event, session) => {
      // Nunca aguardar chamadas ao Supabase dentro deste callback.
      if (event === 'SIGNED_OUT') {
        ++verificationVersion;
        locked();
        loginButton.disabled = false;
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        if (window.pbwsSession?.user?.id === session?.user?.id &&
            Date.now() - lastVerifiedAt < RECHECK_MS) return;
        scheduleVerification();
      } else if (event === 'TOKEN_REFRESHED') {
        // Token renovado em segundo plano não é motivo para reconstruir a tela.
        if (!window.pbwsSession) scheduleVerification();
      }
    });
    loginButton.disabled = false;
    scheduleVerification();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && window.pbwsSession &&
          Date.now() - lastVerifiedAt >= RECHECK_MS) {
        scheduleVerification(true);
      }
    });
  } catch (err) {
    loginButton.disabled = true;
    tell('O módulo de autenticação não carregou. Verifique a internet ou bloqueadores do navegador e atualize a página. Detalhes: ' + explain(err), 'error');
  }
}
loginButton.addEventListener('click', async () => {
  if (!supabase) {
    tell('A conexão com o Supabase não está pronta.', 'error');
    return;
  }
  loginButton.disabled = true;
  tell('Abrindo a página segura de login do Google...');
  try {
    const redirectTo = location.origin + location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } }
    });
    if (error) throw error;
    // O navegador será redirecionado pelo Supabase.
    setTimeout(() => {
      if (!screen.hidden) {
        loginButton.disabled = false;
        tell('Se não abriu o Google, veja se o navegador bloqueou o redirecionamento e tente novamente.', 'warning');
      }
    }, 7000);
  } catch (err) {
    loginButton.disabled = false;
    tell('Não foi possível iniciar o login Google: ' + explain(err), 'error');
  }
});
logoutButton.addEventListener('click', async () => {
  ++verificationVersion;
  clearTimeout(scheduledCheck);
  signingOut = true;
  try {
    // Sair manualmente também descarta rascunhos privados deste usuário.
    if (supabase && window.pbwsSession?.user?.id) {
      await supabase.from('pbws_sale_drafts').delete()
        .eq('owner_id',window.pbwsSession.user.id);
    }
    locked();
    if (supabase) await supabase.auth.signOut();
    loginButton.disabled = false;
    tell('Sessão encerrada. Entre novamente para continuar.');
  } catch (err) {
    tell('Não foi possível encerrar a sessão: ' + explain(err), 'error');
  } finally {
    signingOut = false;
  }
});
void start();
