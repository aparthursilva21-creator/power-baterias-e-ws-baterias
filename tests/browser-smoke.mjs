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
async function scenario(width,height,userRole='admin',seedDraft=null){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:width<600?2:1,isMobile:width<600,hasTouch:width<600});
  page.on('pageerror',err=>{failures.push('JS '+width+': '+err.message);console.error('BROWSER SCRIPT ERROR '+width,err.stack||err.message);});
  page.on('console',msg=>{if(msg.type()==='error')console.error('BROWSER CONSOLE '+width,msg.text());});
  page.on('requestfailed',req=>{if(req.url().includes('ws-receipt'))console.error('RECEIPT RESOURCE ERROR',req.url(),req.failure()?.errorText);});
  const debugSession=await page.context().newCDPSession(page);
  await debugSession.send('Runtime.enable');
  debugSession.on('Runtime.exceptionThrown',info=>{
    const e=info.exceptionDetails||{};
    console.error('CHROME PARSE LOCATION',JSON.stringify({url:e.url,line:e.lineNumber,column:e.columnNumber,
      text:e.text,description:e.exception?.description,scriptId:e.scriptId}));
  });
  await page.route('**/auth.js*',route=>route.fulfill({status:200,contentType:'text/javascript',body:''}));
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.addInitScript(({testRole,seedDraft})=>{
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
      ws_expenses:[],ws_expense_events:[],pbws_sale_drafts:seedDraft?[seedDraft]:[]
    };
    const stub={
      from(name){
        if(name==='pbws_sale_drafts'){
          return {
            constraints:{},isDelete:false,
            select(){return this;},order(){return this;},limit(){return this;},
            eq(k,v){this.constraints[k]=v;return this;},
            upsert(item){
              window.lastDraftArgs=item;
              const index=tables.pbws_sale_drafts.findIndex(x=>x.owner_id===item.owner_id&&x.kind===item.kind);
              const stored={...item,updated_at:new Date().toISOString(),
                expires_at:new Date(Date.now()+30*60*1000).toISOString()};
              if(index>=0)tables.pbws_sale_drafts[index]=stored;
              else tables.pbws_sale_drafts.push(stored);
              return Promise.resolve({data:null,error:null});
            },
            delete(){this.isDelete=true;return this;},
            then(resolve,reject){
              const selected=tables.pbws_sale_drafts.filter(row=>Object.entries(this.constraints)
                .every(([key,value])=>row[key]===value));
              if(this.isDelete){
                for(const x of selected){
                  tables.pbws_sale_drafts.splice(tables.pbws_sale_drafts.indexOf(x),1);
                }
                window.lastDraftDeleted=true;
                return Promise.resolve({data:null,error:null}).then(resolve,reject);
              }
              return Promise.resolve({data:selected,error:null}).then(resolve,reject);
            }
          };
        }
        return {
          selectedId:null,
          select(){return this;},order(){return this;},limit(){return this;},
          eq(_key,id){this.selectedId=id;return this;},
          single(){const data=(tables[name]||[]).find(x=>x.id===this.selectedId);
            return Promise.resolve({data,error:data?null:{message:'Registro não encontrado'}});},
          then(resolve,reject){return Promise.resolve({data:tables[name]||[],error:null}).then(resolve,reject);}
        };
      },
      rpc(name,params){
        if(name==='register_direct_battery_sale'||name==='register_historical_battery_sale'){
          const historical=name==='register_historical_battery_sale';
          if(historical)window.lastHistoricalArgs=params;
          else window.lastSaleArgs=params;
          const batId=historical?'00000000-0000-4000-8000-000000000031':
            '00000000-0000-4000-8000-000000000021';
          const saleId=historical?'00000000-0000-4000-8000-000000000030':
            '00000000-0000-4000-8000-000000000020';
          const code=historical?'WS-000003':'WS-000002';
          tables.used_batteries.push({id:batId,code,brand:params.p_brand,model:params.p_model,
            amperage_ah:params.p_amperage_ah,serial_number:params.p_serial_number,
            transfer_price_cents:params.p_transfer_price_cents,
            recovery_cost_cents:params.p_recovery_cost_cents,
            status:'sold',created_at:now});
          tables.used_battery_sales.push({id:saleId,battery_id:batId,
            customer_name:params.p_customer_name,customer_phone:params.p_customer_phone,
            vehicle_plate:params.p_vehicle_plate,sale_price_cents:params.p_sale_price_cents,
            warranty_days:params.p_warranty_days,payment_method:params.p_payment_method,
            notes:params.p_notes,sold_at:historical?'2025-02-12T17:40:00.000Z':now,
            recorded_at:now,sold_by:'00000000-0000-4000-8000-000000000099',
            is_historical:historical});
          tables.used_battery_settlements.push({id:historical?
            '00000000-0000-4000-8000-000000000033':
            '00000000-0000-4000-8000-000000000022',
            battery_id:batId,sale_id:saleId,owed_cents:params.p_transfer_price_cents,
            paid_cents:params.p_prior_paid_cents||0,waived_cents:0,created_at:now});
          return Promise.resolve({data:saleId,error:null});
        }
        if(name==='correct_used_battery_sale'){
          window.lastDateCorrection=params;
          const v=tables.used_battery_sales.find(x=>x.id===params.p_sale_id);
          if(!v)return Promise.resolve({data:null,error:{message:'Venda ausente'}});
          const before={...v};
          v.sold_at=new Date(params.p_patch.sold_at_local+':00-03:00').toISOString();
          tables.used_sale_revisions??=[];
          tables.used_sale_revisions.push({
            id:'00000000-0000-4000-8000-000000000070',
            sale_id:v.id,action:'corrected',
            reason:params.p_reason,
            actor_id:'00000000-0000-4000-8000-000000000099',
            occurred_at:new Date().toISOString(),
            before_data:{sale:before,battery:tables.used_batteries.find(x=>x.id===v.battery_id)},
            after_data:{sale:{...v},battery:tables.used_batteries.find(x=>x.id===v.battery_id)}
          });
          return Promise.resolve({data:null,error:null});
        }
        if(name==='register_ws_expense_historical'){
          window.lastHistoricalExpense=params;
          return Promise.resolve({data:'old-expense-id',error:null});
        }
        if(name==='register_power_expense'){
          window.lastPowerExpense=params;
          return Promise.resolve({data:'power-expense-id',error:null});
        }
        if(name==='get_power_ws_team')return Promise.resolve({data:[{id:'00000000-0000-4000-8000-000000000099',role:'ws',email:'teste@example.test'}],error:null});
        if(name==='cancel_used_battery_sale'){
          window.lastCancellation=params;
          const sale=tables.used_battery_sales.find(x=>x.id===params.p_sale_id);
          if(!sale)return Promise.resolve({data:null,error:{message:'Venda não encontrada'}});
          if(sale.cancelled_at)return Promise.resolve({data:null,error:{message:'Já cancelada'}});
          const before={...sale};
          sale.cancelled_at=new Date().toISOString();
          sale.cancelled_by='00000000-0000-4000-8000-000000000099';
          sale.cancellation_reason=params.p_reason;
          tables.used_sale_revisions.push({
            id:crypto.randomUUID(),sale_id:sale.id,action:'cancelled',
            actor_id:sale.cancelled_by,occurred_at:sale.cancelled_at,
            reason:params.p_reason,
            before_data:{sale:before,battery:tables.used_batteries.find(x=>x.id===sale.battery_id)},
            after_data:{sale:{...sale},battery:tables.used_batteries.find(x=>x.id===sale.battery_id)}
          });
          return Promise.resolve({data:null,error:null});
        }
        if(name==='get_power_ws_period_report'){
          window.lastReportQuery=params;
          return Promise.resolve({data:{period_start:params.p_start,period_end_exclusive:params.p_end,
           role:testRole,sales_count:1,sales_revenue_cents:19000,
           power_repasse_sales_month_cents:6000,recovery_cost_sales_month_cents:1200,
           ws_expenses_cents:testRole==='power'?null:0,
           power_expenses_cents:testRole==='ws'?null:0,
           ws_estimated_profit_cents:testRole==='power'?null:11800,
           power_received_in_month_cents:0,
           power_pending_total_now_cents:6000,fully_settled_sales_in_month:0},error:null});
        }
        return Promise.resolve({data:null,error:null});
      },
      channel(){return{on(){return this;},subscribe(){return this;}};},
      removeChannel(){return Promise.resolve();}
    };
    window.pbwsSession={client:stub,user:{id:'00000000-0000-4000-8000-000000000099',email:'teste@example.test'},role:testRole};
    document.addEventListener('DOMContentLoaded',()=>{
      document.getElementById('auth-screen').hidden=true;
      document.getElementById('app-shell').hidden=false;
    });
  },{testRole:userRole,seedDraft});
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
  if(seedDraft){
    await page.locator('#sale-form [name=customer]').waitFor({timeout:10000});
    assert.equal(await page.locator('#sale-form [name=customer]').inputValue(),'Cliente do WhatsApp');
    assert.equal(await page.locator('#sale-form [name=price]').inputValue(),'224.90');
    assert.ok((await page.locator('[data-sale-draft-status]').textContent()).includes('recuperado'),
      'Os campos foram recuperados da conta Google após reiniciar a página');
    await page.close();return;
  }
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
  if(userRole==='power'){
    await page.locator(side+' [data-view="sales"]').click();
    assert.equal(await page.locator('[data-act="new-sale"]').count(),0,'Power nao cadastra venda de hoje');
    assert.ok(await page.locator('[data-act="cancel-sale"]').first().isVisible(),'Sandro pode excluir venda');
    await page.locator('[data-act="cancel-sale"]').first().click();
    assert.ok(await page.locator('#cancel-sale-form').isVisible(),'Sandro pode informar motivo');
    await page.locator('#modal-close').click();
    await page.locator('[data-act="new-historical-sale"]').click();
    assert.ok(await page.locator('#sale-form [name=sold_when]').isVisible(),'Sandro lança venda antiga');
    await page.locator('#modal-close').click();
    await page.locator(side+' [data-view="expenses"]').click();
    assert.ok((await page.locator('.page-heading').textContent()).includes('Power Baterias'),'Sandro vê despesas Power');
    await page.locator('[data-act="new-historical-expense"]').click();
    assert.ok(await page.locator('#expense-form [name=spent]').isVisible(),'Sandro registra gasto antigo');
    await page.close();return;
  }
  if(userRole==='ws'){
    await page.locator(side+' [data-view="sales"]').click();
    assert.ok(await page.locator('[data-act="cancel-sale"]').first().isVisible(),'Wanderson pode excluir venda');
    await page.locator('[data-act="cancel-sale"]').first().click();
    assert.ok(await page.locator('#cancel-sale-form').isVisible(),'Wanderson pode informar motivo');
    await page.locator('#modal-close').click();
    await page.locator(side+' [data-view="expenses"]').click();
    assert.ok((await page.locator('.page-heading').textContent()).includes('WS Baterias'),'WS vê suas despesas');
    assert.equal(await page.locator('[data-expense-branch="power"]').count(),0,'WS nao abre despesas Power');
    await page.close();return;
  }
  await page.locator(side+' [data-view="sales"]').click();
  const initialSaleText=await page.locator('#app-main').innerText();
  assert.match(initialSaleText,/Moura\s*60Ah/,'Lista de vendas mostra marca/modelo');
  assert.doesNotMatch(initialSaleText,/WS-000001/,'Códigos internos não aparecem na lista');
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
  await page.waitForFunction(()=>window.lastDraftArgs?.form_data?.customer==='Cliente de teste');
  assert.equal((await page.locator('#sale-form [name=customer]').inputValue()),
    'Cliente de teste','Preenchimento continua na tela após gravação automática');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.ok(await page.locator('#sale-form [name=customer]').isVisible(),
    'Foco do sistema não fecha o formulário');

  await page.locator('#sale-form [name=notes]').fill('Observação importante sobre instalação e garantia. '.repeat(9));
  await page.locator('#sale-form button[type=submit]').count(); // formulário tem botão externo
  await page.locator('.dialog-footer button[form="sale-form"]').click();
  await page.waitForFunction(()=>!!window.lastSaleArgs);
  const recorded=await page.evaluate(()=>window.lastSaleArgs);
  assert.equal(recorded.p_sale_price_cents,20000);
  assert.equal(recorded.p_transfer_price_cents,6000);
  assert.ok(recorded.p_request_id,'chave de idempotência enviada');
  await page.locator('.ws-receipt').waitFor({timeout:10000});
  assert.match(await page.locator('.ws-receipt').innerText(),/WS BATERIAS/);
  assert.match(await page.locator('.ws-receipt').innerText(),/DOCUMENTO NÃO FISCAL/);
  assert.match(await page.locator('.ws-receipt').innerText(),/R\$\s*200,00/);
  const contentWS=await page.locator('.ws-receipt').innerText();
  assert.match(contentWS,/BATERIA VENDIDA/);
  assert.match(contentWS,/Moura\s*60Ah/,'Notinha destaca a bateria pelo nome');
  assert.match(contentWS,/DESCRIÇÃO[\s\S]*QTD\./,'A notinha tem tabela comercial');
  assert.doesNotMatch(contentWS,/WS-0000\d+|Referência da venda|Código da bateria/,
    'A notinha não mostra identificador interno');
  assert.doesNotMatch(await page.locator('.ws-receipt').innerText(),/Repasse|recuperação \(R\$\)/i);
  const [pdfDownload]=await Promise.all([
    page.waitForEvent('download',{timeout:15000}),
    page.locator('[data-receipt-action="download"]').click()
  ]);
  assert.match(pdfDownload.suggestedFilename(),/^WS-Baterias-Moura-60Ah-.*\.pdf$/);
  assert.doesNotMatch(pdfDownload.suggestedFilename(),/WS-000/);
  const pdfStream=await pdfDownload.createReadStream();
  const pdfParts=[];for await (const part of pdfStream)pdfParts.push(part);
  const pdfBinary=Buffer.concat(pdfParts);
  assert.ok(pdfBinary.length>12000,'PDF gerado realmente contém uma página');
  assert.equal(pdfBinary.subarray(0,8).toString('utf8'),'%PDF-1.4');
  assert.ok(pdfBinary.toString('latin1').includes('/Count 2'),'Observações extensas geram anexo completo no PDF');
  await page.locator('#modal-close').click();
  await page.locator('[data-act="ws-receipt"]').last().click();
  assert.ok(await page.locator('.ws-receipt').isVisible(),'segunda via pelo histórico');
  assert.doesNotMatch(await page.locator('.ws-receipt').innerText(),/WS-0000\d+/);
  assert.match(await page.locator('.ws-receipt').innerText(),/Moura\s*60Ah/);
  await page.locator('#modal-close').click();
  await page.locator('[data-act="new-historical-sale"]').click();
  assert.ok(await page.locator('#sale-form [name=sold_when]').isVisible(),'data e hora para venda antiga');
  await page.locator('#sale-form [name=sold_when]').fill('2025-02-12T14:40');
  await page.locator('#sale-form [name=brand]').fill('Heliar');
  await page.locator('#sale-form [name=model]').fill('60 Ah');
  await page.locator('#sale-form [name=price]').fill('260.00');
  await page.locator('#sale-form [name=transfer]').fill('80.00');
  await page.locator('#sale-form [name=recovery]').fill('5.00');
  await page.locator('#sale-form [name=customer]').fill('Cliente do passado');
  await page.locator('#sale-form [name=already_paid]').fill('30.00');
  await page.locator('#sale-form [name=paid_when]').fill('2025-02-15T11:20');
  await page.locator('.dialog-footer button[form="sale-form"]').click();
  await page.waitForFunction(()=>!!window.lastHistoricalArgs);
  const old=await page.evaluate(()=>window.lastHistoricalArgs);
  assert.equal(old.p_sold_at_local,'2025-02-12T14:40');
  assert.equal(old.p_prior_paid_cents,3000);
  assert.equal(old.p_paid_at_local,'2025-02-15T11:20');
  await page.locator('.ws-receipt').waitFor({timeout:10000});
  assert.match(await page.locator('.ws-receipt').innerText(),/12\/02\/2025/);
  await page.locator('#modal-close').click();

  await page.locator('[data-act="edit-sale"]').first().click();
  assert.ok(await page.locator('#edit-sale-form').isVisible(),'correcao de venda acessivel');
  assert.ok(await page.locator('#edit-sale-form [name=sold_when]').isVisible(),'data editavel para venda normal');
  await page.locator('#edit-sale-form [name=sold_when]').fill('2025-02-09T15:45');
  await page.locator('#edit-sale-form [name=reason]').fill('Cliente confirmou que a venda foi realizada neste dia e horario');
  await page.locator('.dialog-footer button[form="edit-sale-form"]').click();
  await page.waitForFunction(()=>!!window.lastDateCorrection);
  const correction=await page.evaluate(()=>window.lastDateCorrection);
  assert.equal(correction.p_patch.sold_at_local,'2025-02-09T15:45',
    'Nova data/hora foi enviada ao banco');
  assert.match(correction.p_reason,/Cliente confirmou/);
  await page.locator(side+' [data-view="activity"]').click();
  const activityText=await page.locator('#app-main').innerText();
  assert.match(activityText,/Data e horário corrigidos/);
  assert.match(activityText,/Moura\s*60Ah/,'Histórico usa marca e modelo');
  assert.doesNotMatch(activityText,/WS-0000\d+/,'Histórico não mostra códigos de baterias');
  assert.match(activityText,/ANTES: .* → DEPOIS: /);
  assert.match(activityText,/09\/02\/2025/);
  await page.locator(side+' [data-view="sales"]').click();
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
  await page.locator('[data-act="new-historical-expense"]').click();
  assert.ok(await page.locator('#expense-form [name=spent]').isVisible(),'data de gasto antigo');
  await page.locator('#expense-form [name=spent]').fill('2025-02-12');
  await page.locator('#expense-form [name=spent_time]').fill('09:15');
  await page.locator('#expense-form [name=amount]').fill('22.00');
  await page.locator('#expense-form [name=description]').fill('Gasolina antiga');
  await page.locator('.dialog-footer button[form="expense-form"]').click();
  await page.waitForFunction(()=>!!window.lastHistoricalExpense);
  const expense=await page.evaluate(()=>window.lastHistoricalExpense);
  assert.equal(expense.p_spent_on,'2025-02-12');
  assert.equal(expense.p_spent_at_local,'2025-02-12T09:15');
  await page.locator('[data-expense-branch="power"]').click();
  assert.ok(await page.locator('[data-act="new-historical-expense"]').isVisible(),'Administrador vê despesas da Power');
  await page.locator('[data-act="new-historical-expense"]').click();
  await page.locator('#expense-form [name=spent]').fill('2025-02-12');
  await page.locator('#expense-form [name=spent_time]').fill('10:30');
  await page.locator('#expense-form [name=amount]').fill('55.00');
  await page.locator('#expense-form [name=description]').fill('Gasolina da Power');
  await page.locator('.dialog-footer button[form="expense-form"]').click();
  await page.waitForFunction(()=>!!window.lastPowerExpense);
  const power=await page.evaluate(()=>window.lastPowerExpense);
  assert.equal(power.p_amount_cents,5500);
  assert.equal(power.p_spent_on,'2025-02-12');
  assert.equal(power.p_spent_at_local,'2025-02-12T10:30');
  await page.locator(side+' [data-view="reports"]').click();
  await page.locator('#monthly-report .stat-card').first().waitFor({timeout:10000});
  assert.ok(await page.locator('#monthly-report').isVisible(),'relatório mensal renderiza');
  assert.equal(await page.locator('#report-type').inputValue(),'month');
  assert.ok(await page.locator('[data-act="download-report-pdf"]').isVisible());
  const [monthlyPDF]=await Promise.all([
    page.waitForEvent('download',{timeout:20000}),
    page.locator('[data-act="download-report-pdf"]').click()
  ]);
  assert.match(monthlyPDF.suggestedFilename(),/Relatorio-month-/);
  const monthData=[];for await(const x of await monthlyPDF.createReadStream())monthData.push(x);
  assert.match(Buffer.concat(monthData).subarray(0,8).toString(),'%PDF-1.4');
  await page.locator('#report-type').selectOption('day');
  await page.locator('#report-day').fill('2025-02-12');
  await page.locator('#report-day').dispatchEvent('change');
  await page.waitForFunction(()=>window.lastReportQuery?.p_start==='2025-02-12');
  const dayStart=await page.locator('#report-day').inputValue();
  assert.equal(dayStart,'2025-02-12');
  await page.locator('#monthly-report .stat-card').first().waitFor({timeout:10000});
  const [dailyPDF]=await Promise.all([
    page.waitForEvent('download',{timeout:20000}),
    page.locator('[data-act="download-report-pdf"]').click()
  ]);
  assert.match(dailyPDF.suggestedFilename(),/Relatorio-day-2025-02-12/);
  const dayData=[];for await(const x of await dailyPDF.createReadStream())dayData.push(x);
  assert.equal(Buffer.concat(dayData).subarray(0,8).toString(),'%PDF-1.4');
  await page.locator('#report-type').selectOption('year');
  await page.locator('#report-year').fill('2025');
  await page.locator('#report-year').dispatchEvent('change');
  await page.waitForFunction(()=>window.lastReportQuery?.p_start==='2025-01-01');
  assert.equal(await page.locator('#report-year').inputValue(),'2025');
  await page.locator('#monthly-report .stat-card').first().waitFor({timeout:10000});
  const [annualPDF]=await Promise.all([
    page.waitForEvent('download',{timeout:20000}),
    page.locator('[data-act="download-report-pdf"]').click()
  ]);
  assert.match(annualPDF.suggestedFilename(),/Relatorio-year-2025/);
  await page.close();
}
// Verifica o bug real: Supabase emite SIGNED_IN novamente ao voltar do WhatsApp.
// Esse evento NÃO deve desmontar um formulário que já está sendo preenchido.
async function authResumeScenario(){
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 page.on('pageerror',err=>failures.push('Auth refocus: '+err.message));
 await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 await page.route('https://fonts.gstatic.com/**',route=>route.abort());
 await page.addInitScript(()=>{
  const mockUser={id:'00000000-0000-4000-8000-000000000003',email:'wanderson@example.test'};
  window.__authReadyEvents=0;
  window.addEventListener('pbws:ready',()=>{window.__authReadyEvents++;});
  const fake={
   auth:{
    getUser(){return Promise.resolve({data:{user:mockUser},error:null});},
    onAuthStateChange(callback){
     window.__authStateCallback=callback;
     queueMicrotask(()=>callback('INITIAL_SESSION',{user:mockUser}));
     return {data:{subscription:{unsubscribe(){}}}};
    },
    signOut(){return Promise.resolve({error:null});}
   },
   rpc(name){
    if(name==='is_authorized_user')return Promise.resolve({data:true,error:null});
    if(name==='current_app_role')return Promise.resolve({data:'ws',error:null});
    if(name==='get_power_ws_team')return Promise.resolve({data:[],error:null});
    return Promise.resolve({data:{},error:null});
   },
   from(){
    return {
      select(){return this;},order(){return this;},limit(){return this;},eq(){return this;},
      upsert(){return Promise.resolve({error:null});},
      delete(){return this;},
      then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}
    };
   },
   channel(){return{on(){return this;},subscribe(){return this;}};},
   removeChannel(){return Promise.resolve();}
  };
  window.__testSupabase=fake;
  window.__testUser=mockUser;
 });
 await page.route('https://esm.sh/@supabase/supabase-js@2.49.1',route=>
  route.fulfill({status:200,contentType:'text/javascript',
   headers:{'access-control-allow-origin':'*'},
   body:'export function createClient() { return window.__testSupabase; }'}));
 await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
 await page.locator('.stat-grid .stat-card').first().waitFor({timeout:12000});
 await page.locator('#bottom-nav [data-view="sales"]').click();
 await page.locator('[data-act="new-sale"]').click();
 await page.locator('#sale-form [name=customer]').fill('Cliente anotado do WhatsApp');
 await page.locator('#sale-form [name=price]').fill('199.90');
 await page.evaluate(()=>{
   window.__authStateCallback('SIGNED_IN',{user:window.__testUser});
   window.__authStateCallback('TOKEN_REFRESHED',{user:window.__testUser});
 });
 await page.waitForTimeout(500);
 assert.equal(await page.locator('#sale-form [name=customer]').inputValue(),
  'Cliente anotado do WhatsApp','SIGN_IN repetido não apaga cliente digitado');
 assert.equal(await page.locator('#sale-form [name=price]').inputValue(),'199.90',
  'Troca de aplicativo não apaga preço digitado');
 assert.equal(await page.evaluate(()=>window.__authReadyEvents),1,
  'A sessão ativa não deve reinicializar o painel ao retomar foco');
 await page.close();
}

try{
  await scenario(390,844);
  await scenario(1440,900);
  await scenario(390,844,'power');
  await scenario(390,844,'ws');
  await scenario(390,844,'ws',{
    owner_id:'00000000-0000-4000-8000-000000000099',
    kind:'sale',
    request_id:'ea750f00-0000-4000-8000-000000000123',
    updated_at:new Date().toISOString(),
    expires_at:new Date(Date.now()+15*60*1000).toISOString(),
    form_data:{brand:'Moura',model:'60Ah',customer:'Cliente do WhatsApp',
      price:'224.90',transfer:'80.00'}
  });
  await authResumeScenario();
  assert.deepEqual(failures,[],'erros JavaScript em execução');
  console.log('PASSOU: login simulado, dashboard, mobile, vendas, lote, despesas e relatórios');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
