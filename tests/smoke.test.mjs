import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('arquivos essenciais presentes',()=>{
 for(const path of ['index.html','auth.js','app.js','app.css','config.js','manifest.webmanifest',
 'supabase/002_used_batteries_schema.sql','supabase/003_used_batteries_operations.sql',
 'supabase/004_batches_expenses_reports.sql','supabase/005_staff_realtime.sql',
 'supabase/006_direct_sale_no_stock.sql',
 'supabase/007_notifications.sql','supabase/008_push_dispatch.sql','supabase/010_sale_edit_cancel.sql','supabase/011_test_reset_log.sql','supabase/013_historical_entries.sql','sw.js',
 'notifications.js','notifications.css','supabase/functions/pbws-push/index.ts']){
  assert.ok(existsSync(new URL(path,root)), 'Ausente: '+path);
 }
});

test('entrada com Google mantém painel protegido',()=>{
 const html=read('index.html'), auth=read('auth.js');
 assert.match(html,/id="auth-screen"/);
 assert.match(html,/id="app-shell" hidden/);
 assert.match(html,/id="google-login"/);
 assert.match(html,/app\.js\?v=/);
 assert.match(html,/app\.css\?v=/);
 assert.match(auth,/persistSession: true/);
 assert.match(auth,/autoRefreshToken: true/);
 assert.match(auth,/is_authorized_user/);
 assert.match(auth,/current_app_role/);
 assert.match(auth,/pbws:ready/);
 const cfg=read('config.js').replace(/^\/\/.*$/gm,'');
 assert.doesNotMatch(cfg,/(?:sb_secret_[\w-]{12,}|service_role\s*=)/i);
});

test('aplicativo real usa banco remoto, não localStorage',()=>{
 const js=read('app.js');
 assert.match(js,/from\('used_battery_sales'\)/);
 assert.match(js,/from\('used_battery_settlements'\)/);
 assert.match(js,/register_direct_battery_sale/);
 assert.match(js,/register_historical_battery_sale/);
 assert.match(js,/register_ws_expense_historical/);
 assert.match(js,/p_paid_at_local/);
 assert.match(js,/brazilLocalNow/);
 assert.doesNotMatch(js, /function (?:batteryView|openBattery)\s*\(/);
 const navOnly=js.slice(js.indexOf('const MENU'),js.indexOf('const CATEGORIES'));
 assert.doesNotMatch(navOnly, /\['batteries',/);
 assert.match(js,/p_request_id:requestId/);
 assert.match(js,/settle_used_batteries_batch/);
 assert.match(js,/register_ws_expense/);
 assert.match(js,/get_power_ws_monthly_report/);
 assert.match(js,/get_power_ws_team/);
 assert.match(js,/BR_TIMEZONE = 'America\/Sao_Paulo'/);
 assert.doesNotMatch(js,/localStorage|sessionStorage/);
 assert.match(js,/postgres_changes/);
 assert.match(js,/pbws_remind_ws/);
 assert.match(js,/correct_used_battery_sale/);
 assert.match(js,/cancel_used_battery_sale/);
 assert.match(js,/used_sale_revisions/);
 assert.match(read('notifications.js'),/pbws_save_push_subscription/);
 assert.match(read('sw.js'),/showNotification/);
 assert.match(read('index.html'),/id="pbws-bell"/);
});

test('migrações contêm controle de acesso e transações financeiras',()=>{
 const schema=read('supabase/002_used_batteries_schema.sql');
 const ops=read('supabase/003_used_batteries_operations.sql');
 const batch=read('supabase/004_batches_expenses_reports.sql');
 const direct=read('supabase/006_direct_sale_no_stock.sql');
 assert.match(schema,/enable row level security/i);
 assert.match(schema,/used_battery_settlements/);
 assert.match(ops,/for update/);
 assert.match(ops,/register_used_battery_sale/);
 assert.match(ops,/auth\.uid\(\)/);
 assert.match(batch,/settle_used_batteries_batch/);
 assert.match(batch,/used_settlement_batches/);
 assert.match(batch,/used_settlement_events/);
 assert.match(batch,/get_power_ws_monthly_report/);
 assert.match(direct,/client_request_id/);
 assert.match(direct,/register_direct_battery_sale/);
 assert.match(direct,/status,[^\n]*notes,created_by/);
});

test('notificacoes isoladas por usuario e envio sem segredo publico',()=>{
 const n=read('supabase/007_notifications.sql');
 const net=read('supabase/008_push_dispatch.sql');
 const edge=read('supabase/functions/pbws-push/index.ts');
 assert.match(n,/enable row level security/i);
 assert.match(n,/recipient_id = \(select auth\.uid\(\)\)/);
 assert.match(n,/pbws_remind_ws/);
 assert.match(n,/45 minutes/);
 assert.match(net,/vault\.decrypted_secrets/);
 assert.match(net,/cron\.schedule/);
 assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(edge,/safeEqual/);
 assert.doesNotMatch(read('notifications.js'),/SUPABASE_SERVICE_ROLE_KEY|sb_secret_/);
});

test('PWA apto para uso em Android e iPhone via navegador',()=>{
 const html=read('index.html');
 const manifest=JSON.parse(read('manifest.webmanifest'));
 const css=read('app.css');
 assert.equal(manifest.scope,'/power-baterias-e-ws-baterias/');
 assert.equal(manifest.display,'standalone');
 assert.match(html,/apple-mobile-web-app-capable/);
 assert.match(html,/bottom-nav/);
 assert.match(css,/max-width:850px/);
 assert.match(css,/safe-area-inset-bottom/);
});
