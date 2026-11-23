import test from 'node:test';
import assert from 'node:assert/strict';
import {SaleDraftStore,SALE_DRAFT_MINUTES} from '../sale-drafts.js';

function fakeClient(){
 const db=new Map();
 const api={
  db,
  from(table){
   assert.equal(table,'pbws_sale_drafts');
   return{
    predicates:{},deleting:false,
    upsert(payload,{onConflict}){
     assert.equal(onConflict,'owner_id,kind');
     return new Promise(resolve=>setTimeout(()=>{
      db.set(payload.owner_id+':'+payload.kind,
       {...payload,updated_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+SALE_DRAFT_MINUTES*60000).toISOString()});
      resolve({error:null});
     },10));
    },
    delete(){this.deleting=true;return this;},
    select(){return this;},order(){return this;},limit(){return this;},
    eq(k,v){this.predicates[k]=v;return this;},
    then(resolve,reject){
     const selected=[...db.values()].filter(row=>
      Object.entries(this.predicates).every(([k,v])=>row[k]===v));
     if(this.deleting)for(const row of selected)db.delete(row.owner_id+':'+row.kind);
     return Promise.resolve({data:this.deleting?null:selected,error:null}).then(resolve,reject);
    }
   };
  }
 };
 return api;
}
test('Salva campos e recupera rascunho pela mesma conta',async()=>{
 const c=fakeClient(),user='00000000-0000-4000-8000-000000000003';
 const store=new SaleDraftStore(c,user),id='aabb0000-0000-4000-8000-000000000001';
 await store.save('sale',{customer:'Cliente WhatsApp',price:'234.00'},id);
 const resumed=await new SaleDraftStore(c,user).latest();
 assert.equal(resumed.form_data.customer,'Cliente WhatsApp');
 assert.equal(resumed.form_data.price,'234.00');
 assert.equal(resumed.request_id,id);
 assert.equal(resumed.kind,'sale');
 assert.equal(await new SaleDraftStore(c,'00000000-0000-4000-8000-000000000002').latest(),null,
  'Outra conta nunca recebe os dados da WS');
});
test('Excluir depois da venda não é desfeito por escrita pendente',async()=>{
 const c=fakeClient(),user='00000000-0000-4000-8000-000000000003';
 const store=new SaleDraftStore(c,user),id='aabb0000-0000-4000-8000-000000000002';
 const pending=store.save('sale',{customer:'Não duplicar'},id);
 const remove=store.remove('sale');
 await Promise.all([pending,remove]);
 assert.equal(await store.latest(),null);
 assert.equal(c.db.size,0);
});
test('Rascunhos vencidos não são restaurados',async()=>{
 const c=fakeClient(),user='00000000-0000-4000-8000-000000000003';
 c.db.set(user+':sale',{owner_id:user,kind:'sale',form_data:{customer:'Expirado'},
  request_id:'aabb0000-0000-4000-8000-000000000003',
  updated_at:new Date(Date.now()-40*60000).toISOString(),
  expires_at:new Date(Date.now()-10*60000).toISOString()});
 assert.equal(await new SaleDraftStore(c,user).latest(),null);
});
test('Não permite salvar rascunho sem campos ou identificação',async()=>{
 const c=fakeClient(),store=new SaleDraftStore(c,'00000000-0000-4000-8000-000000000003');
 await assert.rejects(store.save('inventario',{},'aabb0000-0000-4000-8000-000000000004'));
 await assert.rejects(store.save('sale',null,'aabb0000-0000-4000-8000-000000000004'));
});
