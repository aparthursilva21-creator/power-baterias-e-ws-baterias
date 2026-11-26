import {receiptHTML,downloadReceipt,shareReceipt,soldBatteryName} from './ws-receipt.js?v=3';
import {SaleDraftStore,SALE_DRAFT_MINUTES} from './sale-drafts.js?v=1';
import {downloadPeriodPDF} from './report-pdf.js?v=3';

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
  ['credits', '◇', 'Créditos'],
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
let rows = { batteries: [], sales: [], settlements: [], batches: [], batchItems: [], expenses: [], events: [], activity: [], expenseEvents: [], staff: [], saleRevisions: [], powerExpenses: [], powerExpenseEvents: [], financialReviews: [], financialReviewEvents: [], vales: [], valeAllocations: [], allSales: [], allSettlements: [], creditEvents: [] };
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
let reportDay = dayKey(new Date());
let reportYear = dayKey(new Date()).slice(0,4);
let reportMode = 'month';
let reportSelection = null;
function utcPlusDay(value,n=1){
 const d=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(d.getTime()))throw Error('Data inválida');
 d.setUTCDate(d.getUTCDate()+n);
 return d.toISOString().slice(0,10);
}
function reportWindow(){
 let start,end,title;
 if(reportMode==='day'){
  if(!/^\d{4}-\d\d-\d\d$/.test(reportDay))throw Error('Informe um dia válido.');
  start=reportDay;end=utcPlusDay(start);
  title='Diário · '+dateBR(start);
 }else if(reportMode==='month'){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(reportMonth))throw Error('Informe um mês válido.');
  start=reportMonth+'-01';end=utcPlusDay(start,32).slice(0,7)+'-01';
  const [year,month]=reportMonth.split('-').map(Number);
  title='Mensal · '+new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'})
   .format(new Date(Date.UTC(year,month-1,1)));
 }else{
  if(!/^\d{4}$/.test(reportYear)||Number(reportYear)<2000||Number(reportYear)>2100)
   throw Error('Informe um ano válido entre 2000 e 2100.');
  start=reportYear+'-01-01';end=(Number(reportYear)+1)+'-01-01';
  title='Anual · '+reportYear;
 }
 if(utcPlusDay(start,0)!==start)throw Error('Data inválida.');
 return {start,endExclusive:end,endInclusive:utcPlusDay(end,-1),title,type:reportMode};
}
function salesInPeriod(period){
 return rows.sales.filter(x=>{const day=dayKey(x.sold_at);
  return day>=period.start&&day<period.endExclusive;});
}
function expensesInPeriod(source,period){
 return source.filter(x=>x.spent_on>=period.start&&x.spent_on<period.endExclusive);
}
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
const canSell = () => role === 'ws';
const canBackdateSale = () => role === 'ws';
const canCancelSale = s => !!s && !s.cancelled_at && ['power','admin'].includes(role);
const canEditSale = s => !!s && !s.cancelled_at && ['power','admin'].includes(role);
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
const appliedVale = (id,key='settlement_id') => rows.valeAllocations.filter(a=>a[key]===id).reduce((sum,a)=>sum+Number(a.amount_cents),0);
const valeBalance = v => v.cancelled_at?0:Math.max(0,Number(v.amount_cents)-appliedVale(v.id,'vale_id'));
const availableVales = () => rows.vales.reduce((sum,v)=>sum+valeBalance(v),0);
const creditTotals=(id=null,key='settlement_id')=>rows.creditEvents.filter(c=>id===null||c[key]===id).reduce((a,c)=>({generated:a.generated+Number(c.generated_cents),used:a.used+Number(c.used_cents)}),{generated:0,used:0});
const creditBalance=()=>{const c=creditTotals();return c.generated-c.used;};
const cashReceived = s => {const c=creditTotals(s.id);return Number(s.paid_cents||0)-appliedVale(s.id)-c.used+c.generated;};
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
  const visible=MENU.filter(x=>x[0]!=='expenses'||canExpense());
  const item=x=>'<button class="nav-action'+(x[0]===current?' active':'')+
    '" data-view="'+x[0]+'" type="button" '+(x[0]===current?'aria-current="page"':'')+
    '><span class="nav-symbol" aria-hidden="true">'+x[1]+'</span><span>'+x[2]+'</span></button>';
  $('#side-nav').innerHTML=visible.map(item).join('');
  // No celular só quatro áreas principais, sem barra horizontal interminável.
  const major=new Set(['dashboard','sales','settlements','reports']);
  const basic=visible.filter(x=>major.has(x[0]));
  const extra=visible.filter(x=>!major.has(x[0]));
  const wasOpen=$('#bottom-nav .nav-more')?.open||false;
  const inExtras=extra.some(x=>x[0]===current);
  $('#bottom-nav').innerHTML=basic.map(item).join('')+
    '<details class="nav-more" '+(wasOpen?'open':'')+'>'+
    '<summary class="nav-more-toggle'+(inExtras?' active':'')+'" aria-label="Mais opções">'+
    '<span class="nav-symbol" aria-hidden="true">⋯</span><span>Mais</span></summary>'+
    '<div class="nav-more-menu">'+extra.map(item).join('')+'</div></details>';
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
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'used_sale_revisions'},syncSoon)
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
  api=null;user=null;role=null;ready=false;report=null;rows={batteries:[],sales:[],settlements:[],batches:[],batchItems:[],expenses:[],events:[],activity:[],expenseEvents:[],staff:[],saleRevisions:[],powerExpenses:[],powerExpenseEvents:[],financialReviews:[],financialReviewEvents:[],vales:[],valeAllocations:[],allSales:[],allSettlements:[],creditEvents:[]};
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
    ['financialReviews',api.from('used_sale_financial_reviews').select('*').order('created_at',{ascending:false})],
    ['financialReviewEvents',api.from('used_sale_financial_review_events').select('*').order('occurred_at',{ascending:false}).limit(500)],
    ['vales',api.from('ws_vales').select('*').order('created_at',{ascending:false})],
    ['valeAllocations',api.from('ws_vale_allocations').select('*')],
    ['creditEvents',api.from('ws_credit_events').select('*').order('occurred_at',{ascending:false})],
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
    rows.allSales=rows.sales;rows.allSettlements=rows.settlements;
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
  nav(); const titlesDetails={dashboard:'A operação em tempo real',sales:'Todas as vendas registradas',settlements:'Valores devidos à Power após as vendas',credits:'Créditos de pagamentos excedentes do Wanderson',expenses:'Custos operacionais da WS',reports:'Fechamento financeiro e indicadores',warranties:'Garantias e prazos registrados',activity:'Registro de alterações e responsáveis'};
  $('#heading').textContent=titles[current] || 'Visão geral';
  $('#subtitle').textContent=titlesDetails[current]||'Controle compartilhado';
  const fn={dashboard:dashboardView,sales:salesView,settlements:settlementView,credits:creditView,expenses:expenseView,reports:reportView,warranties:warrantyView,activity:activityView}[current]||dashboardView;
  $('#app-main').innerHTML='<div class="page-stack">'+fn()+'</div>';
}
function dashboardView() {
 const nowMonth=monthKey(new Date());
 const nowDay=dayKey(new Date());
 const monthSales=rows.sales.filter(s=>monthKey(s.sold_at)===nowMonth);
 const daySales=rows.sales.filter(s=>dayKey(s.sold_at)===nowDay);
 const revenue=monthSales.reduce((a,s)=>a+Number(s.sale_price_cents),0);
 const debt=rows.settlements.reduce((a,s)=>a+remaining(s),0);
 const pending=rows.settlements.filter(s=>remaining(s)>0);
 const salesHtml=rows.sales.slice(0,5).map(s=>{
   const b=battery(s.battery_id),st=settleFor(s.battery_id),status=settlingStatus(st);
   return '<div class="list-entry"><div><strong>'+esc(batteryDisplay(b))+'</strong>'+
    '<small>'+stamp(s.sold_at)+' · '+esc(s.customer_name)+'</small></div>'+
    '<div class="text-right"><strong>'+brl(s.sale_price_cents)+'</strong>'+
    '<small>'+statusBadge(status[0],status[1])+'</small></div></div>';
 }).join('')||'<div class="empty">Nenhuma venda registrada.</div>';
 const pendingHtml=pending.slice(0,5).map(st=>{
   const b=battery(st.battery_id);
   return '<div class="list-entry"><div><strong>'+esc(batteryDisplay(b))+
     '</strong><small>'+esc(saleFor(st.battery_id)?.customer_name||'Cliente não informado')+
     '</small></div><strong>'+brl(remaining(st))+'</strong></div>';
 }).join('')||'<div class="empty">Nenhum acerto pendente.</div>';
 const name=role==='power'?'Sandro':role==='ws'?'Wanderson':'Arthur';
 const desc=role==='power'?'Confira vendas, corrija informações e acompanhe os repasses.':
   role==='ws'?'Registre as vendas da WS e acompanhe os acertos com a Power.':
   'Visão compartilhada da parceria.';
 const primary=role==='power'?button('Ver e editar vendas','sales'):
   role==='ws'?button('+ Registrar uma venda','new-sale'):button('Conferir vendas','sales');
 return heading('Olá, '+name,desc,primary)+
  '<div class="stat-grid stat-grid-simple">'+
  stat('Acertos ainda pendentes',brl(debt),true)+
  stat('Vendas de hoje',String(daySales.length))+
  stat('Vendas neste mês',brl(revenue))+'</div>'+
  '<div class="home-shortcuts">'+
  '<div><strong>O que você precisa fazer?</strong><span>Atalhos para as tarefas do dia.</span></div>'+
  '<div class="btn-row">'+
  button('Conferir vendas','sales','secondary')+
  (canPay()?button('Gerenciar acertos','settlements','secondary'):'')+
  button('Abrir notificações','open-notifications','secondary')+
  '</div></div>'+
  '<div class="grid-2">'+
  panel('Últimas vendas','<div class="panel-body lined-list">'+salesHtml+'</div>',
    button('Ver todas','sales','secondary tiny'))+
  panel('Acertos a conferir','<div class="panel-body lined-list">'+pendingHtml+'</div>',
    button('Abrir acertos','settlements','secondary tiny'))+'</div>'+
  (rows.financialReviews.some(x=>x.status==='pending')?
   '<div class="note warn">Existem acertos de vendas canceladas que precisam de conferência. '+
    (canPay()?'<button class="btn tiny secondary" data-act="settlements">Abrir acertos</button>':
      'O Sandro precisa conferir o financeiro.')+'</div>':'')+
 '<div class="home-help">As vendas são lançadas pela WS. Sandro e Wanderson podem corrigir ou cancelar, '+
  'com motivo registrado no histórico e aviso aos dois. Para receber alertas fora do site, '+
  'abra <strong>Notificações</strong> e ative os avisos neste celular.</div>';
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
 const actions='<div class="row-actions">'+
  (canEditSale(s)?'<button type="button" class="btn tiny secondary" data-act="edit-sale" data-id="'+s.id+'">Editar venda</button>':'')+
  (canCancelSale(s)?'<button type="button" class="btn tiny danger" data-act="cancel-sale" data-id="'+s.id+'">Cancelar venda</button>':'')+
  '</div>';
 const allActions='<div class="row-actions">'+receiptButton+actions+'</div>';
 return '<tr><td><strong>'+stamp(s.sold_at)+'</strong>'+
 (s.is_historical?'<div style="margin-top:4px">'+statusBadge('Venda antiga','gray')+'</div>':'')+
 (dateRevision?'<div style="margin-top:4px">'+statusBadge('Data/hora corrigida','yellow')+'</div>':'')+
 '<div class="cell-sub">Registrada: '+stamp(s.recorded_at||s.sold_at)+' · '+esc(staffName(s.recorded_by||s.sold_by))+'</div></td><td>'+esc(batteryDisplay(b))+'<div class="cell-sub">'+(b?.amperage_ah?esc(b.amperage_ah+' Ah'):'Bateria vendida')+'</div></td><td><div class="cell-main">'+esc(s.customer_name)+'</div><div class="cell-sub">'+esc(s.customer_phone||'Sem telefone')+' · '+esc(s.vehicle_plate||'Sem placa')+'</div></td><td><strong>'+brl(s.sale_price_cents)+'</strong><div class="cell-sub">'+esc(METHODS[s.payment_method]||s.payment_method)+'</div></td><td>'+Number(s.warranty_days)+' dias</td><td>'+statusBadge(sts[0],sts[1])+'</td><td>'+allActions+'</td></tr>';
 }).join('');
 return heading('Vendas','Wanderson registra. Sandro pode corrigir ou cancelar, sempre com motivo e histórico.',
 '<div class="btn-row">'+
 (canSell()?button('+ Venda de hoje','new-sale'):'')+
 (canBackdateSale()?button('◷ Lançar venda antiga','new-historical-sale','secondary'):'')+
 '</div>')+
 '<div class="sales-layout">'+panel('Vendas registradas',tbl(['Data da venda / Cadastro','Bateria','Cliente','Venda','Garantia','Acerto','Ações'],content))+'</div>';
}
function valePanel(){
 const html=rows.vales.map(v=>{
 const used=appliedVale(v.id,'vale_id'),left=valeBalance(v);
 const status=v.cancelled_at?'Cancelado':left===0?'Utilizado':used?'Parcial':'Disponível';
 return '<div class="list-entry"><div><strong>'+esc(v.description)+'</strong><small>'+stamp(v.created_at)+' · '+esc(staffName(v.created_by))+'</small><small>Original: '+brl(v.amount_cents)+' · Utilizado: '+brl(used)+(v.cancelled_at?' · '+esc(v.cancellation_reason):'')+'</small></div><div class="text-right"><strong>'+brl(left)+'</strong><small>'+statusBadge(status,left?'yellow':'gray')+'</small>'+
 (canPay()&&!v.cancelled_at&&!used?'<button class="btn tiny danger" data-act="cancel-vale" data-id="'+v.id+'">Cancelar</button>':'')+'</div></div>';
 }).join('')||'<div class="empty">Nenhum vale registrado.</div>';
 return panel('Vales do Wanderson','<div class="panel-body lined-list"><div class="note"><b>Saldo disponível para descontar: '+brl(availableVales())+'</b><p>Registre um vale e escolha quanto descontar ao fazer o acerto. O valor descontado não conta como dinheiro recebido. Cada vale só pode ser usado até seu saldo.</p></div>'+html+'</div>',canPay()?button('+ Registrar vale','new-vale'):'');
}
function openVale(v=null){
 if(!canPay())return toast('Apenas Sandro ou administrador podem gerenciar vales.','error');
 const cancelling=!!v;
 const body='<form id="vale-form" class="field-grid">'+(cancelling?'<div class="note wide">Cancelar vale de '+brl(v.amount_cents)+': '+esc(v.description)+'</div>':field('Valor do vale (R$)','amount','number','','min="0.01" max="1000000" step="0.01" required'))+
 '<label class="field wide"><span>'+(cancelling?'Motivo do cancelamento':'Descrição do vale')+'</span><textarea name="description" required minlength="'+(cancelling?5:3)+'" maxlength="300" placeholder="Ex.: vale combinado com Wanderson"></textarea></label></form>';
 modal(cancelling?'Cancelar vale':'Registrar vale',body,'<button type="button" class="btn secondary" data-modal-close>Voltar</button><button class="btn" form="vale-form" type="submit">'+(cancelling?'Confirmar cancelamento':'Salvar vale')+'</button>');
 $('#vale-form').addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));
 try{if(cancelling)void runRpc('cancel_ws_vale',{p_vale_id:v.id,p_reason:d.description.trim()},'Vale cancelado e preservado no histórico.');
 else void runRpc('record_ws_vale',{p_amount_cents:cents(d.amount),p_description:d.description.trim()},'Vale registrado. Disponível para desconto nos acertos.');
 }catch(err){toast(explain(err),'error');}});
}
function creditView(){
 const totals=creditTotals(),balance=creditBalance(),vales=availableVales();
 const items=rows.creditEvents.map(c=>{
  const st=rows.allSettlements.find(s=>s.id===c.settlement_id),sale=rows.allSales.find(s=>s.id===st?.sale_id),generated=Number(c.generated_cents)>0;
  return '<div class="list-entry"><div style="min-width:0"><strong>'+esc((generated?'Crédito gerado por ':'Crédito utilizado por ')+staffName(c.actor_id))+'</strong><small>'+esc(batteryDisplay(battery(st?.battery_id)))+' · '+esc(sale?.customer_name||'Cliente não informado')+'</small><small>'+stamp(c.occurred_at)+(sale?.cancelled_at?' · Venda cancelada: conferir acerto':'')+'</small></div><div class="text-right"><strong>'+(generated?'+':'−')+brl(generated?c.generated_cents:c.used_cents)+'</strong><small>'+esc(generated?'Pagamento excedente':'Desconto no acerto')+'</small></div></div>';
 }).join('');
 return heading('Créditos do Wanderson','Dinheiro pago a mais fica guardado para um próximo acerto.',button('Ir para acertos','settlements','secondary'))+
 '<div class="stat-grid">'+stat('Crédito disponível',brl(balance),true)+stat('Crédito gerado · total',brl(totals.generated))+stat('Crédito usado · total',brl(totals.used))+stat('Vales ainda disponíveis',brl(vales))+stat('Crédito menos vales',brl(balance-vales))+'</div>'+
 '<div class="note">O crédito é usado somente quando Sandro informa um desconto no acerto. Vales e créditos permanecem separados; a diferença exibida é um indicador, não uma baixa automática.</div>'+
 panel('Movimentações de crédito','<div class="panel-body lined-list">'+(items||'<div class="empty">Nenhum crédito movimentado.</div>')+'</div>');
}
function settlementView() {
 const pending=rows.settlements.filter(x=>remaining(x)>0);
 const openReviews=rows.financialReviews.filter(x=>x.status==='pending');
 const recentReviews=rows.financialReviews.filter(x=>x.status==='resolved').slice(0,5);
 const reviewRow=r=>{
  const revision=rows.saleRevisions.find(x=>x.sale_id===r.sale_id&&x.action==='cancelled');
  const original=revision?.before_data?.sale;
  const bat=original?battery(original.battery_id):null;
  return '<div class="list-entry"><div><strong>'+esc(batteryDisplay(bat))+
   '</strong><small>Cliente: '+esc(original?.customer_name||'—')+
   ' · Cancelada: '+stamp(r.created_at)+'</small>'+
   '<small>Acerto anterior: '+brl(r.paid_at_cancellation_cents)+' (vales: '+brl(appliedVale(r.settlement_id))+')'+
   ' · Dispensa: '+brl(r.waived_at_cancellation_cents)+
   (r.batch_related?' · Acerto em lote':'')+'</small></div>'+
   (r.status==='pending'?(canPay()?
    '<button type="button" class="btn tiny secondary" data-act="resolve-financial-review" data-id="'+r.id+'">Conferir</button>':
    statusBadge('Aguardando Sandro','yellow')):statusBadge('Conferido','green'))+'</div>';
 };
 const reviewsPanel=(openReviews.length||recentReviews.length)?
   panel('Conciliação de vendas canceladas',
     '<div class="panel-body lined-list">'+
     (openReviews.length?
       '<div class="note warn">Há '+openReviews.length+
       ' acerto(s) de venda cancelada aguardando conferência. Os pagamentos antigos continuam no histórico.</div>'+
       openReviews.map(reviewRow).join(''):
       '<div class="note success">Nenhuma conciliação pendente.</div>')+
     (recentReviews.length?'<details class="simple-details"><summary>Conferências anteriores</summary>'+
       recentReviews.map(reviewRow).join('')+'</details>':'')+'</div>'):'';

 const total=pending.reduce((a,x)=>a+remaining(x),0);
 const rowsHtml=rows.settlements.map(s=>{
  const b=battery(s.battery_id),sale=saleFor(s.battery_id),sts=settlingStatus(s);
  const pick=canPay()&&remaining(s)>0?'<input type="checkbox" data-select-settle="'+s.id+'" aria-label="Selecionar acerto '+esc(batteryDisplay(b))+'" '+(selectedSettle.has(s.id)?'checked':'')+'>':'';
  const actions=canPay()?'<button class="btn tiny secondary" type="button" data-act="single-settlement" data-id="'+s.id+'">Gerenciar</button>':'—';
  return '<tr><td>'+pick+'</td><td><div class="cell-main">'+esc(batteryDisplay(b))+'</div><div class="cell-sub">'+(b?.amperage_ah?esc(b.amperage_ah+' Ah'):'Venda registrada')+'</div></td><td>'+stamp(sale?.sold_at)+'</td><td>'+esc(sale?.customer_name||'—')+'<div class="cell-sub">Venda '+brl(sale?.sale_price_cents||0)+'</div></td><td>'+brl(s.owed_cents)+'</td><td>'+brl(cashReceived(s))+'<div class="cell-sub">Vale: '+brl(appliedVale(s.id))+' · Crédito usado: '+brl(creditTotals(s.id).used)+' · Gerado: '+brl(creditTotals(s.id).generated)+'</div></td><td>'+brl(remaining(s))+'</td><td>'+statusBadge(sts[0],sts[1])+'</td><td>'+actions+'</td></tr>';
 }).join('');
 const batchesHtml=rows.batches.slice(0,10).map(x=>'<div class="list-entry"><div><strong>Acerto em lote</strong><small>'+stamp(x.settled_at)+' · '+esc(staffName(x.created_by))+' · '+esc(METHODS[x.payment_method]||x.payment_method)+'</small></div><div class="text-right"><strong>'+brl(Number(x.total_paid_cents)-appliedVale(x.id,'batch_id')-creditTotals(x.id,'batch_id').used+creditTotals(x.id,'batch_id').generated)+'</strong><small>Vale: '+brl(appliedVale(x.id,'batch_id'))+'</small><small>Crédito usado: '+brl(creditTotals(x.id,'batch_id').used)+' · Gerado: '+brl(creditTotals(x.id,'batch_id').generated)+'</small><small>'+rows.batchItems.filter(y=>y.batch_id===x.id).length+' bateria(s)</small></div></div>').join('')||'<div class="empty">Nenhum lote registrado.</div>';
 return heading('Acertos','Selecione uma ou várias baterias vendidas para confirmar os repasses.',canPay()?'<div class="btn-row">'+button('✓ Acertar selecionadas','batch-settle')+(pending.length?button('🔔 Cobrar WS','remind-ws','secondary'):'')+'</div>':'')+
 '<div class="stat-grid">'+stat('Saldo pendente',brl(total),true)+stat('Baterias pendentes',String(pending.length))+stat('Já recebido · total',brl(rows.settlements.reduce((a,s)=>a+cashReceived(s),0)))+stat('Acertos encerrados',String(rows.settlements.filter(s=>remaining(s)===0).length))+'</div>'+
 '<div class="panel"><div class="panel-body"><div class="list-entry"><div><strong>Crédito do Wanderson: '+brl(creditBalance())+'</strong><small>Use no acerto ou guarde para depois.</small></div>'+button('Ver créditos','credits','secondary')+'</div></div></div>'+valePanel()+reviewsPanel+
 panel('Controle por bateria',tbl(['','Bateria','Venda em','Cliente','Repasse','Recebido / vale','Falta','Situação',''],rowsHtml))+
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
function reportView(){
 let period;try{period=reportWindow();}catch{return heading('Relatórios','Selecione uma data válida.');}
 const mode=selectField('Tipo de relatório','report_type',
  [['day','Diário'],['month','Mensal'],['year','Anual']],reportMode,'id="report-type"');
 const picker=reportMode==='day'
  ?field('Dia do relatório','report_day','date',reportDay,'id="report-day"')
  :reportMode==='month'
    ?field('Mês do relatório','report_month','month',reportMonth,'id="report-month"')
    :field('Ano do relatório','report_year','number',reportYear,
      'id="report-year" min="2000" max="2100" step="1"');
 const options='<div class="btn-row">'+button('Consultar período','fetch-report')+
  button('Baixar PDF','download-report-pdf','secondary')+
  button('Exportar vendas CSV','export-csv','secondary')+'</div>';
 const sales=salesInPeriod(period);
 const detail=sales.map(s=>{
  const st=settleFor(s.battery_id),status=settlingStatus(st);
  return '<tr><td>'+stamp(s.sold_at)+'</td><td>'+esc(batteryDisplay(battery(s.battery_id)))+
   '</td><td>'+esc(s.customer_name)+'</td><td>'+brl(s.sale_price_cents)+
   '</td><td>'+brl(st?.owed_cents||0)+'</td><td>'+statusBadge(status[0],status[1])+'</td></tr>';
 }).join('');
 return heading('Relatórios','Relatórios por dia, mês e ano, com PDF para baixar.',
  button('↻ Atualizar','fetch-report','secondary'))+
 '<div class="panel"><div class="panel-body"><div class="field-grid">'+mode+picker+
 '</div><div style="margin-top:14px">'+options+'</div></div></div>'+
 '<div id="monthly-report">'+(report&&reportSelection?.start===period.start&&
 reportSelection?.endExclusive===period.endExclusive?
 reportSummary(report,period):
 '<div class="loading"><span class="loader"></span> Consultando dados do período...</div>')+'</div>'+
 panel('Vendas de '+esc(period.title),
  tbl(['Data / Hora','Bateria','Cliente','Venda','Repasse','Situação'],detail))+
 '<div class="note">As datas seguem o fuso de Brasília. Vendas canceladas saem dos totais. '+
 'O saldo pendente atual é geral, não limitado ao período selecionado.</div>';
}
function stampMonth(input){return monthKey(input);}
function reportSummary(r,period=reportWindow()){
 const showWS=role==='ws'||role==='admin';
 const suffix=period.type==='day'?'do dia':period.type==='year'?'do ano':'do mês';
 const stats=role==='power'?[
  stat('Vendas WS '+suffix,String(r.sales_count)),stat('Faturamento WS',brl(r.sales_revenue_cents)),
  stat('Recebido pela Power '+suffix,brl(r.power_received_in_month_cents),true),
  stat('Saldo pendente total atual',brl(r.power_pending_total_now_cents),true)
 ]:[
  stat('Vendas realizadas '+suffix,String(r.sales_count)),
  stat('Faturamento do período',brl(r.sales_revenue_cents)),
  stat('Lucro estimado WS',brl(r.ws_estimated_profit_cents),true),
  stat('Despesas WS do período',brl(r.ws_expenses_cents))
 ];
 return '<div class="stat-grid">'+stats.join('')+'</div>'+
 '<div class="panel"><div class="panel-top"><h3 class="panel-title">'+esc(period.title)+'</h3></div>'+
 '<div class="panel-body lined-list">'+
 line('Total devido à Power por vendas no período',brl(r.power_repasse_sales_month_cents))+
 line('Pagamentos recebidos pela Power no período',brl(r.power_received_in_month_cents))+
 line('Vales descontados no período',brl(r.ws_vales_applied_cents))+
 line('Vales registrados no período',brl(r.ws_vales_registered_cents))+
 line('Créditos gerados no período',brl(r.ws_credit_generated_cents))+
 line('Créditos utilizados no período',brl(r.ws_credit_used_cents))+
 line('Crédito disponível hoje',brl(r.ws_credit_balance_cents))+
 line('Vales disponíveis hoje',brl(r.ws_vale_balance_cents))+
 line('Crédito menos vales · saldo atual',brl(r.ws_credit_minus_vales_cents))+
 line('Desses, referentes a vendas canceladas',brl(r.power_cancelled_receipts_in_period_cents))+
 line('Conciliações pendentes hoje',String(r.financial_reviews_pending_count||0))+
 line('Valor de pagamentos a conferir',brl(r.financial_reviews_pending_paid_cents))+
 line('Vendas do período com acerto encerrado',String(r.fully_settled_sales_in_month))+
 (showWS?line('Recuperação de baterias vendidas no período',brl(r.recovery_cost_sales_month_cents))+
 line('Despesas da WS no período',brl(r.ws_expenses_cents))+
 line('Lucro estimado WS (não contábil)',brl(r.ws_estimated_profit_cents)):'')+
 ((role==='power'||role==='admin')?line('Despesas próprias da Power no período',brl(r.power_expenses_cents)):'')+
 '</div></div>'+
 '<div class="note">Lucro estimado = vendas − repasse − custos de recuperação − despesas WS. '+
 'Esse indicador é operacional e não equivale a um demonstrativo contábil ou fiscal. '+
 'Pagamentos são agrupados pela data efetiva do acerto, e as vendas pela data de realização.</div>';
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
function activityChanges(x){
 const before=x.before_data||{},after=x.after_data||{};
 const fields=[
 ['sale','customer_name','Cliente'],['sale','customer_phone','Telefone'],['sale','vehicle_plate','Placa'],
 ['battery','brand','Marca'],['battery','model','Modelo'],['battery','amperage_ah','Amperagem'],['battery','serial_number','Número de série'],
 ['sale','sale_price_cents','Valor da venda',brl],['battery','recovery_cost_cents','Custo de recuperação',brl],
 ['sale','payment_method','Forma de pagamento',v=>METHODS[v]||v],['sale','warranty_days','Garantia',v=>v+' dias'],
 ['sale','sold_at','Data da venda',stamp],['sale','notes','Observações']
 ];
 return fields.flatMap(([obj,key,label,format])=>{
  const a=before[obj]?.[key],b=after[obj]?.[key];if(a===b)return [];
  const show=v=>v==null||v===''?'Não informado':format?format(v):String(v);
  return [label+': '+show(a)+' → '+show(b)];
 });
}
function activityView(){
 const who=id=>staffName(id);
 const subject=st=>{
  const sale=rows.allSales.find(x=>x.id===st?.sale_id);
  return [batteryDisplay(battery(st?.battery_id)),sale?.customer_name].filter(Boolean).join(' · ');
 };
 const firstRevision=id=>[...rows.saleRevisions].reverse().find(x=>x.sale_id===id)?.before_data;
 const events=[
 ...rows.allSales.map(x=>{
   const original=firstRevision(x.id),sale=original?.sale||x,b=original?.battery||battery(x.battery_id);
   return {at:x.recorded_at||x.sold_at,who:x.recorded_by||x.sold_by,category:'Venda',description:'Venda registrada por '+who(x.recorded_by||x.sold_by),detail:[batteryDisplay(b)+' · Cliente: '+sale.customer_name,'Valor: '+brl(sale.sale_price_cents),...(x.is_historical?['Venda realizada em '+stamp(sale.sold_at)]:[])]};
 }),
 ...rows.saleRevisions.map(x=>{
   const original=x.before_data?.sale||x.before_data||{},b=x.before_data?.battery||x.after_data?.battery||battery(original.battery_id);
   const cancelled=x.action==='cancelled';
   const detail=[batteryDisplay(b)+' · Cliente: '+(original.customer_name||'—'),...(cancelled?['Valor da venda: '+brl(original.sale_price_cents)]:activityChanges(x)),'Motivo: '+(x.reason||'Não informado')];
   if(cancelled&&x.after_data?.financial_review)detail.push('Acerto anterior preservado. Conferência financeira pendente.');
   return {at:x.occurred_at,who:x.actor_id,category:'Venda',description:(cancelled?'Venda cancelada por ':'Venda editada por ')+who(x.actor_id),detail};
 }),
 ...rows.financialReviewEvents.map(x=>({at:x.occurred_at,who:x.actor_id,category:'Acerto',description:(x.event==='opened'?'Conferência de acerto aberta por ':'Conferência concluída por ')+who(x.actor_id),detail:[x.reason||'']})),
 ...rows.events.filter(x=>x.action!=='created').map(x=>{
   const st=rows.allSettlements.find(y=>y.id===x.settlement_id),actor=who(x.actor_id);
   const delta=Number(x.new_paid_cents)-Number(x.old_paid_cents),saldo=Number(x.new_owed_cents)-Number(x.new_paid_cents)-Number(x.new_waived_cents);
   const vale=x.action==='payment'?rows.valeAllocations.filter(a=>a.settlement_id===x.settlement_id&&(x.batch_id?a.batch_id===x.batch_id:!a.batch_id&&new Date(a.applied_at).getTime()===new Date(x.occurred_at).getTime())).reduce((sum,a)=>sum+Number(a.amount_cents),0):0;
   const credits=x.action==='payment'?rows.creditEvents.filter(a=>a.settlement_id===x.settlement_id&&(x.batch_id?a.batch_id===x.batch_id:!a.batch_id&&new Date(a.occurred_at).getTime()===new Date(x.occurred_at).getTime())).reduce((t,a)=>({generated:t.generated+Number(a.generated_cents),used:t.used+Number(a.used_cents)}),{generated:0,used:0}):{generated:0,used:0};
   const labels={payment:saldo===0?'Acerto confirmado por ':'Pagamento parcial registrado por ',historical_payment:'Pagamento antigo registrado por ',payment_correction:'Pagamento corrigido por ',amount_adjustment:'Valor do acerto editado por ',waiver:'Saldo dispensado por ',reopen:'Acerto reaberto por '};
   const detail=[subject(st)];
   if(['payment','historical_payment'].includes(x.action))detail.push('Valor acertado: '+brl(delta),'Vale descontado: '+brl(vale),'Crédito usado: '+brl(credits.used),'Crédito gerado: '+brl(credits.generated),'Dinheiro recebido: '+brl(delta-vale-credits.used+credits.generated));
   if(x.action==='payment_correction')detail.push('Correção do dinheiro recebido: '+brl(delta));
   if(x.action==='amount_adjustment')detail.push('Repasse: '+brl(x.old_owed_cents)+' → '+brl(x.new_owed_cents));
   if(['waiver','reopen'].includes(x.action))detail.push('Valor dispensado: '+brl(x.old_waived_cents)+' → '+brl(x.new_waived_cents));
   detail.push('Saldo pendente: '+brl(saldo));if(x.reason&&!['payment','historical_payment'].includes(x.action))detail.push('Motivo: '+hideInternalBatteryCodes(x.reason));
   return {at:x.occurred_at,who:x.actor_id,category:'Acerto',description:(labels[x.action]||'Acerto atualizado por ')+actor,detail};
 }),
 ...rows.creditEvents.map(c=>({at:c.occurred_at,who:c.actor_id,category:'Crédito',description:(Number(c.generated_cents)>0?'Crédito gerado por ':'Crédito utilizado por ')+who(c.actor_id),detail:[subject(rows.allSettlements.find(s=>s.id===c.settlement_id)),brl(Number(c.generated_cents)||Number(c.used_cents))]})),
 ...rows.vales.flatMap(v=>[{at:v.created_at,who:v.created_by,category:'Vale',description:'Vale registrado por '+who(v.created_by),detail:['Wanderson: '+brl(v.amount_cents),v.description]},...(v.cancelled_at?[{at:v.cancelled_at,who:v.cancelled_by,category:'Vale',description:'Vale cancelado por '+who(v.cancelled_by),detail:[brl(v.amount_cents),'Motivo: '+v.cancellation_reason]}]:[])]),
 ...rows.powerExpenseEvents.map(x=>({at:x.occurred_at,who:x.actor_id,category:'Despesa Power',description:(x.action==='created'?'Despesa registrada por ':'Despesa corrigida por ')+who(x.actor_id),detail:[brl(x.new_amount_cents),x.reason||'']})),
 ...rows.expenseEvents.map(x=>({at:x.occurred_at,who:x.actor_id,category:'Despesa WS',description:(x.action==='created'?'Despesa registrada por ':'Despesa corrigida por ')+who(x.actor_id),detail:[brl(x.new_amount_cents),x.reason||'']}))
 ].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,600);
 const content=events.map(x=>'<article class="list-entry" style="align-items:flex-start"><div style="min-width:0;overflow-wrap:anywhere">'+statusBadge(x.category,'gray')+'<div style="margin-top:6px"><strong>'+esc(x.description)+'</strong></div>'+x.detail.filter(Boolean).map(d=>'<div class="cell-sub" style="white-space:normal;margin-top:4px">'+esc(d)+'</div>').join('')+'<small style="margin-top:8px">'+stamp(x.at)+' · '+esc(who(x.who))+'</small></div></article>').join('');
 return heading('Histórico','Veja o que aconteceu, quem fez e quando.')+panel('Atividades recentes','<div class="panel-body lined-list">'+(content||'<div class="empty">Nenhuma atividade registrada.</div>')+'</div>');
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
  const menu=view.closest('.nav-more');if(menu)menu.open=false;
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
  if(act==='open-notifications')$('#pbws-bell')?.click();
  if(act==='discard-sale-draft')await discardSaleDraft();
  if(act==='ws-receipt')await openWSReceiptById(btn.dataset.id);
  if(act==='new-historical-sale')openSale(true);
  if(act==='edit-sale')openEditSale(rows.sales.find(s=>s.id===btn.dataset.id));
  if(act==='cancel-sale')openCancelSale(rows.sales.find(s=>s.id===btn.dataset.id));
  if(act==='resolve-financial-review')openResolveFinancialReview(rows.financialReviews.find(x=>x.id===btn.dataset.id));
  if(act==='single-settlement')openSettlement(rows.settlements.find(x=>x.id===btn.dataset.id));
  if(act==='batch-settle')openBatch();
  if(act==='new-vale')openVale();
  if(act==='cancel-vale'){const v=rows.vales.find(x=>x.id===btn.dataset.id);if(v)openVale(v);}
  if(act==='remind-ws')await remindWS();
  if(act==='new-expense')openExpense();
  if(act==='new-historical-expense')openExpense(null,true);
  if(act==='edit-expense')openExpense((expenseBranch==='power'?rows.powerExpenses:rows.expenses).find(x=>x.id===btn.dataset.id));
  if(act==='fetch-report')await fetchReport();
  if(act==='export-csv')exportSales();
  if(act==='download-report-pdf')await exportReportPDF();
 }catch(err){toast(explain(err),'error');}
});
document.addEventListener('change',e=>{
 if(e.target.matches('[data-select-settle]')){
  const id=e.target.dataset.selectSettle;
  if(e.target.checked)selectedSettle.add(id);else selectedSettle.delete(id);
 }
 if(e.target.id==='report-type'){
   reportMode=e.target.value;report=null;reportSelection=null;
   // Nao substituir o input enquanto o navegador finaliza o evento blur/change.
   setTimeout(()=>{if(current==='reports'){render();void fetchReport();}},0);
 }
 if(['report-day','report-month','report-year'].includes(e.target.id)){
   if(e.target.id==='report-day')reportDay=e.target.value;
   if(e.target.id==='report-month')reportMonth=e.target.value;
   if(e.target.id==='report-year')reportYear=e.target.value;
   report=null;reportSelection=null;
   setTimeout(()=>{if(current==='reports'){render();void fetchReport();}},0);
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
 const body='<div class="note">Venda: <strong>'+esc(batteryDisplay(b))+
 '</strong> · Registrada por '+esc(staffName(s.sold_by))+
 '. Você pode mudar o nome do cliente e outras informações. A alteração exige motivo e é avisada aos dois.</div>'+
 '<form id="edit-sale-form" class="field-grid" style="margin-top:16px">'+
 '<div class="edit-section-title wide">Dados do cliente</div>'+
 field('Nome do cliente','customer','text',s.customer_name,'maxlength="160" required autocomplete="name"')+
 field('Telefone / WhatsApp','phone','tel',s.customer_phone||'','maxlength="30"')+
 field('Placa do veículo','plate','text',s.vehicle_plate||'','maxlength="15"')+
 '<details id="edit-sale-advanced" class="simple-details wide"><summary>Editar outros dados da venda (valor, bateria, data e garantia)</summary>'+
 '<div class="field-grid" style="margin-top:14px">'+
 field('Data e hora da venda (Brasília)','sold_when','datetime-local',
   brazilInputDateTime(s.sold_at),'required max="'+brazilLocalNow()+'" class="wide"')+
 '<div class="note wide">O horário de cadastro e o responsável original permanecem no histórico. '+
 'Mudar a data da venda altera o relatório e o início da garantia.</div>'+
 field('Marca da bateria','brand','text',b.brand,'maxlength="100" required')+
 field('Modelo da bateria','model','text',b.model,'maxlength="120" required')+
 field('Amperagem (Ah)','amperage','number',b.amperage_ah||'','min="1" max="500" step="1"')+
 field('Número de série','serial','text',b.serial_number||'','maxlength="120"')+
 field('Valor da venda (R$)','price','number',fromCents(s.sale_price_cents),'min="0.01" step="0.01" required')+
 field('Custo de recuperação (R$)','recovery','number',fromCents(b.recovery_cost_cents),'min="0" step="0.01" required')+
 selectField('Forma de pagamento','method',[['pix','PIX'],['cash','Dinheiro'],['card','Cartão'],['other','Outro']],s.payment_method)+
 field('Garantia (dias)','warranty','number',s.warranty_days,'min="0" max="365" required')+
 '<label class="field wide"><span>Observações</span><textarea name="notes" maxlength="1200">'+esc(s.notes||'')+'</textarea></label>'+
 '</div></details>'+
 '<label class="field wide"><span>Por que você está corrigindo esta venda?</span>'+
 '<textarea name="reason" minlength="5" maxlength="500" required placeholder="Ex.: nome do cliente digitado errado"></textarea></label>'+
 '</form>';
 modal('Editar venda',body,'<button class="btn secondary" data-modal-close type="button">Voltar</button><button class="btn" form="edit-sale-form" type="submit">Salvar correção</button>');
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
   if(d.sold_when!==brazilInputDateTime(s.sold_at))patch.sold_at_local=d.sold_when;
   void runRpc('correct_used_battery_sale',{
    p_sale_id:s.id,p_patch:patch,p_reason:d.reason.trim()
   },'Correção salva com data, hora e responsável no histórico.');
  }catch(err){toast(explain(err),'error');}
 });
}
function openCancelSale(s){
 if(!canCancelSale(s))return toast('Sua conta não pode cancelar esta venda.','error');
 const b=battery(s.battery_id),st=settleFor(s.battery_id);
 const hasBatch=rows.batchItems.some(x=>x.settlement_id===st?.id);
 const paid=Number(st?.paid_cents||0);
 const waived=Number(st?.waived_cents||0);
 const needsReview=paid>0||waived>0||hasBatch;
 const canReview=role==='power'||role==='admin';
 const warning=needsReview?'<div class="note warn" style="margin-bottom:14px">'+
  '<b>Acerto anterior identificado</b><div>Dinheiro recebido: <strong>'+brl(st?cashReceived(st):0)+'</strong> · Vales usados: <strong>'+brl(appliedVale(st?.id))+
  '</strong> · Dispensa: '+brl(waived)+(hasBatch?' · Participou de acerto em lote':'')+'.</div>'+
  (canReview?
   '<p>O cancelamento não apaga pagamentos passados nem devolve dinheiro automaticamente. '+
   'Uma <b>pendência de conciliação financeira</b> ficará visível em Acertos até Sandro resolver.</p>':
   '<p>Como esta venda já teve acerto, peça ao Sandro para efetuar o cancelamento com conferência financeira.</p>')+
  '</div>':'';
 const body=warning+'<div class="note"><b>Cancelar registro de venda</b><div>Bateria: '+
  esc(batteryDisplay(b))+' · Cliente: '+esc(s.customer_name)+' · Valor: '+
  brl(s.sale_price_cents)+'</div><p>A venda sairá dos totais e ficará preservada no histórico com o motivo e o responsável.</p></div>'+
 '<form id="cancel-sale-form" class="field-grid" style="margin-top:16px">'+
 '<label class="field wide"><span>Por que esta venda deve ser cancelada?</span>'+
 '<textarea name="reason" maxlength="500" minlength="5" required placeholder="Ex.: venda lançada em duplicidade"></textarea></label>'+
 (needsReview&&canReview?
   '<label class="financial-ack wide"><input type="checkbox" name="acknowledge" value="yes" required>'+
   '<span>Entendo que o pagamento anterior permanece registrado e que o acerto precisará ser conferido depois.</span></label>':'')+
 field('Digite CANCELAR para confirmar','confirm','text','','required autocomplete="off" class="wide"')+'</form>';
 modal('Cancelar venda',body,
 '<button class="btn secondary" type="button" data-modal-close>Voltar</button>'+
 '<button class="btn danger" type="submit" form="cancel-sale-form" '+(needsReview&&!canReview?'disabled':'')+'>Confirmar cancelamento</button>');
 if(needsReview&&!canReview)return;
 $('#cancel-sale-form').addEventListener('submit',e=>{
  e.preventDefault();
  const d=Object.fromEntries(new FormData(e.currentTarget));
  if(d.confirm.trim()!=='CANCELAR')return toast('Digite CANCELAR exatamente para confirmar.','error');
  if(d.reason.trim().length<5)return toast('Descreva o motivo.','error');
  if(needsReview && d.acknowledge!=='yes')
   return toast('Confirme a ciência do acerto financeiro anterior.','error');
  const rpc='cancel_used_battery_sale_with_review';
  const args={p_sale_id:s.id,p_reason:d.reason.trim(),p_acknowledge_financial_history:needsReview&&d.acknowledge==='yes'};
  void runRpc(rpc,args,needsReview?
   'Venda cancelada. Acerto anterior preservado e conciliação pendente em Acertos.':
   'Venda cancelada. Auditoria preservada e ambos avisados.');
 });
}
function openResolveFinancialReview(item){
 if(!item||item.status!=='pending'||!canPay())
  return toast('Somente Sandro ou administrador podem concluir a conferência.','error');
 const related=rows.saleRevisions.find(x=>x.sale_id===item.sale_id&&x.action==='cancelled');
 const oldSale=related?.before_data?.sale;
 const b=oldSale?battery(oldSale.battery_id):null;
 const body='<div class="note warn"><b>Conferência de acerto de venda cancelada</b>'+
 '<p>Bateria: '+esc(batteryDisplay(b))+' · Cliente: '+esc(oldSale?.customer_name||'—')+
 ' · Dinheiro recebido: <strong>'+brl(Number(item.paid_at_cancellation_cents)-appliedVale(item.settlement_id)-creditTotals(item.settlement_id).used+creditTotals(item.settlement_id).generated)+'</strong> · Vales utilizados: <strong>'+brl(appliedVale(item.settlement_id))+
 '</strong>. Esse dinheiro não foi estornado automaticamente.</p></div>'+
 '<form id="resolve-financial-form" class="field-grid" style="margin-top:16px">'+
 selectField('O que aconteceu com o acerto?','resolution_method',[
  ['refunded','Valor devolvido de fato à WS'],
  ['compensated','Valor compensado em outro acerto (manual)'],
  ['record_error','Pagamento registrado incorretamente'],
  ['other','Outra solução, explicada abaixo']
 ],'refunded')+
 '<label class="field wide"><span>Explique a movimentação e informe a referência/comprovante, se houver</span>'+
 '<textarea name="reason" minlength="8" maxlength="500" required placeholder="Ex.: devolução por PIX em 25/11, comprovante conferido"></textarea></label>'+
 '<div class="note wide">Só marque como resolvido depois da conferência real com Wanderson. '+
 'O aplicativo registra sua declaração. Não transfere dinheiro nem reverte créditos ou vales automaticamente.</div></form>';
 modal('Resolver acerto cancelado',body,
 '<button type="button" class="btn secondary" data-modal-close>Voltar</button>'+
 '<button type="submit" class="btn" form="resolve-financial-form">Confirmar conferência</button>');
 $('#resolve-financial-form').addEventListener('submit',e=>{
  e.preventDefault();
  const d=Object.fromEntries(new FormData(e.currentTarget));
  if(d.reason.trim().length<8)return toast('Explique como o acerto foi resolvido.','error');
  void runRpc('resolve_used_sale_financial_review',{
   p_review_id:item.id,p_resolution_method:d.resolution_method,
   p_reason:d.reason.trim()
  },'Conciliação concluída, com responsável e justificativa no histórico.');
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
 const body='<div class="note">Bateria <b>'+esc(batteryDisplay(b))+'</b> · Status: <b>'+sts[0]+'</b> · Total: <b>'+brl(s.owed_cents)+'</b> · Pago: <b>'+brl(cashReceived(s))+'</b> · Vales usados: <b>'+brl(appliedVale(s.id))+'</b> · Pendente: <b>'+brl(remaining(s))+'</b></div>'+
 '<form id="settlement-form" class="field-grid" style="margin-top:16px">'+
 selectField('Operação','action',opts,remaining(s)?'payment':'adjust_owed','id="settlement-action"')+
 field('Valor da operação / dinheiro recebido (R$)','amount','number',fromCents(remaining(s)),'step="0.01" min="0"')+
 '<div id="single-vale-field" '+(remaining(s)?'':'hidden')+'>'+field('Desconto de vale (R$)','vale','number','0.00','step="0.01" min="0" max="'+fromCents(Math.min(remaining(s),availableVales()))+'"')+'<small>Disponível: '+brl(availableVales())+'</small></div>'+
 '<label class="field wide"><span>Justificativa (obrigatória para correção, edição e dispensa)</span><textarea name="reason" maxlength="400"></textarea></label></form>'+
 '<div class="note warn" style="margin-top:15px">Correção de pagamento permite valor negativo (ex.: -10,00 para diminuir o pago). Para dispensar ou reabrir, o valor é ignorado. Toda mudança deixa registro de data, hora e responsável.</div>';
 modal('Gerenciar acerto',body,'<button class="btn secondary" type="button" data-modal-close>Cancelar</button><button class="btn" type="submit" form="settlement-form">Confirmar alteração</button>');
 const action=$('#settlement-action');
 action.addEventListener('change',()=>{
  const amount=$('#settlement-form [name=amount]');
  amount.disabled=['waive','reopen'].includes(action.value);
  $('#single-vale-field').hidden=action.value!=='payment';
  $('#settlement-form [name=vale]').value='0.00';
  amount.min=action.value==='correct_paid'?'':action.value==='adjust_owed'?'0.01':'0';
  if(action.value==='adjust_owed')amount.value=fromCents(s.owed_cents);
  if(action.value==='payment')amount.value=fromCents(remaining(s));
 });
 $('#settlement-form [name=vale]').addEventListener('input',e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0)$('#settlement-form [name=amount]').value=fromCents(Math.max(0,remaining(s)-Math.round(n*100)));});
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
  if(d.action==='payment'){
   let v;try{v=cents(d.vale||'0');}catch(err){return toast(explain(err),'error');}
   if(v>availableVales()||value+v>remaining(s)||value+v<=0)return toast('Confira o dinheiro recebido, o saldo da bateria e os vales disponíveis.','error');
   void runRpc('pay_used_settlement_with_vale',{p_settlement_id:s.id,p_cash_cents:value,p_vale_cents:v,p_reason:d.reason||null},'Acerto atualizado. Dinheiro e vale registrados separadamente.');return;
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
  return '<div class="batch-item" data-settle-item="'+s.id+'"><div class="batch-item-head"><div><strong>'+esc(batteryDisplay(b))+'</strong><div class="cell-sub">Pendente: '+brl(old)+' · Recebido antes: '+brl(cashReceived(s))+' · Vales: '+brl(appliedVale(s.id))+'</div></div>'+statusBadge('Selecionada','yellow')+'</div><div class="batch-item-fields">'+
  field('Novo valor total para Sandro','owed','number',fromCents(s.owed_cents),'min="0.01" step="0.01" required')+
  field('Dinheiro recebido agora (R$)','paid','number',fromCents(old),'min="0" step="0.01" required')+
  field('Desconto de vale (R$)','vale','number','0.00','min="0" max="'+fromCents(availableVales())+'" step="0.01" required')+
  '<label class="field wide"><span><input type="checkbox" name="waive" style="width:auto;min-height:0;vertical-align:middle"> Dispensar eventual saldo restante</span></label>'+
  field('Motivo de ajuste/dispensa','reason','text','','maxlength="400" class="wide"')+'</div></div>';
 }).join('');
 const body='<div class="note">Este acerto será feito em <b>um único lote</b>. Se qualquer bateria falhar, nada será pago. Cada item terá data/hora e auditoria.</div>'+
 '<form id="batch-form" style="margin-top:16px">'+
 '<div class="note">Vales disponíveis: <b>'+brl(availableVales())+'</b>. Informe quanto usar por bateria.</div><div class="batch-list">'+items+'</div><div class="batch-total"><span>Dinheiro recebido agora</span><strong id="batch-total">'+brl(ss.reduce((a,s)=>a+remaining(s),0))+'</strong></div><div class="batch-total"><span>Vales descontados</span><strong id="batch-vale-total">'+brl(0)+'</strong></div>'+
 '<div class="field-grid">'+selectField('Recebimento','method',[['pix','PIX'],['cash','Dinheiro'],['transfer','Transferência'],['other','Outro']],'pix')+
 field('Referência do pagamento','reference','text','','maxlength="150"')+
 '<label class="field wide"><span>Observação geral</span><textarea name="notes" maxlength="500"></textarea></label></div></form>';
 modal('Acertar '+ss.length+' bateria(s)',body,'<button type="button" class="btn secondary" data-modal-close>Cancelar</button><button type="submit" class="btn" form="batch-form">✓ Confirmar lote</button>');
 $('#batch-form').addEventListener('input',e=>{
  if(e.target.name==='vale'){const el=e.target.closest('[data-settle-item]');const st=rows.settlements.find(x=>x.id===el.dataset.settleItem);const v=Number(e.target.value),owed=Number($('[name=owed]',el).value);if(Number.isFinite(v)&&v>=0&&Number.isFinite(owed))$('[name=paid]',el).value=fromCents(Math.max(0,Math.round(owed*100)-Number(st.paid_cents)-Number(st.waived_cents)-Math.round(v*100)));}
  let sum=0,vales=0;for(const item of $('[data-settle-item]')){const v=Number($('[name=paid]',item).value),w=Number($('[name=vale]',item).value);if(Number.isFinite(v)&&v>=0)sum+=Math.round(v*100);if(Number.isFinite(w)&&w>=0)vales+=Math.round(w*100);}
  $('#batch-total').textContent=brl(sum);$('#batch-vale-total').textContent=brl(vales);
 });
 $('#batch-form').addEventListener('submit',e=>{
  e.preventDefault();
  let itemsOut;
  try{itemsOut=$$('[data-settle-item]').map(el=>{
   const id=el.dataset.settleItem;
   const old=rows.settlements.find(s=>s.id===id);
   const owed=cents($('[name=owed]',el).value);
   const paid=cents($('[name=paid]',el).value);
   const vale=cents($('[name=vale]',el).value);
   const waive=$('[name=waive]',el).checked;
   const reason=$('[name=reason]',el).value.trim();
   if(owed!==Number(old.owed_cents)||waive){if(reason.length<5)throw new Error('Informe o motivo do ajuste/dispensa em cada bateria.');}
   const rest=owed-Number(old.paid_cents)-Number(old.waived_cents)-paid-vale;
   if(rest<0)throw new Error('Pagamento maior que o saldo da bateria.');
   if(rest>0&&!waive)throw new Error('O lote deve quitar totalmente cada bateria. Marque dispensa para o restante, ou altere o valor pago.');
   return {settlement_id:id,new_owed_cents:owed,paid_now_cents:paid,vale_cents:vale,waive_remaining:waive,reason};
  });}catch(err){toast(explain(err),'error');return;}
  const d=Object.fromEntries(new FormData(e.currentTarget));
  const sum=itemsOut.reduce((a,x)=>a+x.paid_now_cents,0);
  const valeSum=itemsOut.reduce((a,x)=>a+x.vale_cents,0);
  if(valeSum>availableVales())return toast('O desconto supera o saldo dos vales.','error');
  if(!confirm('Confirmar '+brl(sum)+' recebidos e '+brl(valeSum)+' em vales para '+itemsOut.length+' bateria(s)?'))return;
  void runRpc('settle_used_batteries_with_vales',{p_items:itemsOut,p_payment_method:d.method,p_reference:d.reference||null,p_notes:d.notes||null},'Acerto em lote confirmado e registrado no histórico.');
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
 let period;try{period=reportWindow();}catch(err){return toast(explain(err),'error');}
 const slot=$('#monthly-report');
 if(slot)slot.innerHTML='<div class="loading"><span class="loader"></span> Consultando relatório...</div>';
 try{
  const {data,error}=await api.rpc('get_power_ws_period_report',{
    p_start:period.start,p_end:period.endExclusive
  });
  if(error)throw error;
  const active=reportWindow();
  if(current!=='reports'||active.start!==period.start||active.endExclusive!==period.endExclusive)return;
  report=data;reportSelection=period;render();
 }catch(err){
  if(slot)slot.innerHTML='<div class="note error">'+esc(explain(err))+'</div>';
  toast(explain(err),'error');
 }
}
async function exportReportPDF(){
 if(!report||!reportSelection)return toast('Consulte primeiro o período desejado.','error');
 const period=reportWindow();
 if(period.start!==reportSelection.start||period.endExclusive!==reportSelection.endExclusive)
  return toast('Consulte novamente o período antes de baixar.','error');
 const sales=salesInPeriod(period).map(s=>({
  date:stamp(s.sold_at),product:batteryDisplay(battery(s.battery_id)),
  customer:s.customer_name,amount_cents:s.sale_price_cents
 }));
 const expense=x=>({
  date:dateBR(x.spent_on),category:CATEGORIES[x.category]||x.category,
  description:x.description,amount_cents:x.amount_cents
 });
 try{
  const file=await downloadPeriodPDF({
   ...period,summary:report,role,sales,
   wsExpenses:canViewWSExpenses()?expensesInPeriod(rows.expenses,period).map(expense):[],
   powerExpenses:canViewPowerExpenses()?expensesInPeriod(rows.powerExpenses,period).map(expense):[]
  });
  toast('Relatório PDF salvo: '+file);
 }catch(err){toast('Não foi possível gerar o PDF: '+explain(err),'error');}
}
function exportSales(){
 if(!report||!reportSelection)return toast('Consulte primeiro o período desejado.','error');
 const period=reportWindow(),rs=salesInPeriod(period);
 if(period.start!==reportSelection.start||period.endExclusive!==reportSelection.endExclusive)
  return toast('Consulte novamente o período antes de exportar.','error');
 if(!rs.length)return toast('Não existem vendas para exportar neste período.','error');
 const csvSafe=x=>{const s=String(x??'');return '"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';};
 const matrix=[['Venda em','Cadastro no sistema','Bateria vendida','Marca','Cliente','Telefone','Placa','Valor venda (R$)','Repasse Power (R$)','Valor pago (R$)','Saldo (R$)','Status','Vendedor','Garantia (dias)']];
 for(const s of rs){
  const b=battery(s.battery_id),st=settleFor(s.battery_id),status=settlingStatus(st);
  matrix.push([stamp(s.sold_at),stamp(s.recorded_at||s.sold_at),
   batteryDisplay(b),b?.brand||'',s.customer_name,s.customer_phone||'',s.vehicle_plate||'',
   fromCents(s.sale_price_cents),fromCents(st?.owed_cents||0),
   fromCents(st?.paid_cents||0),fromCents(st?remaining(st):0),
   status[0],staffName(s.sold_by),s.warranty_days]);
 }
 const content='\uFEFF'+matrix.map(row=>row.map(csvSafe).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8;'}));
 const a=document.createElement('a');a.href=url;
 a.download='power-ws-vendas-'+period.type+'-'+period.start+'.csv';
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),15000);
 toast('CSV de vendas exportado.');
}
