/* Relatório PDF operacional: gerado localmente, sem envio de clientes a terceiros.
 * Valores e totais do relatório vêm da função do banco autenticada.
 */
const money=x=>(Number(x||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const prettyDate=x=>String(x||'').replace(/^(\d{4})-(\d\d)-(\d\d)$/,'$3/$2/$1');
function canvasPage(){
 const canvas=document.createElement('canvas');canvas.width=1300;canvas.height=1838;
 const ctx=canvas.getContext('2d',{alpha:false});ctx.scale(1.3,1.3);
 const navy='#101e35',blue='#136ac4',ink='#152944',muted='#5c728d',line='#d8e2ee';
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,1414);
 const rectangle=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
 const text=(value,x,y,size=18,color=ink,weight=500,align='left')=>{
  ctx.font=weight+' '+size+'px Arial,sans-serif';ctx.fillStyle=color;ctx.textAlign=align;
  ctx.fillText(String(value??''),x,y);ctx.textAlign='left';
 };
 const rule=(y)=>rectangle(52,y,896,1,line);
 const cut=(value,width,fontSize=16,weight=500)=>{
  ctx.font=weight+' '+fontSize+'px Arial,sans-serif';
  let x=String(value??'');
  if(ctx.measureText(x).width<=width)return x;
  while(x.length>1&&ctx.measureText(x+'…').width>width)x=x.slice(0,-1);
  return x+'…';
 };
 return {canvas,rectangle,text,rule,cut,navy,blue,ink,muted};
}
function pageHeader(p,section,page){
 const c=canvasPage();
 const {rectangle,text,navy,blue,muted}=c;
 rectangle(0,0,1000,137,navy);rectangle(0,130,1000,7,blue);
 text('POWER  ×  WS BATERIAS',54,65,31,'#fff',800);
 text('RELATÓRIO OPERACIONAL  •  '+p.title.toUpperCase(),54,102,17,'#bcd8fb',700);
 text(section,54,190,27,navy,800);
 text('Período: '+prettyDate(p.start)+' a '+prettyDate(p.endInclusive),54,220,16,muted,550);
 rectangle(0,1365,1000,49,navy);
 text('Relatório interno • Dados atualizados do sistema',54,1396,14,'#d7e8ff',600);
 text('Página '+page,946,1396,14,'#d7e8ff',600,'right');
 return c;
}
function wrapText(c,value,x,y,width,maxLines=2,size=16){
 const {text,cut}=c;
 let words=String(value??'').split(/\s+/),line='',lines=[];
 const ctx=c.canvas.getContext('2d');
 ctx.font='600 '+size+'px Arial,sans-serif';
 for(const w of words){
  const next=(line?line+' ':'')+w;
  if(ctx.measureText(next).width<=width){line=next;continue;}
  if(line)lines.push(line);
  line=w;
 }
 if(line)lines.push(line);
 lines=lines.slice(0,maxLines);
 lines.forEach((l,i)=>text(cut(l,width,size,600),x,y+i*22,size,c.ink,600));
 return y+lines.length*22;
}
function summaryPages(p){
 const c=pageHeader(p,'Resumo financeiro',1);
 const {rectangle,text,rule,blue,ink,muted}=c;
 let metrics=[
  ['Vendas realizadas',String(p.summary.sales_count||0)],
  ['Faturamento WS',money(p.summary.sales_revenue_cents)],
  ['Repasse previsto à Power',money(p.summary.power_repasse_sales_month_cents)],
  ['Recebido pela Power no período',money(p.summary.power_received_in_month_cents)],
  ['Vales descontados no período',money(p.summary.ws_vales_applied_cents)]
 ];
 if(p.role==='ws'||p.role==='admin')metrics.push(
  ['Custos de recuperação',money(p.summary.recovery_cost_sales_month_cents)],
  ['Despesas da WS no período',money(p.summary.ws_expenses_cents)],
  ['Lucro estimado da WS',money(p.summary.ws_estimated_profit_cents)]
 );
 if(p.role==='power'||p.role==='admin')metrics.push(
  ['Despesas da Power no período',money(p.summary.power_expenses_cents)]
 );
 metrics.push(['Saldo pendente hoje (total)',money(p.summary.power_pending_total_now_cents)]);
 metrics.push(['Conciliações em aberto',String(p.summary.financial_reviews_pending_count||0)]);
 metrics.push(['Pagamentos anteriores a conferir',money(p.summary.financial_reviews_pending_paid_cents)]);
 let y=268;
 for(let i=0;i<metrics.length;i++){
  const col=i%2, row=Math.floor(i/2);
  const x=54+col*454, yy=y+row*105;
  rectangle(x,yy,436,88,'#f1f6fc');rectangle(x,yy,5,88,blue);
  text(metrics[i][0],x+20,yy+32,17,muted,650);
  text(metrics[i][1],x+20,yy+65,25,ink,850);
 }
 const footerY=y+Math.ceil(metrics.length/2)*105+38;
 rule(footerY);text('Critérios do relatório',54,footerY+36,20,ink,850);
 const texts=[
  '• Vendas contabilizadas pelo dia e horário reais de Brasília.',
  '• Pagamentos à Power pelo dia efetivo do acerto.',
  '• Despesas por sua data de realização, separadas por empresa.',
  '• Vendas canceladas não entram nos totais operacionais.',
  '• Pagamentos de vendas canceladas permanecem históricos até conciliação.',
  '• Saldo pendente hoje inclui todos os períodos, não só o selecionado.',
  '• Lucro WS é estimativa operacional, não resultado contábil.'
 ];
 texts.forEach((line,i)=>text(line,54,footerY+72+i*27,15,muted,550));
 return c.canvas;
}
function tablePages(p,section,items){
 const perPage=19,all=[];
 const rows=items.length?items:[null];
 for(let start=0;start<rows.length;start+=perPage){
  const part=rows.slice(start,start+perPage);
  const c=pageHeader(p,section,all.length+2);
  const {rectangle,text,rule,cut,navy,ink,muted,blue}=c;
  const isSale=section==='Vendas do período';
  const y0=255;
  rectangle(54,y0,892,46,navy);
  text('DATA',68,y0+29,15,'#fff',800);
  text(isSale?'BATERIA / CLIENTE':'CATEGORIA / DESCRIÇÃO',224,y0+29,15,'#fff',800);
  text('VALOR',926,y0+29,15,'#fff',800,'right');
  part.forEach((r,i)=>{
   const yy=y0+46+i*53;
   if(i%2===0)rectangle(54,yy,892,53,'#f6f9fd');
   if(!r){
    text('Nenhum registro neste período',69,yy+32,17,muted,650);return;
   }
   text(cut(r.date,125,15,600),68,yy+31,15,muted,600);
   text(cut(isSale?r.product:r.category,600,16,700),224,yy+22,16,ink,750);
   text(cut(isSale?r.customer:r.description,605,14,500),224,yy+42,14,muted,500);
   text(money(r.amount_cents),926,yy+31,17,ink,750,'right');
  });
  rule(y0+46+part.length*53+7);
  all.push(c.canvas);
 }
 return all;
}
function makePDF(canvases){
 const enc=new TextEncoder(),chunks=[],offset=[0];let n=0;
 const add=data=>{const b=typeof data==='string'?enc.encode(data):data;chunks.push(b);n+=b.length;};
 const obj=id=>{offset[id]=n;add(id+' 0 obj\n');};
 add('%PDF-1.4\n%PWSX\n');
 obj(1);add('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
 obj(2);add('<< /Type /Pages /Count '+canvases.length+' /Kids ['+
  canvases.map((_,i)=>3+i*3+' 0 R').join(' ')+'] >>\nendobj\n');
 const build=async()=>{
  for(let i=0;i<canvases.length;i++){
   const canvas=canvases[i];
   const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(
    b=>b?resolve(b):reject(Error('Não foi possível gerar a página do PDF.')),'image/jpeg',0.9));
   const bytes=new Uint8Array(await jpeg.arrayBuffer());
   const page=3+i*3,content=page+1,image=page+2;
   obj(page);add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89]'+
    ' /Resources << /XObject << /Im '+image+' 0 R >> >> /Contents '+content+' 0 R >>\nendobj\n');
   const command='q\n595.28 0 0 841.89 0 0 cm\n/Im Do\nQ\n';
   obj(content);add('<< /Length '+enc.encode(command).length+' >>\nstream\n'+command+'endstream\nendobj\n');
   obj(image);add('<< /Type /XObject /Subtype /Image /Width '+canvas.width+
    ' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8'+
    ' /Filter /DCTDecode /Length '+bytes.length+' >>\nstream\n');
   add(bytes);add('\nendstream\nendobj\n');
  }
  const at=n,objects=2+canvases.length*3;
  add('xref\n0 '+(objects+1)+'\n0000000000 65535 f \n');
  for(let id=1;id<=objects;id++)add(String(offset[id]).padStart(10,'0')+' 00000 n \n');
  add('trailer\n<< /Size '+(objects+1)+' /Root 1 0 R >>\nstartxref\n'+at+'\n%%EOF\n');
  let out=new Uint8Array(n),position=0;
  for(const chunk of chunks){out.set(chunk,position);position+=chunk.length;}
  return new Blob([out],{type:'application/pdf'});
 };
 return build();
}
export async function downloadPeriodPDF(payload){
 if(!payload||!payload.summary||!payload.start||!payload.endInclusive)throw Error('Selecione e consulte o relatório antes de baixar.');
 const validRoles=['ws','power','admin'];
 if(!validRoles.includes(payload.role))throw Error('Perfil não autorizado para relatórios.');
 const canvases=[summaryPages(payload),...tablePages(payload,'Vendas do período',payload.sales||[])];
 if(payload.role!=='power')
  canvases.push(...tablePages(payload,'Despesas WS do período',payload.wsExpenses||[]));
 if(payload.role!=='ws')
  canvases.push(...tablePages(payload,'Despesas Power do período',payload.powerExpenses||[]));
 const file=new File([await makePDF(canvases)],
  'Power-WS-Relatorio-'+payload.type+'-'+payload.start+'.pdf',
  {type:'application/pdf'});
 const url=URL.createObjectURL(file),link=document.createElement('a');
 link.href=url;link.download=file.name;link.hidden=true;
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),15000);
 return file.name;
}
