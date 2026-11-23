// Testa a interface de verdade em navegador (com Supabase simulado).
// Não testa OAuth nem dados reais: apenas navegação, responsividade e formulários.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const root=new URL('../',import.meta.url);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
'.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const path=pathname==='/'?'index.html':pathname.replace(/^\//,'');
  if(path.includes('..')){res.writeHead(403);res.end();return;}
  try{
    const file=new URL(path,root);
    const bytes=await readFile(file);
    const extension=path.slice(path.lastIndexOf('.'));
    res.writeHead(200,{'Content-Type':MIME[extension]||'application/octet-stream'});
    res.end(bytes);
  }catch(e){res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const exe=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(x=>x && existsSync(x));
if(!exe){server.close();throw Error('Chrome não encontrado no ambiente de testes');}
const browser=await chromium.launch({executablePath:exe,headless:true,args:['--no-sandbox']});
const failures=[];
async function scenario(width,height){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:width<600?2:1,isMobile:width<600,hasTouch:width<600});
  page.on('pageerror',err=>failures.push('JS '+width+': '+err.message));
  await page.route('**/auth.js*',route=>route.fulfill({status:200,contentType:'text/javascript',body:''}));
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.addInitScript(()=>{
    const id='00000000-0000-4000-8000-000000000010';
    const sid='00000000-0000-4000-8000-000000000011';
    const now=new Date().toISOString();
    const tables={
      used_batteries:[{id,code:'WS-000001',brand:'Moura',model:'60Ah',amperage_ah:60,serial_number:'TESTE',transfer_price_cents:6000,
      recovery_cost_cents:1200,asking_price_cents:18000,status:'sold',created_at:now,created_by:'00000000-0000-4000-8000-000000000099'}],
      used_battery_sales:[{id:'00000000-0000-4000-8000-000000000012',battery_id:id,customer_name:'Cliente Exemplo',
      sale_price_cents:19000,payment_method:'pix',warranty_days:30,sold_by:'00000000-0000-4000-8000-000000000099',sold_at:now}],
      used_battery_settlements:[{id:sid,battery_id:id,sale_id:'00000000-0000-4000-8000-000000000012',owed_cents:6000,paid_cents:0,waived_cents:0,created_at:now}],
      used_settlement_batches:[],used_settlement_batch_items:[],used_settlement_events:[],used_battery_activity:[],
      ws_expenses:[],ws_expense_events:[]
    };
    const stub={
      from(name){return {
        select(){return this;},order(){return this;},limit(){return this;},
        then(resolve,reject){return Promise.resolve({data:tables[name]||[],error:null}).then(resolve,reject);}
      };},
      rpc(name,params){
        if(name==='register_direct_battery_sale'){
          window.lastSaleArgs=params;
          return Promise.resolve({data:'sample-sale-id',error:null});
        }
        if(name==='get_power_ws_team')return Promise.resolve({data:[{id:'00000000-0000-4000-8000-000000000099',role:'ws',email:'teste@example.test'}],error:null});
        if(name==='get_power_ws_monthly_report')return Promise.resolve({data:{month:'2026-11',role:'admin',sales_count:1,
           sales_revenue_cents:19000,power_repasse_sales_month_cents:6000,recovery_cost_sales_month_cents:1200,
           ws_expenses_cents:0,ws_estimated_profit_cents:11800,power_received_in_month_cents:0,
           power_pending_total_now_cents:6000,fully_settled_sales_in_month:0},error:null});
        return Promise.resolve({data:null,error:null});
      },
      channel(){return{on(){return this;},subscribe(){return this;}};},
      removeChannel(){return Promise.resolve();}
    };
    window.pbwsSession={client:stub,user:{id:'00000000-0000-4000-8000-000000000099',email:'admin@example.test'},role:'admin'};
    document.addEventListener('DOMContentLoaded',()=>{
      document.getElementById('auth-screen').hidden=true;
      document.getElementById('app-shell').hidden=false;
    });
  });
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
  await page.locator('.stat-grid .stat-card').first().waitFor({timeout:10000});
  assert.equal(await page.locator('.stat-card').count(),4,'painel deve ter 4 cartões');
  assert.ok(await page.locator('#pbws-bell').isVisible(),'sininho aparece no painel');
  await page.locator('#pbws-bell').click();
  assert.ok(await page.locator('#pbws-notif-panel').isVisible(),'central de avisos abre');
  assert.ok(await page.locator('#pbws-notif-list').isVisible(),'lista de notificacoes visivel');
  await page.locator('#pbws-close-notif').click();
  if(width<600){
    assert.ok(await page.locator('#bottom-nav').isVisible(),'barra inferior visível no celular');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    assert.ok(overflow<3,'página excedeu a largura do celular: '+overflow);
  }else{
    assert.ok(await page.locator('.sidebar').isVisible(),'menu lateral visível no PC');
  }
  const side=width<600?'#bottom-nav':'#side-nav';
  await page.locator(side+' [data-view="sales"]').click();
  await page.locator('[data-act="new-sale"]').click();
  assert.ok(await page.locator('#sale-form').isVisible(),'formulário de venda acessível');
  assert.equal(await page.locator(side+' [data-view="batteries"]').count(),0,'menu Estoque não existe');
  assert.equal(await page.locator('#sale-form [name=battery]').count(),0,'venda não depende de seleção do estoque');
  await page.locator('#sale-form [name=brand]').fill('Moura');
  await page.locator('#sale-form [name=model]').fill('60Ah');
  await page.locator('#sale-form [name=price]').fill('200.00');
  await page.locator('#sale-form [name=transfer]').fill('60.00');
  await page.locator('#sale-form [name=recovery]').fill('15.00');
  await page.locator('#sale-form [name=customer]').fill('Cliente de teste');
  await page.locator('#sale-form button[type=submit]').count(); // formulário tem botão externo
  await page.locator('.dialog-footer button[form="sale-form"]').click();
  await page.waitForFunction(()=>!!window.lastSaleArgs);
  const recorded=await page.evaluate(()=>window.lastSaleArgs);
  assert.equal(recorded.p_sale_price_cents,20000);
  assert.equal(recorded.p_transfer_price_cents,6000);
  assert.ok(recorded.p_request_id,'chave de idempotência enviada');
  await page.locator('[data-act="edit-sale"]').first().click();
  assert.ok(await page.locator('#edit-sale-form').isVisible(),'correcao de venda acessivel');
  await page.locator('#modal-close').click();
  await page.locator('[data-act="cancel-sale"]').first().click();
  assert.ok(await page.locator('#cancel-sale-form').isVisible(),'cancelamento administrativo acessivel');
  await page.locator('#modal-close').click();
  await page.locator(side+' [data-view="settlements"]').click();
  // Atualizacoes em tempo real podem redesenhar a linha durante um clique.
  // Envia o evento de selecao e testa a acao resultante, sem flakiness do DOM.
  await page.locator('[data-select-settle]').first().evaluate(input=>{
    input.checked=true;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.locator('[data-act="batch-settle"]').click();
  assert.ok(await page.locator('#batch-form').isVisible(),'acerto em lote acessível');
  await page.locator('#modal-close').click();
  await page.locator(side+' [data-view="expenses"]').click();
  await page.locator('[data-act="new-expense"]').click();
  assert.ok(await page.locator('#expense-form').isVisible(),'formulário de despesa acessível');
  await page.locator('#modal-close').click();
  await page.locator(side+' [data-view="reports"]').click();
  await page.locator('#monthly-report .stat-card').first().waitFor({timeout:10000});
  assert.ok(await page.locator('#monthly-report').isVisible(),'relatório mensal renderiza');
  await page.close();
}
try{
  await scenario(390,844);
  await scenario(1440,900);
  assert.deepEqual(failures,[],'erros JavaScript em execução');
  console.log('PASSOU: login simulado, dashboard, mobile, vendas, lote, despesas e relatórios');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
