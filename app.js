import {receiptHTML,downloadReceipt,shareReceipt,soldBatteryName} from './ws-receipt.js?v=3';
import {SaleDraftStore,SALE_DRAFT_MINUTES} from './sale-drafts.js?v=1';

/* Power Baterias × WS Baterias
   Operação remota: Supabase Auth + RLS + funções SQL transacionais.
   Sem armazenamento local para vendas ou dinheiro.
*/
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const BR_TIMEZONE = 'America/Sao_Paulo';
const MENU = [
  ['dashboard', '◫', 'Início'],
  ['sales', '▣', 'Vendas'],
  ['settlements', '⇄', 'Acertos'],
  ['expenses', '◈', 'Despesas'],
  ['reports', '▥', 'Relatórios'],
  ['warranties', '♢', 'Garantias'],
  ['activity', '◷', 'Histórico']
];
const CATEGORIES = { gasoline: 'Gasolina', delivery: 'Entregas', recovery_parts: 'Peças de recuperação', materials: 'Materiais', other: 'Outros' };
const METHODS = { pix: 'PIX', cash: 'Dinheiro', card: 'Cartão', transfer: 'Transferência', other: 'Outro' };
const titles = Object.fromEntries(MENU.map(x => [x[0], x[2]]));
let api = null, user = null, role = null, current = (new URLSearchParams(location.search).get('view') || 'dashboard');
if(!MENU.some(x=>x[0]===current))current='dashboard';
let rows = { batteries: [], sales: [], settlements: [], batches: [], batchItems: [], expenses: [], events: [], activity: [], expenseEvents: [], staff: [], saleRevisions: [], powerExpenses: [], powerExpenseEvents: [] };
let refreshing = false, submitting = false, ready = false, timer = null, report = null;
let selectedSettle = new Set();
let expenseBranch='ws';
let activeReceipt=null;
let draftStore=null;
let draftCache={sale:null,historical_sale:null};
let activeSaleDraft=null;
let draftSaveTimer=null;
let liveChannel=null;let liveRefreshDebounce=null;
function zonedDateParts(value){
  return Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:BR_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(value)).filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,p.value]));
}
function monthKey(value){const p=zonedDateParts(value);return p.year+'-'+p.month;}
function dayKey(value){const p=zonedDateParts(value);return p.year+'-'+p.month+'-'+p.day;}
function brazilLocalNow(){
 const t=new Intl.DateTimeFormat('en-GB',{timeZone:BR_TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false})
  .formatToParts(new Date());
 const x=part=>t.find(v=>v.type===part)?.value||'00';
 return dayKey(new Date())+'T'+x('hour')+':'+x('minute');
}
function brazilInputDateTime(value){
 const t=new Intl.DateTimeFormat('en-GB',{
  timeZone:BR_TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false
 }).formatToParts(new Date(value));
 const v=name=>t.find(p=>p.type===name)?.value||'00';
 return dayKey(value)+'T'+v('hour')+':'+v('minute');
}
let reportMonth = monthKey(new Date());
const cents = value => {
  const s = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('Informe um valor válido com no máximo duas casas decimais.');
  const [a,b=''] = s.split('.');
  const n = Number(a) * 100 + Number(b.padEnd(2,'0'));
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Valor fora do limite.');
  return n;
};
const fromCents = c => (Number(c || 0)/100).toFixed(2);
const brl = c => (Number(c || 0)/100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const stamp = s => s ? new Intl.DateTimeFormat('pt-BR',{timeZone:BR_TIMEZONE,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s)) : '—';
const dateBR = s => s ? (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s).slice(8,10)+'/'+String(s).slice(5,7)+'/'+String(s).slice(0,4) : new Intl.DateTimeFormat('pt-BR',{timeZone:BR_TIMEZONE,day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(s))) : '—';
const roleName = r => ({ admin:'Administrador', power:'Power Baterias · Sandro', ws:'WS Baterias · Wanderson' }[r] || 'Usuário');
const canSell = () => role === 'ws' || role === 'admin';
const canBackdateSale = () => ['ws','power','admin'].includes(role);
const canEditSale = s => !!s && (
 role==='admin' || (role==='ws'&&s.sold_by===user?.id) ||
 (role==='power'&&s.is_historical&&s.recorded_by===user?.id)
);
const canPay = () => role === 'power' || role === 'admin';
const canExpense = () => ['ws','power','admin'].includes(role);
const canViewWSExpenses=()=>role==='ws'||role==='admin';
const canViewPowerExpenses=()=>role==='power'||role==='admin';
const shortId = id => String(id || '').slice(0,8);
const staffName = id => {
  const x = rows.staff.find(p => p.id === id);
  return x ? (x.role === 'admin' ? 'Arthur' : x.role === 'power' ? 'Sandro' : 'Wanderson') : (id ? 'Conta ' + shortId(id) : '—');
};
const battery = id => rows.batteries.find(b => b.id === id);
const saleFor = id => rows.sales.find(s => s.battery_id === id);
const settleFor = id => rows.settlements.find(s => s.battery_id === id);
const remaining = s => Math.max(0, Number(s.owed_cents) - Number(s.paid_cents) - Number(s.waived_cents));
function settlingStatus(s) {
  if (!s) return ['Sem venda','gray'];
  if (remaining(s) === 0) return Number(s.waived_cents) > 0 ? ['Dispensado','green'] : ['Acertado','green'];
  return Number(s.paid_cents) > 0 ? ['Parcial','yellow'] : ['Pendente','yellow'];
}
function statusBadge(label, cls = 'gray') { return '<span class="badge ' + cls + '">' + esc(label) + '</span>'; }
function stat(label, value, highlight = false) { return '<div class="stat-card' + (highlight?' highlight':'') + '"><span class="stat-label">' + esc(label) + '</span><strong class="stat-value">' + esc(value) + '</strong></div>'; }
function panel(title, content, trailing='') { return '<section class="panel"><div class="panel-top"><h3 class="panel-title">' + title + '</h3>' + trailing + '</div>' + content + '</section>'; }
function tbl(headers, content) { return '<div class="table-scroll"><table><thead><tr>' + headers.map(h=>'<th>'+h+'</th>').join('') + '</tr></thead><tbody>' + (content || '<tr><td colspan="' + headers.length + '"><div class="empty">Nenhum registro encontrado.</div></td></tr>') + '</tbody></table></div>'; }
function heading(title, desc, action='') { return '<div class="page-heading"><div><h2>' + title + '</h2><p>' + desc + '</p></div>' + action + '</div>'; }
function button(label, act, cls='') { return '<button type="button" class="btn ' + cls + '" data-act="' + act + '">' + label + '</button>'; }
function field(label,name,type='text',value='',extras='') {
  return '<label class="field"><span>'+esc(label)+'</span><input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extras+'></label>';
}
function selectField(label,name,options,value,extra='') {
  return '<label class="field"><span>'+esc(label)+'</span><select name="'+name+'" '+extra+'>'+options.map(o=>'<option value="'+esc(o[0])+'" '+(o[0]===value?'selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select></label>';
}
let toastTimer;
function toast(msg,kind='info') {
  const el=$('#toast'); el.textContent=msg;el.dataset.kind=kind;el.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{el.hidden=true;},4500);
}
function explain(err) {
  const m=String(err?.message || err || 'Erro inesperado');
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Não foi possível conectar. Verifique a internet e tente novamente.';
  if (/permission denied|row-level security|42501/i.test(m)) return 'A sua conta não tem permissão para esta operação.';
  if (/does not exist|could not find the function|schema cache|PGRST202|42P01|42883/i.test(m)) return 'O banco ainda não recebeu todas as migrações. Execute os arquivos SQL 002, 003, 004 e 005 no Supabase.';
  return m;
}
function modal(title, content, footer='') {
  $('#dialog-title').textContent=title;
  $('#dialog-content').innerHTML=content;
  $('#dialog-footer').innerHTML=footer || '<button class="btn secondary" type="button" data-modal-close>Fechar</button>';
  $('#modal-root').hidden=false;
  document.body.style.overflow='hidden';
  $('#modal-close').focus();
}
function closeModal() {
  if(!submitting && activeSaleDraft?.form?.isConnected) void persistSaleDraft();
  $('#modal-root').hidden=true;document.body.style.overflow='';
}
$('#modal-close').addEventListener('click',closeModal);
$('#modal-root').addEventListener('click', e => {
  if (e.target === $('#modal-root') || e.target.closest('[data-modal-close]')) closeModal();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal-root').hidden)closeModal();});
function setBusy(value) {
  submitting=value;
  $$('.dialog button, .dialog input, .dialog select, .dialog textarea').forEach(el=>el.disabled=value);
}
async function runRpc(name, params, successMessage, afterSave=null) {
  if(submitting) return false;
  setBusy(true);
  try {
    const {data,error} = await api.rpc(name,params);
    if(error) throw error;
    closeModal();
    toast(successMessage);
    await loadAll(true);
    if(afterSave){
      try{await afterSave(data);}
      catch(err){toast('Venda salva, mas não foi possível abrir a notinha. Abra Vendas para gerar novamente.','error');}
    }
    return true;
  } catch(err) { toast(explain(err),'error'); return false; }
  finally { setBusy(false); }
}
// Campos não confirmados são salvos como rascunho individual no Supabase.
// Informações do cliente não são gravadas no armazenamento permanente do navegador.
function draftMode(historical){return historical?'historical_sale':'sale';}
function draftStatus(message){
 const form=$('#sale-form'),el=$('[data-sale-draft-status]');
 if(form && activeSaleDraft?.form===form && el)el.textContent=message;
}
function draftSnapshot(form,ctx){
 return {kind:ctx.kind,form_data:Object.fromEntries(new FormData(form)),
  request_id:ctx.requestId};
}
function queueDraftSave(){
 const ctx=activeSaleDraft;
 if(!ctx || !ctx.form?.isConnected || !draftStore ||
    !user || ctx.userId!==user.id || submitting)return;
 const copy=draftSnapshot(ctx.form,ctx);
 draftCache[ctx.kind]=copy;
 ctx.dirty=true;
 draftStatus('Salvando rascunho…');
 clearTimeout(draftSaveTimer);
 draftSaveTimer=setTimeout(()=>{void persistSaleDraft();},280);
}
async function persistSaleDraft(){
 clearTimeout(draftSaveTimer);
 const ctx=activeSaleDraft;
 if(!ctx || ctx.discarded || !ctx.dirty ||
    !draftStore || !user || ctx.userId!==user.id)return;
 const snapshot=ctx.form?.isConnected?draftSnapshot(ctx.form,ctx):draftCache[ctx.kind];
 if(!snapshot)return;
 draftCache[ctx.kind]=snapshot;
 ctx.dirty=false;
 draftStatus('Salvando rascunho…');
 try{
  await draftStore.save(ctx.kind,snapshot.form_data,ctx.requestId);
  if(activeSaleDraft===ctx&&!ctx.dirty)
    draftStatus('✓ Rascunho salvo por até '+SALE_DRAFT_MINUTES+' minutos.');
 }catch(err){
  if(activeSaleDraft===ctx){
   ctx.dirty=true;
   draftStatus('Sem conexão para salvar. Os dados permanecem nesta tela.');
  }
  console.warn('Rascunho remoto não foi salvo.',err);
 }
}
async function forgetSaleDraft(kind){
 clearTimeout(draftSaveTimer);
 if(activeSaleDraft?.kind===kind){
  activeSaleDraft.discarded=true;
  activeSaleDraft=null;
 }
 draftCache[kind]=null;
 if(!draftStore)return;
 try {await draftStore.remove(kind);}
 catch(err){console.warn('Não foi possível excluir o rascunho no servidor.',err);}
}
async function discardSaleDraft(){
 if(!activeSaleDraft)return;
 if(!confirm('Descartar o rascunho desta venda? Os dados ainda não foram confirmados e serão excluídos.'))return;
 const kind=activeSaleDraft.kind;
 await forgetSaleDraft(kind);
 closeModal();
 toast('Rascunho descartado.');
}
async function resumeSaleDraft(){
 if(!draftStore || !api || !user || !ready)return;
 try{
  const item=await draftStore.latest();
  if(!item || !api || !user)return;
  if(rows.sales.some(s=>s.client_request_id===item.request_id)){
    void draftStore.remove(item.kind);
    return;
  }
  const historical=item.kind==='historical_sale';
  if(historical?!canBackdateSale():!canSell())return;
  // Só reabre o formulário após login, nunca durante atualização em tempo real.
  current='sales';render();
  openSale(historical,item);
  toast('Rascunho da venda recuperado. Você pode continuar de onde parou.');
 }catch(err){console.warn('Não foi possível recuperar rascunho remoto.',err);}
}

function nav() {
  const visible = MENU.filter(x => x[0] !== 'expenses' || canExpense());
  const html=visible.map(x=>'<button class="nav-action'+(x[0]===current?' active':'')+'" data-view="'+x[0]+'" type="button" '+(x[0]===current?'aria-current="page"':'')+'><span class="nav-symbol" aria-hidden="true">'+x[1]+'</span><span>'+x[2]+'</span></button>').join('');
  $('#side-nav').innerHTML=html; $('#bottom-nav').innerHTML=html;
}
function setupError(msg) {
  ready=false;
  $('#app-main').innerHTML='<div class="page-stack">'+heading('Configuração necessária','Seu acesso Google está funcionando, mas o banco operacional ainda precisa ser preparado.')+
  '<div class="note error"><b>Não é seguro registrar vendas reais agora.</b><br>'+esc(msg)+'</div>'+
  panel('Ativar o banco no projeto novo','<div class="panel-body"><p class="muted">No Supabase SQL Editor, execute na ordem as migrações 002, 003, 004 e 005 deste repositório. Depois clique em Atualizar.</p><p><a href="https://github.com/aparthursilva21-creator/power-baterias-e-ws-baterias/tree/main/supabase" target="_blank" rel="noopener">Abrir arquivos SQL no GitHub</a></p>'+button('↻ Testar conexão novamente','refresh','')+'</div>')+'</div>';
}
async function boot(session) {
  const changedAccount=user?.id!==session.user.id;
  api=session.client;user=session.user;role=session.role;
  if(changedAccount){
    clearTimeout(draftSaveTimer);
    draftCache={sale:null,historical_sale:null};
    activeSaleDraft=null;
    draftStore=new SaleDraftStore(api,user.id);
  }
  expenseBranch=role==='power'?'power':'ws';
  $('#role-label').textContent=roleName(role);
  $('#account-details').textContent=user.email || 'Conta autorizada';
  nav();
  await loadAll();
  if(changedAccount)await resumeSaleDraft();
  if(liveChannel) { await api.removeChannel(liveChannel); liveChannel=null; }
  // Eventos imediatos, com consulta periódica de segurança caso o WebSocket caia.
  liveChannel=api.channel('pbws-sync-' + user.id.slice(0,8))
    .on('postgres_changes',{event:'*',schema:'public',table:'used_battery_sales'},syncSoon)
    .on('postgres_changes',{event:'*',schema:'public',table:'used_batteries'},syncSoon)
    .on('postgres_changes',{event:'*',schema:'public',table:'used_battery_settlements'},syncSoon)
    .on('postgres_changes',{event:'*',schema:'public',table:'used_settlement_batches'},syncSoon)
    .on('postgres_changes',{event:'*',schema:'public',table:'ws_expenses'},syncSoon)
    .on('postgres_changes',{event:'*',schema:'public',table:'power_expenses'},syncSoon)
    .subscribe();
  if(!timer) timer=setInterval(()=>{if(api&&document.visibilityState==='visible'&&ready&&!submitting)void loadAll(true);},20000);
}
function syncSoon(){
  clearTimeout(liveRefreshDebounce);
  liveRefreshDebounce=setTimeout(()=>{if(api && ready && !refreshing && !submitting)void loadAll(true);},600);
}
document.addEventListener('visibilitychange',()=>{
 if(document.hidden && activeSaleDraft?.form?.isConnected){
   // Saindo para o WhatsApp: inicia gravação imediata antes do navegador suspender o app.
   void persistSaleDraft();
 }
});
window.addEventListener('pagehide',()=>{
 if(activeSaleDraft?.form?.isConnected)void persistSaleDraft();
});

window.addEventListener('pbws:ready',e=>void boot(e.detail));
window.addEventListener('pbws:go-section',e=>{
 const view=e.detail?.view;
 if(!MENU.some(x=>x[0]===view))return;
 if(view==='expenses'&&!canExpense())return;
 current=view;report=null;if(ready)render();
 if(view==='reports'&&ready)void fetchReport();
});

window.addEventListener('pbws:logout',()=>{
  const oldApi=api;
  clearTimeout(draftSaveTimer);
  activeSaleDraft=null;draftStore=null;draftCache={sale:null,historical_sale:null};
  api=null;user=null;role=null;ready=false;report=null;rows={batteries:[],sales:[],settlements:[],batches:[],batchItems:[],expenses:[],events:[],activity:[],expenseEvents:[],staff:[],saleRevisions:[],powerExpenses:[],powerExpenseEvents:[]};
  selectedSettle.clear();if(timer)clearInterval(timer);timer=null;
  clearTimeout(liveRefreshDebounce);
  if(liveChannel && oldApi)void oldApi.removeChannel(liveChannel);
  liveChannel=null;closeModal();
});
if(window.pbwsSession)void boot(window.pbwsSession);
window.addEventListener('focus',()=>{if(api&&ready&&!refreshing)void loadAll(true);});
async function loadAll(silent=false) {
  if(!api||refreshing) return;
  refreshing=true;
  if(!silent) $('#app-main').innerHTML='<div class="loading"><span class="loader"></span> Carregando dados seguros...</div>';
  const requests=[
    ['batteries',api.from('used_batteries').select('*').order('created_at',{ascending:false})],
    ['sales',api.from('used_battery_sales').select('*').order('sold_at',{ascending:false})],
    ['settlements',api.from('used_battery_settlements').select('*').order('created_at',{ascending:false})],
    ['batches',api.from('used_settlement_batches').select('*').order('settled_at',{ascending:false})],
    ['batchItems',api.from('used_settlement_batch_items').select('*')],
    ['events',api.from('used_settlement_events').select('*').order('occurred_at',{ascending:false}).limit(500)],
    ['activity',api.from('used_battery_activity').select('*').order('occurred_at',{ascending:false}).limit(500)],
    ['saleRevisions',api.from('used_sale_revisions').select('*').order('occurred_at',{ascending:false}).limit(500)],
    ['staff',api.rpc('get_power_ws_team')]
  ];
  if(canViewWSExpenses()) requests.push(
    ['expenses',api.from('ws_expenses').select('*').order('spent_on',{ascending:false})],
    ['expenseEvents',api.from('ws_expense_events').select('*').order('occurred_at',{ascending:false}).limit(300)]
  );
  if(canViewPowerExpenses())requests.push(
    ['powerExpenses',api.from('power_expenses').select('*').order('spent_on',{ascending:false})],
    ['powerExpenseEvents',api.from('power_expense_events').select('*').order('occurred_at',{ascending:false}).limit(300)]
  );
  try {
    const resolved=await Promise.all(requests.map(async([key,promise])=>({key,...await promise})));
    const failed=resolved.find(x=>x.error);
    if(failed) throw new Error(failed.key+': '+explain(failed.error));
    for(const x of resolved)rows[x.key]=x.data || [];
    // Vendas canceladas ficam preservadas no banco e na auditoria, mas nao contam na operacao.
    rows.sales=rows.sales.filter(s=>!s.cancelled_at);
    const activeSales=new Set(rows.sales.map(s=>s.id));
    rows.settlements=rows.settlements.filter(s=>activeSales.has(s.sale_id));
    selectedSettle=new Set([...selectedSettle].filter(id=>rows.settlements.some(s=>s.id===id && remaining(s)>0)));
    if(!canViewWSExpenses()){rows.expenses=[];rows.expenseEvents=[];}
    if(!canViewPowerExpenses()){rows.powerExpenses=[];rows.powerExpenseEvents=[];}
    ready=true;
    render();
  } catch(err) {
    if(!ready)setupError(explain(err));
    else toast('Não foi possível atualizar: '+explain(err),'error');
  } finally{refreshing=false;}
}
function render() {
  if(!api||!ready) return;
  nav(); const titlesDetails={dashboard:'A operação em tempo real',sales:'Todas as vendas registradas',settlements:'Valores devidos à Power após as vendas',expenses:'Custos operacionais da WS',reports:'Fechamento financeiro e indicadores',warranties:'Garantias e prazos registrados',activity:'Registro de alterações e responsáveis'};
  $('#heading').textContent=titles[current] || 'Visão geral';
  $('#subtitle').textContent=titlesDetails[current]||'Controle compartilhado';
  const fn={dashboard:dashboardView,sales:salesView,settlements:settlementView,expenses:expenseView,reports:reportView,warranties:warrantyView,activity:activityView}[current]||dashboardView;
  $('#app-main').innerHTML='<div class="page-stack">'+fn()+'</div>';
}
function dashboardView() {
  const nowMonth=monthKey(new Date());
  const recent=rows.sales.filter(s=>monthKey(s.sold_at)===nowMonth);
  const revenue=recent.reduce((a,s)=>a+Number(s.sale_price_cents),0);
  const debt=rows.settlements.reduce((a,s)=>a+remaining(s),0);
  const pending=rows.settlements.filter(s=>remaining(s)>0).length;
  const salesHtml=rows.sales.slice(0,6).map(s=>{
    const b=battery(s.battery_id), st=settleFor(s.battery_id), sts=settlingStatus(st);
    return '<div class="list-entry"><div><strong>'+esc(batteryDisplay(b))+'</strong><small>'+stamp(s.sold_at)+' · '+esc(s.customer_name)+'</small></div><div class="text-right"><strong>'+brl(s.sale_price_cents)+'</strong><div style="margin-top:7px">'+statusBadge(sts[0],sts[1])+'</div></div></div>';
  }).join('')||'<div class="empty">Ainda não há vendas.</div>';
  const pendingHtml=rows.settlements.filter(s=>remaining(s)>0).slice(0,5).map(s=>{
    const b=battery(s.battery_id);
    return '<div class="list-entry"><div><strong>'+esc(batteryDisplay(b))+'</strong><small>'+esc(saleFor(s.battery_id)?.customer_name||'Cliente não informado')+'</small></div><strong class="accent">'+brl(remaining(s))+'</strong></div>';
  }).join('')||'<div class="empty">Nenhum acerto pendente.</div>';
  return heading('Visão geral','Tudo o que acontece na operação fica registrado e sincronizado.',button('↻ Atualizar','refresh','secondary'))+
  '<div class="stat-grid">'+stat('Vendas deste mês',brl(revenue),true)+stat('Vendas realizadas no mês',String(recent.length))+stat('Acertos pendentes',brl(debt),true)+stat('Baterias aguardando acerto',String(pending))+'</div>'+
  '<div class="grid-2">'+panel('Vendas recentes','<div class="panel-body lined-list">'+salesHtml+'</div>',button('Ver vendas','sales','secondary tiny'))+
  panel('A receber · Power','<div class="panel-body lined-list">'+pendingHtml+'</div>',button('Abrir acertos','settlements','secondary tiny'))+'</div>'+
  '<div class="note">Os valores financeiros e horários são consultados no banco Supabase. Horários exibidos em Brasília (UTC−3). '+(canPay()?'Você pode conciliar pagamentos.':'O Sandro controla e confirma os repasses.')+'</div>';
}
function canMakeWSReceipt(s){
 return !!s && !s.cancelled_at && ['ws','power','admin'].includes(role);
}
function openWSReceipt(s,b){
 if(!canMakeWSReceipt(s) || !b)throw new Error('Não foi possível localizar os dados da venda.');
 activeReceipt={sale:s,battery:b};
 modal('Comprovante de venda · WS Baterias',receiptHTML(s,b),
  '<button class="btn secondary" type="button" data-modal-close>Fechar</button>'+
  '<button class="btn secondary" type="button" data-receipt-action="print">Imprimir</button>'+
  '<button class="btn" type="button" data-receipt-action="download">Baixar PDF</button>'+
  '<button class="btn" type="button" data-receipt-action="share">Compartilhar</button>');
}
async function openWSReceiptById(saleId){
 if(!saleId || !api)throw new Error('Informe a venda.');
 let sale=rows.sales.find(x=>x.id===saleId);
 let bat=sale?battery(sale.battery_id):null;
 if(!sale){
  const res=await api.from('used_battery_sales').select('*').eq('id',saleId).single();
  if(res.error)throw res.error;
  sale=res.data;
 }
 if(!sale || sale.cancelled_at)throw new Error('Esta venda não está mais ativa.');
 if(!bat){
  const res=await api.from('used_batteries').select('*').eq('id',sale.battery_id).single();
  if(res.error)throw res.error;
  bat=res.data;
 }
 if(!bat)throw new Error('Bateria vinculada à venda não encontrada.');
 openWSReceipt(sale,bat);
}

function batteryDisplay(b){
 return b?soldBatteryName(b):'Bateria não identificada';
}
function hideInternalBatteryCodes(message){
 let result=String(message||'');
 // Os códigos continuam no banco, mas a interface apresenta os nomes dos produtos.
 for(const b of rows.batteries){
  if(b?.code)result=result.replaceAll(b.code,batteryDisplay(b));
 }
 return result.replace(/\bWS-\d{4,}\b/g,'bateria');
}

function salesView(){
 const content=rows.sales.map(s=>{
 const b=battery(s.battery_id),st=settleFor(s.battery_id),sts=settlingStatus(st);
 const dateRevision=rows.saleRevisions.find(r=>r.sale_id===s.id && r.action==='corrected' &&
   r.before_data?.sale?.sold_at && r.after_data?.sale?.sold_at &&
   r.before_data.sale.sold_at!==r.after_data.sale.sold_at);
 const receiptButton=canMakeWSReceipt(s)?
    '<button type="button" class="btn tiny ws-receipt-button" data-act="ws-receipt" data-id="'+s.id+'">▤ Notinha WS</button>':'';
 const actions=canEditSale(s)?
    '<div class="row-actions"><button type="button" class="btn tiny secondary" data-act="edit-sale" data-id="'+s.id+'">Corrigir</button>'+
    (role==='admin'?'<button type="button" class="btn tiny danger" data-act="cancel-sale" data-id="'+s.id+'">Cancelar</button>':'')+'</div>':'—';
 const allActions='<div class="row-actions">'+receiptButton+(actions==='—'?'':actions)+'</div>';
 return '<tr><td><strong>'+stamp(s.sold_at)+'</strong>'+
 (s.is_historical?'<div style="margin-top:4px">'+statusBadge('Venda antiga','gray')+'</div>':'')+
 (dateRevision?'<div style="margin-top:4px">'+statusBadge('Data/hora corrigida','yellow')+'</div>':'')+
 '<div class="cell-sub">Registrada: '+stamp(s.recorded_at||s.sold_at)+' · '+esc(staffName(s.recorded_by||s.sold_by))+'</div></td><td>'+esc(batteryDisplay(b))+'<div class="cell-sub">'+(b?.amperage_ah?esc(b.amperage_ah+' Ah'):'Bateria vendida')+'</div></td><td><div class="cell-main">'+esc(s.customer_name)+'</div><div class="cell-sub">'+esc(s.customer_phone||'Sem telefone')+' · '+esc(s.vehicle_plate||'Sem placa')+'</div></td><td><strong>'+brl(s.sale_price_cents)+'</strong><div class="cell-sub">'+esc(METHODS[s.payment_method]||s.payment_method)+'</div></td><td>'+Number(s.warranty_days)+' dias</td><td>'+statusBadge(sts[0],sts[1])+'</td><td>'+allActions+'</td></tr>';
 }).join('');
 return heading('Vendas','Cada venda aparece no mês em que aconteceu, mesmo quando cadastrada depois.',
 '<div class="btn-row">'+
 (canSell()?button('+ Venda de hoje','new-sale'):'')+
 (canBackdateSale()?button('◷ Lançar venda antiga','new-historical-sale','secondary'):'')+
 '</div>')+
 panel('Histórico de vendas',tbl(['Data da venda / Cadastro','Bateria','Cliente','Venda','Garantia','Acerto','Ações'],content));
}
function settlementView() {
 const pending=rows.settlements.filter(x=>remaining(x)>0);
 const total=pending.reduce((a,x)=>a+remaining(x),0);
 const rowsHtml=rows.settlements.map(s=>{
  const b=battery(s.battery_id),sale=saleFor(s.battery_id),sts=settlingStatus(s);
  const pick=canPay()&&remaining(s)>0?'<input type="checkbox" data-select-settle="'+s.id+'" aria-label="Selecionar acerto '+esc(batteryDisplay(b))+'" '+(selectedSettle.has(s.id)?'checked':'')+'>':'';
  const actions=canPay()?'<button class="btn tiny secondary" type="button" data-act="single-settlement" data-id="'+s.id+'">Gerenciar</button>':'—';
  return '<tr><td>'+pick+'</td><td><div class="cell-main">'+esc(batteryDisplay(b))+'</div><div class="cell-sub">'+(b?.amperage_ah?esc(b.amperage_ah+' Ah'):'Venda registrada')+'</div></td><td>'+stamp(sale?.sold_at)+'</td><td>'+esc(sale?.customer_name||'—')+'<div class="cell-sub">Venda '+brl(sale?.sale_price_cents||0)+'</div></td><td>'+brl(s.owed_cents)+'</td><td>'+brl(s.paid_cents)+'</td><td>'+brl(remaining(s))+'</td><td>'+statusBadge(sts[0],sts[1])+'</td><td>'+actions+'</td></tr>';
 }).join('');
 const batchesHtml=rows.batches.slice(0,10).map(x=>'<div class="list-entry"><div><strong>Acerto em lote</strong><small>'+stamp(x.settled_at)+' · '+esc(staffName(x.created_by))+' · '+esc(METHODS[x.payment_method]||x.payment_method)+'</small></div><div class="text-right"><strong>'+brl(x.total_paid_cents)+'</strong><small>'+rows.batchItems.filter(y=>y.batch_id===x.id).length+' bateria(s)</small></div></div>').join('')||'<div class="empty">Nenhum lote registrado.</div>';
 return heading('Acertos','Selecione uma ou várias baterias vendidas para confirmar os repasses.',canPay()?'<div class="btn-row">'+button('✓ Acertar selecionadas','batch-settle')+(pending.length?button('🔔 Cobrar WS','remind-ws','secondary'):'')+'</div>':'')+
 '<div class="stat-grid">'+stat('Saldo pendente',brl(total),true)+stat('Baterias pendentes',String(pending.length))+stat('Já recebido · total',brl(rows.settlements.reduce((a,s)=>a+Number(s.paid_cents),0)))+stat('Acertos encerrados',String(rows.settlements.filter(s=>remaining(s)===0).length))+'</div>'+
 panel('Controle por bateria',tbl(['','Bateria','Venda em','Cliente','Repasse','Já pago','Falta','Situação',''],rowsHtml))+
 panel('Últimos acertos em lote','<div class="panel-body lined-list">'+batchesHtml+'</div>')+
 '<div class="note">Apenas Sandro ou administrador podem confirmar pagamentos, corrigir valores ou dispensar cobrança. Cada alteração fica no histórico.</div>';
}
function expenseView(){
 if(!canExpense())return '<div class="note error">Seu perfil não possui acesso a despesas.</div>';
 const isPower=expenseBranch==='power';
 if((isPower&&!canViewPowerExpenses())||(!isPower&&!canViewWSExpenses()))
  return '<div class="note error">Sem permissão para consultar essas despesas.</div>';
 const source=isPower?rows.powerExpenses:rows.expenses;
 const company=isPower?'Power Baterias':'WS Baterias';
 const sum=source.reduce((a,x)=>a+Number(x.amount_cents),0);
 const actions=source.map(x=>{
  const when=x.spent_at?stamp(x.spent_at):dateBR(x.spent_on);
  return '<tr><td>'+when+(x.is_historical?'<div class="cell-sub">Gasto antigo</div>':'')+
   '</td><td>'+esc(CATEGORIES[x.category]||x.category)+'</td><td><strong>'+brl(x.amount_cents)+
   '</strong></td><td>'+esc(x.description)+'</td><td>'+stamp(x.created_at)+
   '<div class="cell-sub">'+esc(staffName(x.created_by))+'</div></td><td>'+
   '<button type="button" class="btn tiny secondary" data-act="edit-expense" data-id="'+x.id+'">Corrigir</button></td></tr>';
 }).join('');
 const switcher=(role==='admin'?
  '<div class="btn-row">'+
  '<button type="button" data-expense-branch="ws" class="btn '+(isPower?'secondary':'')+'">WS Baterias</button>'+
  '<button type="button" data-expense-branch="power" class="btn '+(isPower?'':'secondary')+'">Power Baterias</button></div>':'');
 return heading('Despesas · '+company,
  isPower?'Controle dos gastos próprios da Power. Não altera o lucro da WS.':
          'Gasolina, entregas e outros custos da operação da WS.',
  '<div class="btn-row">'+button('+ Nova despesa','new-expense')+
   button('◷ Gasto antigo','new-historical-expense','secondary')+'</div>')+
 (switcher?'<div class="panel"><div class="panel-body">'+switcher+'</div></div>':'')+
 '<div class="stat-grid">'+stat('Total registrado · '+company,brl(sum),true)+
 stat('Lançamentos',String(source.length))+'</div>'+
 panel('Gastos de '+company,tbl(['Data do gasto','Categoria','Valor','Descrição','Cadastro / Autor',''],actions))+
 '<div class="note">'+(isPower?
  'Esses valores são exclusivos da Power e aparecem separadamente nos relatórios.':
  'Para evitar duplicidade no lucro da WS, não registre como despesa geral um custo já incluído na recuperação da bateria.')+
 '</div>';
}
function reportView() {
 return heading('Relatórios','Fechamento mensal da parceria, atualizado diretamente do banco de dados.',button('↻ Atualizar relatório','fetch-report','secondary'))+
 '<div class="panel"><div class="panel-body filter-row">'+field('Mês de referência','month','month',reportMonth,'id="report-month"')+
 '<button class="btn" type="button" data-act="fetch-report">Consultar mês</button><button class="btn secondary" type="button" data-act="export-csv">Exportar vendas CSV</button></div></div>'+
 '<div id="monthly-report">'+(report?reportSummary(report):'<div class="loading"><span class="loader"></span> Selecione o mês para visualizar os indicadores.</div>')+'</div>'+
 panel('Todas as vendas do mês',tbl(['Data / Hora','Bateria','Cliente','Valor de venda','Repasse','Situação'],rows.sales.filter(s=>stampMonth(s.sold_at)===reportMonth).map(s=>{const st=settleFor(s.battery_id);const b=battery(s.battery_id);const x=settlingStatus(st);return '<tr><td>'+stamp(s.sold_at)+'</td><td>'+esc(batteryDisplay(b))+'</td><td>'+esc(s.customer_name)+'</td><td>'+brl(s.sale_price_cents)+'</td><td>'+brl(st?.owed_cents||0)+'</td><td>'+statusBadge(x[0],x[1])+'</td></tr>';}).join('')));
}
function stampMonth(input){return monthKey(input);}
function reportSummary(r){
 const showWS=role==='ws'||role==='admin';
 const stats=role==='power'?[
  stat('Vendas WS no mês',String(r.sales_count)),stat('Faturamento WS',brl(r.sales_revenue_cents)),
  stat('Recebido pela Power no mês',brl(r.power_received_in_month_cents),true),stat('Saldo pendente atual',brl(r.power_pending_total_now_cents),true)
 ]:[
  stat('Vendas realizadas',String(r.sales_count)),stat('Faturamento do mês',brl(r.sales_revenue_cents)),
  stat('Lucro estimado WS',brl(r.ws_estimated_profit_cents),true),stat('Gastos operacionais WS',brl(r.ws_expenses_cents))
 ];
 return '<div class="stat-grid">'+stats.join('')+'</div>'+
 '<div class="panel"><div class="panel-top"><h3 class="panel-title">Resumo de '+esc(r.month)+'</h3></div><div class="panel-body lined-list">'+
  line('Total devido à Power pelas vendas do mês',brl(r.power_repasse_sales_month_cents))+
  line('Valores pagos à Power neste mês',brl(r.power_received_in_month_cents))+
  line('Baterias deste mês com acerto encerrado',String(r.fully_settled_sales_in_month))+
  (showWS ? line('Custos de recuperação em baterias vendidas',brl(r.recovery_cost_sales_month_cents))+line('Despesas WS lançadas no mês',brl(r.ws_expenses_cents))+
  line('Lucro estimado WS (não contábil)',brl(r.ws_estimated_profit_cents)) : '')+
  ((role==='power'||role==='admin')?line('Despesas próprias da Power no mês',brl(r.power_expenses_cents)):'')+
 '</div></div>'+
 '<div class="note">Lucro estimado = vendas − repasses à Power − custos de recuperação − despesas WS. Esse indicador é operacional, não um demonstrativo contábil ou fiscal. Recebimentos são agrupados pela data efetiva do acerto; vendas pela data de venda.</div>';
}
function line(label,value){return '<div class="list-entry"><span class="muted mini">'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
function warrantyView(){
 const now=Date.now();
 const list=rows.sales.filter(s=>Number(s.warranty_days)>0).map(s=>{
  const expiry=new Date(new Date(s.sold_at).getTime()+Number(s.warranty_days)*86400000);
  const active=expiry.getTime()>=now;
  const b=battery(s.battery_id);
  return '<tr><td>'+esc(batteryDisplay(b))+'</td><td>'+esc(s.customer_name)+'</td><td>'+stamp(s.sold_at)+'</td><td>'+stamp(expiry.toISOString())+'</td><td>'+statusBadge(active?'Ativa':'Vencida',active?'green':'red')+'</td></tr>';
 }).join('');
 return heading('Garantias','A garantia é vinculada à venda e permanece no histórico.')+
 panel('Garantias registradas',tbl(['Bateria','Cliente','Início','Vencimento','Status'],list));
}
function activityView(){
 const events=[
  ...rows.saleRevisions.map(x=>{
    const oldDate=x.before_data?.sale?.sold_at;
    const newDate=x.after_data?.sale?.sold_at;
    const dateChanged=x.action==='corrected'&&oldDate&&newDate&&oldDate!==newDate;
    const b=x.before_data?.battery||x.after_data?.battery;
    return {
      at:x.occurred_at,who:x.actor_id,category:'Venda',
      description:x.action==='cancelled'?'Venda cancelada':
        dateChanged?'Data e horário corrigidos':'Venda corrigida',
      detail:(b?batteryDisplay(b)+' · ':'')+
        (dateChanged?'ANTES: '+stamp(oldDate)+' → DEPOIS: '+stamp(newDate)+' · ':'')+
        'Motivo: '+hideInternalBatteryCodes(x.reason)+
        (x.action==='cancelled'?' · Registro preservado para auditoria':'')
    };
  }),
  ...rows.events.map(x=>({at:x.occurred_at,who:x.actor_id,category:'Acerto',description:({created:'Criado',payment:'Pagamento',payment_correction:'Correção de pagamento',amount_adjustment:'Ajuste de valor',waiver:'Dispensa',reopen:'Reabertura'})[x.action]||x.action,detail:hideInternalBatteryCodes(x.reason)+' · Novo saldo: '+brl(Number(x.new_owed_cents)-Number(x.new_paid_cents)-Number(x.new_waived_cents))})),
  ...rows.activity.map(x=>({at:x.occurred_at,who:x.actor_id,category:'Bateria',description:({received:'Recebida',edited:'Atualizada',sold:'Vendida'})[x.action]||x.action,detail:hideInternalBatteryCodes(x.description)||''})),
  ...rows.powerExpenseEvents.map(x=>({
    at:x.occurred_at,who:x.actor_id,category:'Despesa Power',
    description:x.action==='created'?'Cadastrada':'Corrigida',
    detail:x.reason||''
  })),
  ...rows.expenseEvents.map(x=>({at:x.occurred_at,who:x.actor_id,category:'Despesa',description:x.action==='created'?'Cadastrada':'Corrigida',detail:x.reason+' · '+brl(x.new_amount_cents)}))
 ].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,600);
 const content=events.map(x=>'<tr><td>'+stamp(x.at)+'</td><td>'+statusBadge(x.category,'gray')+'</td><td>'+esc(x.description)+'</td><td>'+esc(x.detail)+'</td><td>'+esc(staffName(x.who))+'</td></tr>').join('');
 return heading('Histórico completo','Cada lançamento, correção, dispensa e acerto com data, hora e autor.')+
 panel('Auditoria da parceria',tbl(['Data / Hora','Área','Ação','Detalhes','Responsável'],content));
}
document.addEventListener('click',async e=>{
 const receiptAction=e.target.closest('[data-receipt-action]');
 if(receiptAction){
  const action=receiptAction.dataset.receiptAction;
  if(!activeReceipt || !api || !['ws','power','admin'].includes(role))return;
  if(action==='print'){window.print();return;}
  receiptAction.disabled=true;
  try{
   if(action==='download'){
     await downloadReceipt(activeReceipt.sale,activeReceipt.battery);
     toast('Notinha da WS Baterias salva em PDF.');
   }else if(action==='share'){
     const result=await shareReceipt(activeReceipt.sale,activeReceipt.battery);
     toast(result==='shared'?'Comprovante encaminhado para compartilhamento.':
       'PDF salvo. Anexe o arquivo à conversa do cliente.');
   }
  }catch(err){
   if(err?.name!=='AbortError')toast('Erro ao gerar comprovante: '+explain(err),'error');
  }finally{receiptAction.disabled=false;}
  return;
 }
 const branch=e.target.closest('[data-expense-branch]');
 if(branch && canExpense()){
   const next=branch.dataset.expenseBranch;
   if((next==='ws'&&canViewWSExpenses())||(next==='power'&&canViewPowerExpenses())){
     expenseBranch=next;render();
   }
   return;
 }
 const view=e.target.closest('[data-view]');
 if(view) {
  const next=view.dataset.view;
  if(next==='expenses'&&!canExpense())return;
  current=next;report=null;render();window.scrollTo({top:0,behavior:'smooth'});
  if(next==='reports')void fetchReport();
  return;
 }
 const btn=e.target.closest('[data-act]');
 if(!btn || !api)return;
 const act=btn.dataset.act;
 if(act==='refresh'){await loadAll(false);return;}
 if(!ready)return;
 if(titles[act]){current=act;report=null;render();if(act==='reports')void fetchReport();return;}
 try {
  if(act==='refresh')await loadAll(true);
  if(act==='new-sale')openSale();
  if(act==='discard-sale-draft')await discardSaleDraft();
  if(act==='ws-receipt')await openWSReceiptById(btn.dataset.id);
  if(act==='new-historical-sale')openSale(true);
  if(act==='edit-sale')openEditSale(rows.sales.find(s=>s.id===btn.dataset.id));
  if(act==='cancel-sale')openCancelSale(rows.sales.find(s=>s.id===btn.dataset.id));
  if(act==='single-settlement')openSettlement(rows.settlements.find(x=>x.id===btn.dataset.id));
  if(act==='batch-settle')openBatch();
  if(act==='remind-ws')await remindWS();
  if(act==='new-expense')openExpense();
  if(act==='new-historical-expense')openExpense(null,true);
  if(act==='edit-expense')openExpense((expenseBranch==='power'?rows.powerExpenses:rows.expenses).find(x=>x.id===btn.dataset.id));
  if(act==='fetch-report')await fetchReport();
  if(act==='export-csv')exportSales();
 }catch(err){toast(explain(err),'error');}
});
document.addEventListener('change',e=>{
 if(e.target.matches('[data-select-settle]')){
  const id=e.target.dataset.selectSettle;
  if(e.target.checked)selectedSettle.add(id);else selectedSettle.delete(id);
 }
 if(e.target.id==='report-month'){
  reportMonth=e.target.value;report=null;render();void fetchReport();
 }
});
function openSale(historical=false,restored=null){
 if(historical?!canBackdateSale():!canSell())
  return toast('Seu perfil não pode registrar este tipo de venda.','error');
 const kind=draftMode(historical);
 if(activeSaleDraft?.dirty)void persistSaleDraft();
 const draft=restored||draftCache[kind];
 const requestId=draft?.request_id||crypto.randomUUID();
 const body='<form id="sale-form" class="field-grid">'+
 (historical?'<div class="note wide"><b>Venda antiga</b><br>Use a data e hora reais da venda, no horário de Brasília. O cadastro será registrado separadamente.</div>':'')+
 '<div class="note wide"><b>Data e hora da venda</b><br>Se aconteceu agora, deixe em branco e o servidor registrará automaticamente. Se já aconteceu, informe o dia e horário reais. A data de cadastro e o usuário ficam preservados.</div>'+
 field('Data e hora reais da venda (opcional para venda de hoje)','sold_when','datetime-local','','max="'+brazilLocalNow()+'" '+(historical?'required':'')+' class="wide"')+
 '<div class="field wide"><span class="eyebrow">Dados da bateria vendida</span></div>'+
 field('Marca da bateria','brand','text','','maxlength="100" required')+
 field('Modelo / Tipo','model','text','','maxlength="120" required')+
 field('Amperagem (Ah, opcional)','amperage','number','','min="1" max="500" step="1"')+
 field('Número de série (opcional)','serial','text','','maxlength="120"')+
 field('Valor da venda (R$)','price','number','','min="0.01" step="0.01" required inputmode="decimal"')+
 field('Valor devido ao Sandro (R$)','transfer','number','','min="0.01" step="0.01" required inputmode="decimal"')+
 field('Gasto com recuperação (R$)','recovery','number','0.00','min="0" step="0.01" required inputmode="decimal"')+
 '<div class="field wide"><span class="eyebrow">Cliente e garantia</span></div>'+
 field('Nome do cliente','customer','text','','maxlength="160" required')+
 field('Telefone (opcional)','phone','tel','','maxlength="30"')+
 field('Placa (opcional)','plate','text','','maxlength="15"')+
 selectField('Forma de pagamento','method',[['pix','PIX'],['cash','Dinheiro'],['card','Cartão'],['other','Outro']],'pix')+
 field('Garantia em dias','warranty','number','30','min="0" max="365" step="1" required')+
 (historical?'<div class="field wide"><span class="eyebrow">Acerto já realizado (se houver)</span><span class="muted mini">Se ainda não pagou ao Sandro, deixe R$ 0,00. Se já pagou, informe quanto e quando foi.</span></div>'+
 field('Valor já pago ao Sandro (R$)','already_paid','number','0.00','min="0" step="0.01" required')+
 field('Data e hora do pagamento antigo (Brasília)','paid_when','datetime-local','','max="'+brazilLocalNow()+'"'):'')+
 '<label class="field wide"><span>Observações</span><textarea name="notes" maxlength="1200"></textarea></label></form>'+
 '<div class="sale-draft-bar"><span data-sale-draft-status>Rascunho protegido: os campos são salvos na sua conta por até '+SALE_DRAFT_MINUTES+' minutos.</span>'+
 '<button class="btn tiny secondary" type="button" data-act="discard-sale-draft">Descartar rascunho</button></div>'+
 (historical?'<div class="note" style="margin-top:15px">A venda entra no relatório do mês em que ocorreu; pagamentos informados entram no mês em que foram realizados. O histórico registra o lançamento feito agora.</div>':
 '<div class="note" style="margin-top:15px">A venda, o cliente, o horário e o acerto pendente serão registrados juntos no banco.</div>');
 modal(historical?'Lançar venda antiga':'Registrar venda',body,
 '<button class="btn secondary" data-modal-close type="button">Voltar</button>'+
 '<button type="submit" class="btn" form="sale-form">✓ Salvar venda</button>');
 const saleForm=$('#sale-form');
 if(draft?.form_data && typeof draft.form_data==='object'){
  for(const [name,value] of Object.entries(draft.form_data)){
   const control=saleForm.elements.namedItem(name);
   if(control && (control instanceof HTMLInputElement ||
       control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) &&
       typeof value==='string')control.value=value;
  }
 }
 activeSaleDraft={kind,requestId,userId:user.id,form:saleForm,dirty:false,discarded:false};
 if(draft?.form_data)draftStatus('✓ Rascunho recuperado. Continue preenchendo normalmente.');
 saleForm.addEventListener('input',queueDraftSave);
 saleForm.addEventListener('change',queueDraftSave);
 $('#sale-form').addEventListener('submit',e=>{
  e.preventDefault();
  try{
   const d=Object.fromEntries(new FormData(e.currentTarget));
   const args={
    p_request_id:requestId,p_brand:d.brand,p_model:d.model,
    p_amperage_ah:d.amperage?Number(d.amperage):null,p_serial_number:d.serial||null,
    p_transfer_price_cents:cents(d.transfer),p_recovery_cost_cents:cents(d.recovery),
    p_sale_price_cents:cents(d.price),p_customer_name:d.customer,
    p_payment_method:d.method,p_warranty_days:Number(d.warranty),
    p_customer_phone:d.phone||null,p_vehicle_plate:d.plate||null,p_notes:d.notes||null
   };
   const customDate=!!d.sold_when;
   if(historical && !customDate)throw new Error('Informe a data e a hora da venda antiga.');
   if(customDate){
    if(d.sold_when > brazilLocalNow())
      throw new Error('A venda não pode ter data ou hora futuras.');
    args.p_sold_at_local=d.sold_when;
   }
   if(historical){
    const paid=cents(d.already_paid);
    if(paid>cents(d.transfer))throw new Error('O valor já pago não pode superar o devido ao Sandro.');
    if(paid>0&&!d.paid_when)throw new Error('Informe a data e a hora do pagamento antigo.');
    if(paid===0&&d.paid_when)throw new Error('Informe o valor pago ou apague a data do pagamento.');
    if(d.paid_when&&d.paid_when<d.sold_when)throw new Error('O acerto não pode ocorrer antes da venda.');
    args.p_prior_paid_cents=paid;
    args.p_paid_at_local=d.paid_when||null;
   }
   void runRpc((historical||customDate)?'register_historical_battery_sale':'register_direct_battery_sale',
    (historical||customDate)?{
      ...args,
      p_prior_paid_cents:args.p_prior_paid_cents??0,
      p_paid_at_local:args.p_paid_at_local??null
    }:args,
    (historical||customDate)?'Venda salva com a data e hora informadas, e acerto atualizado.':
     'Venda registrada com horário do servidor e acerto pendente.',
    async saleId=>{
      await forgetSaleDraft(kind);
      await openWSReceiptById(saleId);
    });
  }catch(err){toast(explain(err),'error');}
 });
}
function openEditSale(s){
 if(!canEditSale(s))
  return toast('Você não tem permissão para corrigir essa venda.','error');
 const b=battery(s.battery_id);
 if(!b)return toast('Dados da bateria não encontrados.','error');
 const body='<div class="note">Corrigir a venda da bateria '+esc(batteryDisplay(b))+'. <b>A data e hora em que a venda aconteceu podem ser alteradas.</b> O horário do cadastro e o responsável originais continuam preservados. Toda correção exige motivo e fica no histórico. O repasse ao Sandro é ajustado na aba Acertos.</div>'+
 '<form id="edit-sale-form" class="field-grid" style="margin-top:16px">'+
 field('Data e hora da venda (Brasília)','sold_when','datetime-local',
   brazilInputDateTime(s.sold_at),'required max="'+brazilLocalNow()+'" class="wide"')+
 '<div class="note wide">Cadastrada originalmente em '+stamp(s.recorded_at||s.sold_at)+
  '. Uma mudança da data da venda afetará o mês do relatório e o início da garantia, sem apagar o registro original.</div>'+
 field('Marca','brand','text',b.brand,'maxlength="100" required')+
 field('Modelo','model','text',b.model,'maxlength="120" required')+
 field('Amperagem (Ah)','amperage','number',b.amperage_ah||'','min="1" max="500" step="1"')+
 field('Número de série','serial','text',b.serial_number||'','maxlength="120"')+
 field('Valor da venda (R$)','price','number',fromCents(s.sale_price_cents),'min="0.01" step="0.01" required')+
 field('Custo de recuperação (R$)','recovery','number',fromCents(b.recovery_cost_cents),'min="0" step="0.01" required')+
 field('Cliente','customer','text',s.customer_name,'maxlength="160" required')+
 field('Telefone','phone','tel',s.customer_phone||'','maxlength="30"')+
 field('Placa','plate','text',s.vehicle_plate||'','maxlength="15"')+
 selectField('Pagamento','method',[['pix','PIX'],['cash','Dinheiro'],['card','Cartão'],['other','Outro']],s.payment_method)+
 field('Garantia (dias)','warranty','number',s.warranty_days,'min="0" max="365" required')+
 '<label class="field wide"><span>Observações</span><textarea name="notes" maxlength="1200">'+esc(s.notes||'')+'</textarea></label>'+
 '<label class="field wide"><span>Motivo da correção (obrigatório)</span><textarea name="reason" minlength="5" maxlength="500" required placeholder="Ex.: valor digitado errado no lançamento"></textarea></label>'+
 '</form>';
 modal('Corrigir venda',body,'<button class="btn secondary" data-modal-close type="button">Voltar</button><button class="btn" form="edit-sale-form" type="submit">Salvar correção</button>');
 $('#edit-sale-form').addEventListener('submit',e=>{
  e.preventDefault();
  try{
   const d=Object.fromEntries(new FormData(e.currentTarget));
   if(d.reason.trim().length<5)throw Error('Informe um motivo com pelo menos 5 caracteres.');
   const patch={
    brand:d.brand,model:d.model,amperage_ah:d.amperage?Number(d.amperage):null,
    serial_number:d.serial,customer_name:d.customer,customer_phone:d.phone,
    vehicle_plate:d.plate,sale_price_cents:cents(d.price),
    recovery_cost_cents:cents(d.recovery),payment_method:d.method,
    warranty_days:Number(d.warranty),notes:d.notes
   };
   patch.sold_at_local=d.sold_when;
   void runRpc('correct_used_battery_sale',{
    p_sale_id:s.id,p_patch:patch,p_reason:d.reason.trim()
   },'Correção salva com data, hora e responsável no histórico.');
  }catch(err){toast(explain(err),'error');}
 });
}
function openCancelSale(s){
 if(!s||role!=='admin')return toast('Somente administrador pode cancelar vendas.','error');
 const b=battery(s.battery_id),st=settleFor(s.battery_id);
 const paid=Number(st?.paid_cents||0)+Number(st?.waived_cents||0);
 const warning=paid>0?'<div class="note warn" style="margin-bottom:14px">Existe pagamento ou dispensa associado. O sistema não permitirá cancelar até a situação financeira ser corrigida e conciliada.</div>':'';
 const body=warning+'<div class="note error"><b>Cancelamento administrativo</b><br>Venda de '+esc(batteryDisplay(b))+' no valor de '+brl(s.sale_price_cents)+'. Depois de cancelada, sairá do painel e dos relatórios, mas ficará guardada no histórico. Nenhum dinheiro será estornado automaticamente.</div>'+
 '<form id="cancel-sale-form" class="field-grid" style="margin-top:18px">'+
 '<label class="field wide"><span>Motivo obrigatório</span><textarea name="reason" maxlength="500" minlength="5" required placeholder="Ex.: lançamento fictício ou duplicado"></textarea></label>'+
 field('Digite CANCELAR para confirmar','confirm','text','','required autocomplete="off" class="wide"')+'</form>';
 modal('Cancelar venda',body,'<button class="btn secondary" type="button" data-modal-close>Voltar</button><button class="btn danger" type="submit" form="cancel-sale-form">Cancelar lançamento</button>');
 $('#cancel-sale-form').addEventListener('submit',e=>{
  e.preventDefault();
  const d=Object.fromEntries(new FormData(e.currentTarget));
  if(d.confirm.trim()!=='CANCELAR')return toast('Digite CANCELAR exatamente para confirmar.','error');
  if(d.reason.trim().length<5)return toast('Descreva o motivo.','error');
  void runRpc('cancel_used_battery_sale',{
   p_sale_id:s.id,p_reason:d.reason.trim()
  },'Venda cancelada e removida dos totais; histórico preservado.');
 });
}

function openSettlement(s) {
 if(!canPay())return toast('Somente Sandro ou administrador podem gerenciar acertos.','error');
 if(!s)return;
 const b=battery(s.battery_id),sts=settlingStatus(s);
 const opts=[
 ['payment','Registrar pagamento recebido'],
 ['adjust_owed','Alterar valor que Sandro deve receber'],
 ['waive','Dispensar saldo pendente'],
 ['correct_paid','Corrigir pagamento registrado'],
 ['reopen','Reabrir valor dispensado']
 ];
 const body='<div class="note">Bateria <b>'+esc(batteryDisplay(b))+'</b> · Status: <b>'+sts[0]+'</b> · Total: <b>'+brl(s.owed_cents)+'</b> · Pago: <b>'+brl(s.paid_cents)+'</b> · Pendente: <b>'+brl(remaining(s))+'</b></div>'+
 '<form id="settlement-form" class="field-grid" style="margin-top:16px">'+
 selectField('Operação','action',opts,remaining(s)?'payment':'adjust_owed','id="settlement-action"')+
 field('Valor da operação (R$)','amount','number',fromCents(remaining(s)),'step="0.01" min="0"')+
 '<label class="field wide"><span>Justificativa (obrigatória para correção, edição e dispensa)</span><textarea name="reason" maxlength="400"></textarea></label></form>'+
 '<div class="note warn" style="margin-top:15px">Correção de pagamento permite valor negativo (ex.: -10,00 para diminuir o pago). Para dispensar ou reabrir, o valor é ignorado. Toda mudança deixa registro de data, hora e responsável.</div>';
 modal('Gerenciar acerto',body,'<button class="btn secondary" type="button" data-modal-close>Cancelar</button><button class="btn" type="submit" form="settlement-form">Confirmar alteração</button>');
 const action=$('#settlement-action');
 action.addEventListener('change',()=>{
  const amount=$('#settlement-form [name=amount]');
  amount.disabled=['waive','reopen'].includes(action.value);
  amount.min=action.value==='correct_paid'?'':action.value==='adjust_owed'?'0.01':'0';
  if(action.value==='adjust_owed')amount.value=fromCents(s.owed_cents);
  if(action.value==='payment')amount.value=fromCents(remaining(s));
 });
 $('#settlement-form').addEventListener('submit',e=>{
  e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));
  if(['adjust_owed','waive','correct_paid','reopen'].includes(d.action)&&d.reason.trim().length<5) return toast('Informe a justificativa com pelo menos 5 caracteres.','error');
  let value=null;
  if(!['waive','reopen'].includes(d.action)){
   if(d.action==='correct_paid'){
    const n=Number(String(d.amount||'').replace(',','.'));
    if(!Number.isFinite(n)||n===0)return toast('Informe o valor de correção diferente de zero.','error');
    value=Math.sign(n)*cents(String(Math.abs(n)));
   }else value=cents(d.amount);
  }
  void runRpc('manage_used_settlement',{p_settlement_id:s.id,p_action:d.action,p_amount_cents:value,p_reason:d.reason||null},'Acerto atualizado com registro de auditoria.');
 });
}

async function remindWS(){
 if(!canPay())return toast('Somente Sandro ou administrador podem cobrar acertos.','error');
 const targetIds=[...selectedSettle].filter(id=>rows.settlements.some(s=>s.id===id&&remaining(s)>0));
 const selected=targetIds.length>0;
 const pending=rows.settlements.filter(s=>remaining(s)>0&&(selected?targetIds.includes(s.id):true));
 if(!pending.length)return toast('Não existem baterias pendentes para cobrar.','error');
 const total=pending.reduce((sum,x)=>sum+remaining(x),0);
 const ok=confirm('Enviar lembrete ao Wanderson sobre '+pending.length+
   ' bateria(s) pendente(s), somando '+brl(total)+'?');
 if(!ok)return;
 try{
  const {error}=await api.rpc('pbws_remind_ws',{
    p_settlement_ids:selected?targetIds:null
  });
  if(error)throw error;
  toast('Lembrete registrado para Wanderson. O aviso no celular depende das notificações ativadas.');
 }catch(err){toast(explain(err),'error');}
}

function openBatch(){
 if(!canPay())return toast('Seu perfil não pode efetuar acertos.','error');
 const ss=rows.settlements.filter(s=>selectedSettle.has(s.id)&&remaining(s)>0);
 if(!ss.length)return toast('Selecione pelo menos uma bateria pendente na tabela.','error');
 if(ss.length>100)return toast('Selecione no máximo 100 baterias por lote.','error');
 const items=ss.map(s=>{
  const b=battery(s.battery_id),old=remaining(s);
  return '<div class="batch-item" data-settle-item="'+s.id+'"><div class="batch-item-head"><div><strong>'+esc(batteryDisplay(b))+'</strong><div class="cell-sub">Pendente: '+brl(old)+' · Pago antes: '+brl(s.paid_cents)+'</div></div>'+statusBadge('Selecionada','yellow')+'</div><div class="batch-item-fields">'+
  field('Novo valor total para Sandro','owed','number',fromCents(s.owed_cents),'min="0.01" step="0.01" required')+
  field('Recebido agora (R$)','paid','number',fromCents(old),'min="0" step="0.01" required')+
  '<label class="field wide"><span><input type="checkbox" name="waive" style="width:auto;min-height:0;vertical-align:middle"> Dispensar eventual saldo restante</span></label>'+
  field('Motivo de ajuste/dispensa','reason','text','','maxlength="400" class="wide"')+'</div></div>';
 }).join('');
 const body='<div class="note">Este acerto será feito em <b>um único lote</b>. Se qualquer bateria falhar, nada será pago. Cada item terá data/hora e auditoria.</div>'+
 '<form id="batch-form" style="margin-top:16px">'+
 '<div class="batch-list">'+items+'</div><div class="batch-total"><span>Recebimento agora</span><strong id="batch-total">'+brl(ss.reduce((a,s)=>a+remaining(s),0))+'</strong></div>'+
 '<div class="field-grid">'+selectField('Recebimento','method',[['pix','PIX'],['cash','Dinheiro'],['transfer','Transferência'],['other','Outro']],'pix')+
 field('Referência do pagamento','reference','text','','maxlength="150"')+
 '<label class="field wide"><span>Observação geral</span><textarea name="notes" maxlength="500"></textarea></label></div></form>';
 modal('Acertar '+ss.length+' bateria(s)',body,'<button type="button" class="btn secondary" data-modal-close>Cancelar</button><button type="submit" class="btn" form="batch-form">✓ Confirmar lote</button>');
 $('#batch-form').addEventListener('input',()=>{
  let sum=0;for(const item of $$('[data-settle-item]')){const v=Number($('[name=paid]',item).value);if(Number.isFinite(v)&&v>=0)sum+=Math.round(v*100);}
  $('#batch-total').textContent=brl(sum);
 });
 $('#batch-form').addEventListener('submit',e=>{
  e.preventDefault();
  let itemsOut;
  try{itemsOut=$$('[data-settle-item]').map(el=>{
   const id=el.dataset.settleItem;
   const old=rows.settlements.find(s=>s.id===id);
   const owed=cents($('[name=owed]',el).value);
   const paid=cents($('[name=paid]',el).value);
   const waive=$('[name=waive]',el).checked;
   const reason=$('[name=reason]',el).value.trim();
   if(owed!==Number(old.owed_cents)||waive){if(reason.length<5)throw new Error('Informe o motivo do ajuste/dispensa em cada bateria.');}
   const rest=owed-Number(old.paid_cents)-Number(old.waived_cents)-paid;
   if(rest<0)throw new Error('Pagamento maior que o saldo da bateria.');
   if(rest>0&&!waive)throw new Error('O lote deve quitar totalmente cada bateria. Marque dispensa para o restante, ou altere o valor pago.');
   return {settlement_id:id,new_owed_cents:owed,paid_now_cents:paid,waive_remaining:waive,reason};
  });}catch(err){toast(explain(err),'error');return;}
  const d=Object.fromEntries(new FormData(e.currentTarget));
  const sum=itemsOut.reduce((a,x)=>a+x.paid_now_cents,0);
  if(!confirm('Confirmar o recebimento de '+brl(sum)+' para '+itemsOut.length+' bateria(s)? Esta ação ficará registrada.'))return;
  void runRpc('settle_used_batteries_batch',{p_items:itemsOut,p_payment_method:d.method,p_reference:d.reference||null,p_notes:d.notes||null},'Acerto em lote confirmado e registrado no histórico.');
 });
}
function openExpense(x=null,historical=false){
 if(!canExpense())return toast('Seu perfil não pode registrar despesas.','error');
 const power=expenseBranch==='power';
 if((power&&!canViewPowerExpenses())||(!power&&!canViewWSExpenses()))
  return toast('Sua conta não tem acesso às despesas desta empresa.','error');
 const creating=!x,today=dayKey(new Date());
 const category=power?'Power Baterias':'WS Baterias';
 const body='<div class="note">Empresa: <b>'+category+'</b>. As despesas de cada empresa são contabilizadas separadamente. O horário do cadastro fica registrado automaticamente.</div>'+
 '<form id="expense-form" class="field-grid" style="margin-top:14px">'+
 (creating?selectField('Categoria','category',Object.entries(CATEGORIES),'gasoline'):'')+
 ((creating||power)?
   field(historical?'Data real do gasto':'Data do gasto','spent','date',
     x?.spent_on||(historical?'':today),'required max="'+today+'"')+
   ((historical||power)?field('Horário do gasto (opcional)','spent_time','time',
     x?.spent_at?new Intl.DateTimeFormat('en-GB',{timeZone:BR_TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(x.spent_at)):'',
     ''):'')
  :'')+
 field(creating?'Valor gasto (R$)':'Valor corrigido (R$)','amount','number',fromCents(x?.amount_cents||0),'min="0.01" step="0.01" required')+
 ((creating||power)?
   field('Descrição','description','text',x?.description||'','maxlength="300" required'):
   '')+
 (!creating?field('Motivo da correção','reason','text','','minlength="5" maxlength="500" required'):'')+
 '</form>';
 modal(creating?(historical?'Lançar gasto antigo':'Registrar despesa'):'Corrigir despesa',
 body,'<button type="button" class="btn secondary" data-modal-close>Voltar</button>'+
 '<button type="submit" class="btn" form="expense-form">Salvar</button>');
 $('#expense-form').addEventListener('submit',e=>{
  e.preventDefault();
  try{
   const d=Object.fromEntries(new FormData(e.currentTarget));
   const amount=cents(d.amount);
   if(amount<=0)throw new Error('Informe um valor maior que zero.');
   const prior=creating&&(historical||d.spent<today);
   let name,args,success;
   if(power){
     const when=d.spent_time?d.spent+'T'+d.spent_time:null;
     if(creating){
      name='register_power_expense';
      args={p_category:d.category,p_amount_cents:amount,p_spent_on:d.spent,
       p_description:d.description,p_spent_at_local:when,p_historical:prior};
      success='Gasto da Power registrado na data correta.';
     }else{
      name='correct_power_expense';
      args={p_expense_id:x.id,p_amount_cents:amount,p_spent_on:d.spent,
       p_description:d.description,p_spent_at_local:when,p_reason:d.reason};
      success='Despesa Power corrigida, com auditoria.';
     }
   }else if(creating){
     name=prior?'register_ws_expense_historical':'register_ws_expense';
     args={p_category:d.category,p_amount_cents:amount,p_spent_on:d.spent,p_description:d.description};
     if(prior)args.p_spent_at_local=d.spent_time?d.spent+'T'+d.spent_time:null;
     success=prior?'Despesa antiga da WS registrada na data correta.':'Despesa da WS registrada.';
   }else{
     name='correct_ws_expense';
     args={p_expense_id:x.id,p_new_amount_cents:amount,p_reason:d.reason};
     success='Despesa WS corrigida com auditoria.';
   }
   void runRpc(name,args,success);
  }catch(err){toast(explain(err),'error');}
 });
}
async function fetchReport(){
 if(!api||!ready)return;
 const month=$('#report-month')?.value||reportMonth;
 if(!/^\d{4}-\d{2}$/.test(month))return toast('Escolha um mês válido.','error');
 reportMonth=month;const slot=$('#monthly-report');
 if(slot)slot.innerHTML='<div class="loading"><span class="loader"></span> Calculando indicadores...</div>';
 try{
  const {data,error}=await api.rpc('get_power_ws_monthly_report',{p_month:month+'-01'});
  if(error)throw error;
  if(current!=='reports')return;
  report=data;
  const here=$('#monthly-report');if(here)here.innerHTML=reportSummary(data);
 }catch(err){if(slot)slot.innerHTML='<div class="note error">'+esc(explain(err))+'</div>';toast(explain(err),'error');}
}
function exportSales(){
 const rs=rows.sales.filter(s=>stampMonth(s.sold_at)===reportMonth);
 if(!rs.length)return toast('Não há vendas para exportar neste mês.','error');
 const csvSafe=x=>{const s=String(x??'');return '"'+( /^[=+\-@\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';};
 const matrix=[['Venda em','Cadastro no sistema','Bateria vendida','Marca','Cliente','Telefone','Placa','Valor venda (R$)','Repasse Power (R$)','Valor pago (R$)','Saldo (R$)','Status','Vendedor','Garantia (dias)']];
 for(const s of rs){
  const b=battery(s.battery_id), st=settleFor(s.battery_id),ss=settlingStatus(st);
  matrix.push([stamp(s.sold_at),stamp(s.recorded_at||s.sold_at),batteryDisplay(b),b?.brand||'',s.customer_name,s.customer_phone||'',s.vehicle_plate||'',fromCents(s.sale_price_cents),fromCents(st?.owed_cents||0),fromCents(st?.paid_cents||0),fromCents(st?remaining(st):0),ss[0],staffName(s.sold_by),s.warranty_days]);
 }
 const content='\uFEFF'+matrix.map(r=>r.map(csvSafe).join(';')).join('\r\n');
 const blob=new Blob([content],{type:'text/csv;charset=utf-8;'});
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='power-ws-vendas-'+reportMonth+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast('Relatório CSV exportado. Proteja os dados dos clientes.');
}
