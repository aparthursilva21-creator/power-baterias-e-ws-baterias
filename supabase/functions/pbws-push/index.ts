// Edge Function: envia Web Push real com VAPID. Nenhuma chave privada no GitHub.
// Actions:
// GET ?action=key -> chave VAPID publica para cadastro no navegador.
// POST {"action":"dispatch"} -> somente webhook autenticado por token do Vault.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import webpush from 'npm:web-push@3.6.7';

const ORIGIN = 'https://aparthursilva21-creator.github.io';
const VAPID_CONTACT = 'https://aparthursilva21-creator.github.io/power-baterias-e-ws-baterias/';
const ALLOWED_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'updates.push.services.mozilla.org'
]);
const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-pbws-dispatch',
  'Cache-Control': 'no-store',
  'Vary': 'Origin'
};
const json = (body: unknown, status=200) =>
  new Response(JSON.stringify(body), { status, headers: responseHeaders });

function validEndpoint(raw: string): boolean {
  try {
    const u=new URL(raw);
    return u.protocol==='https:' && !u.username && !u.password && !u.port &&
      (ALLOWED_HOSTS.has(u.hostname) ||
       u.hostname==='push.apple.com' ||
       u.hostname.endsWith('.push.apple.com'));
  } catch { return false; }
}
function safeEqual(a: string,b: string): boolean {
  if (!a || !b || a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const service = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken:false, persistSession:false }
});

type Config = { public_key?: string | null; private_key?: string | null; dispatch?: string | null };
async function getConfig(): Promise<Config> {
  const {data,error}=await service.rpc('pbws_push_server_config');
  if(error) throw new Error('Configuracao interna indisponivel: '+error.message);
  return data ?? {};
}
async function ensureKeys(): Promise<Config> {
  let config=await getConfig();
  if(config.public_key && config.private_key) return config;
  // A chave privada eh gerada no servidor e enviada apenas ao Vault por RPC service_role.
  // Chamadas concorrentes sao resolvidas por lock no PostgreSQL.
  const pair=webpush.generateVAPIDKeys();
  const {error}=await service.rpc('pbws_push_initialize_keys',{
    p_public:pair.publicKey,
    p_private:pair.privateKey
  });
  if(error) throw new Error('Nao foi possivel criar o par VAPID: '+error.message);
  config=await getConfig();
  if(!config.public_key || !config.private_key) throw new Error('Chaves VAPID nao persistidas');
  return config;
}
async function dispatch() {
  const conf=await ensureKeys();
  const {data:deliveries,error}=await service.rpc('pbws_push_claim_deliveries',{p_limit:20});
  if(error) throw new Error('Falha na fila de notificacoes: '+error.message);
  const tasks=deliveries ?? [];
  let sent=0,failed=0;
  for(const delivery of tasks) {
    let success=false,gone=false,reason='';
    try {
      if(!validEndpoint(String(delivery.endpoint)))
        throw new Error('Provedor push nao permitido');
      const target= ['dashboard','sales','settlements','reports'].includes(delivery.target)
        ? delivery.target : 'dashboard';
      const payload = JSON.stringify({
        title:String(delivery.title||'Power × WS').slice(0,130),
        body:String(delivery.body||'Você tem uma nova notificação').slice(0,350),
        url:'./?view='+encodeURIComponent(target),
        tag:'pbws-'+String(delivery.delivery_id)
      });
      await webpush.sendNotification({
        endpoint:String(delivery.endpoint),
        keys:{
          p256dh:String(delivery.p256dh),
          auth:String(delivery.auth_secret)
        }
      },payload,{
        TTL:86400,
        vapidDetails:{
          subject:VAPID_CONTACT,
          publicKey:String(conf.public_key),
          privateKey:String(conf.private_key)
        }
      });
      success=true;
      sent++;
    } catch(err) {
      failed++;
      const e=err as {statusCode?: number;message?:string};
      gone=e?.statusCode===404 || e?.statusCode===410;
      reason=String(e?.statusCode||'')+' '+String(e?.message||'Falha no push').slice(0,240);
    }
    const {error:finishError}=await service.rpc('pbws_push_complete_delivery',{
      p_delivery_id:delivery.delivery_id,
      p_success:success,
      p_gone:gone,
      p_error:success?null:reason
    });
    if(finishError) console.error('Finalizacao da entrega falhou:',finishError.message);
  }
  return {processed:tasks.length,sent,failed};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:responseHeaders});
  const url=new URL(req.url);
  try {
    if(req.method==='GET' && url.searchParams.get('action')==='key') {
      const config=await ensureKeys();
      return json({publicKey:config.public_key});
    }
    if(req.method==='POST'){
      // O token foi guardado no Vault do Supabase; jamais no frontend ou repo.
      const config=await getConfig();
      const caller=req.headers.get('x-pbws-dispatch')||'';
      if(!safeEqual(caller,String(config.dispatch||'')))return json({error:'Acesso negado'},403);
      const payload=await req.json().catch(()=>null) as {action?: string}|null;
      if(payload?.action!=='dispatch')return json({error:'Operacao invalida'},400);
      return json(await dispatch());
    }
    return json({error:'Rota nao encontrada'},404);
  }catch(error) {
    console.error('pbws-push:',error instanceof Error?error.message:String(error));
    return json({error:'Servico Push indisponivel',hint:'Confira a implantacao e as configuracoes internas'},503);
  }
});
