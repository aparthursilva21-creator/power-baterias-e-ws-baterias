/* Central privada de notificacoes e Push para Power × WS.
 * Avisos no banco sao a fonte de verdade; Push é um canal adicional.
 */
const el=id=>document.getElementById(id);
const clean=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PUSH_KEY_URL='https://drnhyzinnttrnqrbdpei.supabase.co/functions/v1/pbws-push?action=key';
const VALID_VIEWS=new Set(['dashboard','sales','settlements','reports']);
let client=null,activeUser=null,items=[],channel=null,poll=null,busy=false;
let panelVisible=false,booting=false;
const time=s=>new Intl.DateTimeFormat('pt-BR',{
 timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
}).format(new Date(s));

function note(text,kind='info'){
 const target=el('pbws-push-help');
 if(!target)return;
 target.textContent=text;
 target.dataset.kind=kind;
}
function errorText(err){
 return String(err?.message||err||'Falha desconhecida').slice(0,280);
}
function ownUnreads(){return items.filter(n=>!n.read_at).length;}
function badge(){
 const number=ownUnreads();
 const count=el('pbws-bell-count');
 if(count){count.hidden=number===0;count.textContent=number>99?'99+':String(number);}
 const bell=el('pbws-bell');if(bell)bell.setAttribute('aria-label',number?'Notificações — '+number+' não lidas':'Notificações');
 if(navigator.setAppBadge && Number.isInteger(number)){
  (number?navigator.setAppBadge(number):navigator.clearAppBadge()).catch(()=>{});
 }
}
function entry(n){
 const ico={sale:'↗',settlement:'✓',settlement_update:'⇄',reminder:'◷'}[n.kind]||'●';
 return '<button type="button" class="notif-entry'+(!n.read_at?' unread':'')+'" data-open-notif="'+clean(n.id)+'" data-target="'+clean(n.target)+'">'+
  '<span class="notif-entry-icon" aria-hidden="true">'+ico+'</span>'+
  '<span class="notif-entry-text"><strong>'+clean(n.title)+'</strong><span>'+clean(n.body)+'</span>'+
  '<small>'+time(n.created_at)+(n.read_at?'':' · Nova')+'</small></span></button>';
}
function refreshView(){
 badge();
 const list=el('pbws-notif-list');
 if(list)list.innerHTML=items.length?items.map(entry).join(''):
  '<div class="notif-empty">Você ainda não tem notificações. Quando uma venda ou um acerto acontecer, o aviso aparecerá aqui.</div>';
 const mark=el('pbws-mark-all');if(mark)mark.disabled=ownUnreads()===0;
}
function showPanel(flag){
 panelVisible=flag;
 const panel=el('pbws-notif-panel');
 const bell=el('pbws-bell');
 if(panel)panel.hidden=!flag;
 if(bell)bell.setAttribute('aria-expanded',flag?'true':'false');
 if(flag){refreshView();void checkPushState();void fetchNotifications();}
}
async function fetchNotifications(){
 if(!client||!activeUser)return;
 try{
  const {data,error}=await client.from('pbws_notifications').select(
    'id,kind,title,body,target,created_at,read_at'
  ).order('created_at',{ascending:false}).limit(70);
  if(error) throw error;
  items=data||[];
  refreshView();
 }catch(e){
  if(panelVisible)note('Não foi possível atualizar os avisos: '+errorText(e),'error');
 }
}
async function updateRead(ids){
 if(!client||!activeUser)return;
 const {error}=await client.rpc('pbws_mark_notifications_read',{p_ids:ids});
 if(error){note('Erro ao marcar como lida: '+errorText(error),'error');return;}
 const set=ids?new Set(ids):null;
 for(const x of items){if(!set||set.has(x.id))x.read_at=x.read_at||new Date().toISOString();}
 refreshView();
}
function openSection(name){
 const view=VALID_VIEWS.has(name)?name:'dashboard';
 history.replaceState(null,'',location.pathname+'?view='+view);
 window.dispatchEvent(new CustomEvent('pbws:go-section',{detail:{view}}));
 showPanel(false);
}
function b64ToBytes(value){
 const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/')+
  '='.repeat((4-value.length%4)%4));
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
async function readyWorker(){
 if(!('serviceWorker' in navigator))throw new Error('Este navegador não suporta Service Worker.');
 return navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
}
function supported(){
 return ('serviceWorker' in navigator) && ('PushManager' in window) &&
  ('Notification' in window) && location.protocol==='https:';
}
function installedApp(){
 return window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone===true;
}
function isIOS(){return /iPad|iPhone|iPod/i.test(navigator.userAgent)||
 (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
async function checkPushState(){
 const enable=el('pbws-enable-push'),disable=el('pbws-disable-push');
 if(!enable||!disable)return;
 if(!supported()){
  enable.hidden=true;disable.hidden=true;
  note(isIOS()?
   'No iPhone: abra o site no Safari, use Compartilhar → Adicionar à Tela de Início, abra pelo ícone e tente ativar. É necessário iOS 16.4 ou superior.':
   'Notificações na tela do celular não são compatíveis com este navegador. O histórico no sininho continua funcionando.');
  return;
 }
 if(isIOS()&&!installedApp()){
  enable.hidden=true;disable.hidden=true;
  note('No iPhone, primeiro adicione o site à Tela de Início pelo Safari. Depois abra pelo ícone e permita os avisos.');
  return;
 }
 if(Notification.permission==='denied'){
  enable.hidden=true;disable.hidden=true;
  note('Notificações bloqueadas no celular. Para ativar, altere a permissão nas configurações do aparelho.','error');
  return;
 }
 try{
  const reg=await readyWorker();
  const sub=await reg.pushManager.getSubscription();
  enable.hidden=!!sub;
  disable.hidden=!sub;
  if(sub && client && activeUser){
    const data=sub.toJSON();
    if(data.keys?.p256dh&&data.keys?.auth){
      const {error}=await client.rpc('pbws_save_push_subscription',{
        p_endpoint:sub.endpoint,p_p256dh:data.keys.p256dh,
        p_auth:data.keys.auth,p_user_agent:navigator.userAgent.slice(0,250)
      });
      if(error)throw error;
    }
  }
  note(sub?'Notificações no celular ativadas.':'Ative os avisos para receber mensagens mesmo com o sistema fechado.');
 }catch(e){
  enable.hidden=false;disable.hidden=true;
  note('Não foi possível verificar notificações: '+errorText(e),'error');
 }
}
async function enablePush(){
 if(!activeUser||!client||busy||!supported())return;
 busy=true;
 const btn=el('pbws-enable-push');if(btn)btn.disabled=true;
 try{
  // Solicitar autorização diretamente no clique, exigência do iOS.
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('Permissão não concedida. Confira os ajustes do aparelho.');
  const reg=await readyWorker();
  let sub=await reg.pushManager.getSubscription();
  if(!sub){
    const result=await fetch(PUSH_KEY_URL,{cache:'no-store'});
    if(!result.ok) throw new Error('Servidor Push não respondeu ('+result.status+').');
    const payload=await result.json();
    if(!payload.publicKey)throw new Error('Chave de notificações indisponível.');
    sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:b64ToBytes(payload.publicKey)
    });
  }
  const info=sub.toJSON();
  if(!info.keys?.p256dh||!info.keys?.auth)throw new Error('Inscrição incompleta no celular.');
  const {error}=await client.rpc('pbws_save_push_subscription',{
    p_endpoint:sub.endpoint,p_p256dh:info.keys.p256dh,
    p_auth:info.keys.auth,p_user_agent:navigator.userAgent.slice(0,250)
  });
  if(error)throw error;
  note('Pronto! Este celular está registrado para receber os avisos.','success');
  await checkPushState();
 }catch(e){note(errorText(e),'error');}
 finally{busy=false;if(btn)btn.disabled=false;}
}
async function disablePush(){
 if(!activeUser||!client||busy)return;
 busy=true;
 try{
  const reg=await readyWorker();
  const sub=await reg.pushManager.getSubscription();
  if(sub){
    const {error}=await client.rpc('pbws_disable_push_subscription',{p_endpoint:sub.endpoint});
    if(error)throw error;
    await sub.unsubscribe();
  }
  note('Avisos deste celular desativados. A central de notificações permanece disponível.','success');
  await checkPushState();
 }catch(e){note(errorText(e),'error');}
 finally{busy=false;}
}
async function boot(session){
 if(booting)return;
 booting=true;
 try{
  if(channel&&client)await client.removeChannel(channel);
  if(poll)clearInterval(poll);
  client=session.client;activeUser=session.user;
  await fetchNotifications();
  channel=client.channel('pbws-inbox-'+activeUser.id.slice(0,8))
   .on('postgres_changes',{
      event:'INSERT',schema:'public',table:'pbws_notifications',
      filter:'recipient_id=eq.'+activeUser.id
    },payload=>{
      void fetchNotifications();
      if(panelVisible)note('Nova notificação recebida.','success');
    }).subscribe();
  poll=setInterval(()=>{if(document.visibilityState==='visible')void fetchNotifications();},24000);
  void checkPushState();
 }finally{booting=false;}
}

