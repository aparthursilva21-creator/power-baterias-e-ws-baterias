/* WS Baterias | Comprovante de venda não fiscal.
 * O PDF é montado localmente, sem enviar dados de clientes a terceiros.
 */
const TZ='America/Sao_Paulo';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val=v=>String(v??'').trim();
const money=c=>(Number(c||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const stamp=d=>new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(d));
const payments={pix:'PIX',cash:'Dinheiro',card:'Cartão',other:'Outro',transfer:'Transferência'};
const warranty=d=>Number(d)>0?Number(d)+' '+(Number(d)===1?'dia':'dias')+' (prazo registrado)':'Sem prazo adicional registrado';
// O identificador WS-000001 continua somente no banco. O cliente vê a bateria.
export function soldBatteryName(b){
 const brand=val(b?.brand),model=val(b?.model);
 const amperage=Number(b?.amperage_ah);
 const base=[brand,model].filter(Boolean).join(' ').trim()||'Bateria';
 return amperage>0 && !new RegExp('\\b'+amperage+'\\s*(?:ah|a\\.?h\\.?)\\b','i').test(base)
   ?base+' · '+amperage+'Ah':base;
}
function details(s,b){
 if(!s||!b||s.cancelled_at)throw Error('Venda não disponível para emitir comprovante.');
 return {
  productName:soldBatteryName(b),
  brand:val(b.brand),model:val(b.model),
  amperage:Number(b.amperage_ah)||null,
  customer:val(s.customer_name)||'Não informado',
  phone:val(s.customer_phone),plate:val(s.vehicle_plate),
  price:Number(s.sale_price_cents),payment:payments[s.payment_method]||'Outro',
  warranty:Number(s.warranty_days)||0,
  soldAt:stamp(s.sold_at),
  soldDate:(()=>{
   const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'
   }).formatToParts(new Date(s.sold_at));
   const get=type=>parts.find(x=>x.type===type)?.value||'00';
   return get('year')+'-'+get('month')+'-'+get('day');
  })(),
  notes:val(s.notes),issuedAt:stamp(new Date())
 };
}
const field=(label,value)=>'<div class="ws-receipt-field"><span>'+esc(label)+'</span><strong>'+esc(value||'—')+'</strong></div>';
export function receiptHTML(sale,battery){
 const d=details(sale,battery);
 const product=esc(d.productName);
 return [
  '<article class="ws-receipt" aria-label="Comprovante de venda WS Baterias">',
  '<div class="ws-receipt-hero">',
  '<div class="ws-receipt-identity"><div class="ws-logo-icon" aria-hidden="true"><b>WS</b><span>▰</span></div>',
  '<div><div class="ws-identity-overline">LOJA DE BATERIAS</div>',
  '<div class="ws-identity-title">WS <span>BATERIAS</span></div>',
  '<div class="ws-identity-sub">Comprovante de venda de bateria</div></div></div>',
  '<div class="ws-receipt-hero-foot"><span>COMPROVANTE DE VENDA</span><strong>DOCUMENTO NÃO FISCAL</strong></div></div>',
  '<div class="ws-receipt-pad">',
  '<div class="ws-receipt-meta">',
  field('Venda realizada em',d.soldAt),
  field('Empresa vendedora','WS Baterias'),
  '</div>',
  '<div class="ws-receipt-section ws-customer"><h4>CLIENTE</h4>',
  '<div class="ws-receipt-fields">',field('Nome',d.customer),
  d.phone?field('Telefone / WhatsApp',d.phone):'',
  '</div></div>',
  '<div class="ws-receipt-section ws-items"><h4>BATERIA VENDIDA</h4>',
  '<div class="ws-product-feature"><div class="ws-product-feature-icon" aria-hidden="true">▰</div>',
  '<div><span class="ws-product-eyebrow">PRODUTO</span>',
  '<strong>',product,'</strong>',
  '<small>Bateria usada / recuperada</small></div></div>',
  '<table class="ws-product-table"><thead><tr><th>DESCRIÇÃO</th><th>QTD.</th><th>VALOR UNIT.</th><th>TOTAL</th></tr></thead>',
  '<tbody><tr><td>',product,'</td><td>1</td><td>',esc(money(d.price)),'</td><td>',esc(money(d.price)),'</td></tr></tbody></table>',
  '<div class="ws-receipt-fields ws-specs">',
  d.amperage?field('Amperagem',d.amperage+' Ah'):'',
  d.plate?field('Placa do veículo',d.plate):'',
  '</div></div>',
  '<div class="ws-receipt-section ws-payment">',
  '<div class="ws-receipt-fields">',field('Forma de pagamento informada',d.payment),'</div>',
  '<div class="ws-receipt-total"><span>VALOR TOTAL DA VENDA</span><strong>',esc(money(d.price)),'</strong></div>',
  '</div>',
  '<div class="ws-receipt-section ws-warranty"><h4>GARANTIA REGISTRADA</h4>',
  '<p class="ws-warranty-copy">',esc(warranty(d.warranty)),'</p>',
  '<p class="ws-warranty-legal">A garantia legal prevista no Código de Defesa do Consumidor permanece preservada.</p></div>',
  d.notes?'<div class="ws-receipt-section ws-receipt-notes"><h4>OBSERVAÇÕES</h4><p>'+esc(d.notes)+'</p></div>':'',
  '<div class="ws-receipt-finish"><strong>WS BATERIAS</strong>',
  '<div>Emitido em ',esc(d.issuedAt),' · Horário de Brasília</div>',
  '<p>Comprovante de venda não fiscal. Não substitui documento fiscal obrigatório nem comprovante bancário de quitação.</p></div>',
  '</div></article>'
 ].join('');
}
function paint(data){
 const W=720,H=1018,scale=2;
 const canvas=document.createElement('canvas');
 canvas.width=W*scale;canvas.height=H*scale;
 const ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx)throw Error('Não foi possível criar o comprovante.');
 ctx.scale(scale,scale);
 const NAVY='#0b2449',BLUE='#1877f2',INK='#102744',SLATE='#516b8d',PALE='#f1f7ff',LINE='#dce8f8';
 const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
 const line=(x,y,ex,ey,color=LINE,width=1)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.stroke();};
 const text=(str,x,y,size=17,color=INK,weight=500,align='left')=>{
  ctx.fillStyle=color;ctx.font=String(weight)+' '+size+'px Arial,sans-serif';
  ctx.textAlign=align;ctx.fillText(String(str??''),x,y);ctx.textAlign='left';
 };
 const wrap=(value,x,y,maxWidth,size=16,color=INK,lineH=21,maxLines=2,weight=500)=>{
  ctx.font=String(weight)+' '+size+'px Arial,sans-serif';
  let lines=[];const words=String(value??'').split(/\s+/);let current='';
  for(const word of words){
   const candidate=current?current+' '+word:word;
   if(ctx.measureText(candidate).width<=maxWidth){current=candidate;continue;}
   if(current)lines.push(current);
   current=word;
   while(ctx.measureText(current).width>maxWidth&&current.length>1){
    let n=1;while(n<current.length&&ctx.measureText(current.slice(0,n+1)).width<=maxWidth)n++;
    lines.push(current.slice(0,n));current=current.slice(n);
   }
  }
  if(current)lines.push(current);
  if(lines.length>maxLines){lines=lines.slice(0,maxLines);lines[maxLines-1]=lines[maxLines-1].slice(0,-2)+'…';}
  lines.forEach((v,i)=>text(v,x,y+i*lineH,size,color,weight));
  return y+lines.length*lineH;
 };
 rect(0,0,W,H,'#ffffff');
 rect(0,0,W,174,NAVY);rect(0,166,W,8,BLUE);
 rect(48,31,80,80,BLUE);text('WS',88,84,37,'#fff',900,'center');
 text('WS BATERIAS',151,75,37,'#fff',850);
 text('COMPROVANTE DE VENDA',151,103,14,'#c0ddff',700);
 text('DOCUMENTO NÃO FISCAL',48,147,13,'#deecff',750);

 text('VENDA REALIZADA EM',48,215,12,SLATE,800);
 text(data.soldAt,48,242,18,INK,800);
 text('COMPROVANTE',458,215,12,SLATE,800);
 text('WS BATERIAS',458,242,18,BLUE,800);
 line(48,266,672,266);

 text('DADOS DO CLIENTE',48,298,15,BLUE,800);
 wrap(data.customer,48,329,610,19,INK,23,2,750);
 if(data.phone)text('Telefone: '+data.phone,48,365,13,SLATE,600);
 line(48,385,672,385);

 text('BATERIA VENDIDA',48,418,15,BLUE,800);
 rect(48,435,624,90,PALE);
 rect(48,435,6,90,BLUE);
 wrap(data.productName,70,468,574,23,INK,27,2,850);
 text('Bateria usada / recuperada',70,518,12,SLATE,550);

 // Quadro de itens, como em um comprovante de loja, sem nenhum código interno.
 const yy=547;
 rect(48,yy,624,31,NAVY);
 text('DESCRIÇÃO',59,yy+21,12,'#fff',800);
 text('QTD.',427,yy+21,12,'#fff',800);
 text('VALOR',659,yy+21,12,'#fff',800,'right');
 text(data.productName.length>36?data.productName.slice(0,33)+'…':data.productName,59,600,15,INK,700);
 text('1',435,600,15,INK,700);
 text(money(data.price),659,600,15,INK,750,'right');
 line(48,618,672,618);
 if(data.amperage||data.plate){
  text([data.amperage?data.amperage+' Ah':'',data.plate?'Placa: '+data.plate:''].filter(Boolean).join('  ·  '),48,642,13,SLATE,550);
 }
 text('PAGAMENTO INFORMADO: '+data.payment,48,674,14,INK,700);
 rect(48,690,624,83,PALE);rect(48,690,6,83,BLUE);
 text('TOTAL DA VENDA',70,724,15,SLATE,800);
 text(money(data.price),652,752,34,BLUE,900,'right');

 text('GARANTIA REGISTRADA',48,813,15,BLUE,800);
 text(warranty(data.warranty),48,841,17,INK,750);
 wrap('A garantia legal prevista no Código de Defesa do Consumidor permanece preservada.',48,866,622,13,SLATE,19,2,500);

 if(data.notes){
  text('OBSERVAÇÕES',48,920,12,SLATE,800);
  if(data.notes.length>75 || data.notes.includes('\n'))
   text('Veja as observações completas na próxima página.',48,941,12,INK,600);
  else wrap(data.notes,48,940,621,11,INK,14,1,500);
 }
 rect(0,960,W,58,NAVY);
 text('WS BATERIAS  •  Emitido em '+data.issuedAt,48,984,12,'#deecff',700);
 text('Comprovante não fiscal • Não comprova quitação bancária',48,1002,11,'#adcdf1',500);
 return canvas;
}
function fullNotesPages(data){
 if(!data.notes || (data.notes.length<=75 && !data.notes.includes('\n')))return [];
 const W=720,H=1018,scale=2;
 const measure=document.createElement('canvas').getContext('2d');
 measure.font='500 18px Arial, sans-serif';
 const lines=[];
 for(const para of data.notes.replace(/\r/g,'').split('\n')){
  if(!para.trim()){lines.push('');continue;}
  let current='';
  for(const word of para.split(/\s+/)){
   const probe=(current?current+' ':'')+word;
   if(measure.measureText(probe).width<=624){current=probe;continue;}
   if(current)lines.push(current);
   current=word;
   while(measure.measureText(current).width>624 && current.length>1){
    let part=1;
    while(part<current.length&&measure.measureText(current.slice(0,part+1)).width<=624)part++;
    lines.push(current.slice(0,part));current=current.slice(part);
   }
  }
  lines.push(current);
 }
 const pages=[];
 for(let page=0;page<lines.length;page+=25){
  const canvas=document.createElement('canvas');
  canvas.width=W*scale;canvas.height=H*scale;
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.scale(scale,scale);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#0b2449';ctx.fillRect(0,0,W,173);
  ctx.fillStyle='#1877f2';ctx.fillRect(0,165,W,8);
  ctx.textAlign='left';
  ctx.fillStyle='#fff';ctx.font='800 33px Arial,sans-serif';
  ctx.fillText('WS BATERIAS',50,77);
  ctx.font='600 17px Arial,sans-serif';ctx.fillStyle='#c5dfff';
  ctx.fillText('ANEXO DO COMPROVANTE DE VENDA',50,109);
  ctx.font='600 14px Arial,sans-serif';
  ctx.fillText('DOCUMENTO NÃO FISCAL',50,142);
  ctx.fillStyle='#173a65';ctx.font='800 22px Arial,sans-serif';
  ctx.fillText('Observações completas',50,233);
  ctx.fillStyle='#506a87';ctx.font='600 15px Arial,sans-serif';
  ctx.fillText('Bateria: '+(data.productName.length>32?data.productName.slice(0,29)+'…':data.productName),50,266);
  ctx.fillText('Venda em '+data.soldAt,50,287);
  ctx.strokeStyle='#d6e6f8';ctx.beginPath();ctx.moveTo(50,292);ctx.lineTo(670,292);ctx.stroke();
  ctx.fillStyle='#183251';ctx.font='500 18px Arial,sans-serif';
  lines.slice(page,page+25).forEach((line,i)=>ctx.fillText(line,50,337+i*23));
  ctx.fillStyle='#0b2449';ctx.fillRect(0,951,W,67);
  ctx.fillStyle='#c5dfff';ctx.font='600 13px Arial,sans-serif';
  ctx.fillText('Comprovante não fiscal  •  WS Baterias',50,978);
  ctx.font='500 12px Arial,sans-serif';
  ctx.fillText('Página complementar '+(pages.length+1)+'  •  Direitos legais preservados',50,1000);
  pages.push(canvas);
 }
 return pages;
}
function pdfBytes(images){
 const encoder=new TextEncoder(),chunks=[];let size=0;
 const add=v=>{const bytes=typeof v==='string'?encoder.encode(v):v;chunks.push(bytes);size+=bytes.length;};
 const offsets=[0],start=n=>{offsets[n]=size;add(n+' 0 obj\n');};
 const pageCount=images.length;
 add('%PDF-1.4\n%\xC3\xA2\xC3\xA3\xC3\x8F\xC3\x93\n');
 start(1);add('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
 start(2);add('<< /Type /Pages /Count '+pageCount+' /Kids ['+
  images.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>\nendobj\n');
 for(let i=0;i<images.length;i++){
  const image=images[i];
  const pageId=3+i*3,contentId=pageId+1,imageId=pageId+2;
  start(pageId);
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 419.53 595.28] /Resources << /XObject << /Img '+
    imageId+' 0 R >> >> /Contents '+contentId+' 0 R >>\nendobj\n');
  const drawing='q\n419.53 0 0 595.28 0 0 cm\n/Img Do\nQ\n';
  start(contentId);add('<< /Length '+encoder.encode(drawing).length+' >>\nstream\n');
  add(drawing);add('endstream\nendobj\n');
  start(imageId);
  add('<< /Type /XObject /Subtype /Image /Width '+image.width+' /Height '+image.height+
   ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+
   image.bytes.length+' >>\nstream\n');
  add(image.bytes);add('\nendstream\nendobj\n');
 }
 const xref=size,objects=2+pageCount*3;
 add('xref\n0 '+(objects+1)+'\n0000000000 65535 f \n');
 for(let n=1;n<=objects;n++)add(String(offsets[n]).padStart(10,'0')+' 00000 n \n');
 add('trailer\n<< /Size '+(objects+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 const out=new Uint8Array(size);let pos=0;for(const chunk of chunks){out.set(chunk,pos);pos+=chunk.length;}
 return new Blob([out],{type:'application/pdf'});
}
export async function receiptPDFFile(sale,battery){
 const data=details(sale,battery);
 const canvases=[paint(data),...fullNotesPages(data)];
 const images=await Promise.all(canvases.map(async canvas=>{
  const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(
    blob=>blob?resolve(blob):reject(Error('Falha ao preparar o PDF.')),'image/jpeg',0.96
  ));
  return {bytes:new Uint8Array(await jpeg.arrayBuffer()),width:canvas.width,height:canvas.height};
 }));
 const pdf=pdfBytes(images);
 const slug=data.productName.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
   .replace(/[^a-z0-9]+/ig,'-').replace(/^-|-$/g,'').slice(0,65)||'Bateria';
 const day=String(data.soldDate).replace(/[^0-9-]/g,'-');
 return new File([pdf],'WS-Baterias-'+slug+'-'+day+'.pdf',{type:'application/pdf'});
}
export async function downloadReceipt(sale,battery){
 const file=await receiptPDFFile(sale,battery),url=URL.createObjectURL(file);
 const link=document.createElement('a');
 link.href=url;link.download=file.name;link.hidden=true;
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),15000);
 return file.name;
}
export async function shareReceipt(sale,battery){
 const file=await receiptPDFFile(sale,battery);
 if(navigator.canShare?.({files:[file]})&&navigator.share){
  await navigator.share({title:'WS Baterias · Comprovante de venda',text:'Segue o comprovante da sua venda.',files:[file]});
  return 'shared';
 }
 await downloadReceipt(sale,battery);
 return 'downloaded';
}