el('pbws-bell')?.addEventListener('click',()=>showPanel(!panelVisible));
el('pbws-close-notif')?.addEventListener('click',()=>showPanel(false));
el('pbws-mark-all')?.addEventListener('click',()=>void updateRead(null));
el('pbws-enable-push')?.addEventListener('click',()=>void enablePush());
el('pbws-disable-push')?.addEventListener('click',()=>void disablePush());
el('pbws-notif-list')?.addEventListener('click',event=>{
 const node=event.target.closest('[data-open-notif]');
 if(!node)return;
 const id=node.dataset.openNotif;
 const notification=items.find(x=>x.id===id);
 if(notification && !notification.read_at)void updateRead([id]);
 openSection(node.dataset.target);
});
window.addEventListener('pbws:ready',e=>void boot(e.detail));
window.addEventListener('pbws:logout',()=>{
 if(channel&&client)void client.removeChannel(channel);
 if(poll)clearInterval(poll);
 channel=null;poll=null;client=null;activeUser=null;items=[];booting=false;
 showPanel(false);refreshView();
});
window.addEventListener('focus',()=>{if(activeUser)void fetchNotifications();});
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible' && activeUser)void fetchNotifications();
});
if(navigator.serviceWorker){
 navigator.serviceWorker.addEventListener('message',e=>{
  if(e.data?.type==='pbws-notification-open')openSection(e.data.view);
 });
}
const initial=new URLSearchParams(location.search).get('view');
if(initial&&VALID_VIEWS.has(initial)){
 window.addEventListener('pbws:ready',()=>{
   // Aguarda a tela principal aparecer após validação do login.
   window.dispatchEvent(new CustomEvent('pbws:go-section',{detail:{view:initial}}));
 });
}
if(window.pbwsSession)void boot(window.pbwsSession);
