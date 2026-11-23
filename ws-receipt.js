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
function details(s,b){
 if(!s||!b||s.cancelled_at)throw Error('Venda não disponível para emitir comprovante.');
 return {
  code:val(b.code)||'VENDA-'+val(s.id).slice(0,8).toUpperCase(),
  customer:val(s.customer_name)||'Não informado',
  phone:val(s.customer_phone),plate:val(s.vehicle_plate),
  brand:val(b.brand),model:val(b.model),amperage:Number(b.amperage_ah)||null,
  serial:val(b.serial_number),price:Number(s.sale_price_cents),
  payment:payments[s.payment_method]||'Outro',warranty:Number(s.warranty_days)||0,
  soldAt:stamp(s.sold_at),recordedAt:stamp(s.recorded_at||s.sold_at),
  isHistorical:!!s.is_historical,notes:val(s.notes),issuedAt:stamp(new Date())
 };
}
const field=(label,value)=>'<div class="ws-receipt-field"><span>'+esc(label)+'</span><strong>'+esc(value||'—')+'</strong></div>';
export function receiptHTML(sale,battery){
 const d=details(sale,battery);
 return [
  '<article class="ws-receipt" aria-label="Comprovante de venda WS Baterias">',
  '<div class="ws-receipt-hero">',
  '<div class="ws-receipt-identity"><div class="ws-logo-icon" aria-hidden="true"><b>WS</b><span>▰</span></div>',
  '<div><div class="ws-identity-overline">COMPROVANTE DIGITAL</div>',
  '<div class="ws-identity-title">WS <span>BATERIAS</span></div>',
  '<div class="ws-identity-sub">Baterias usadas e recuperadas</div></div></div>',
  '<div class="ws-receipt-hero-foot"><span>COMPROVANTE DE VENDA</span><strong>DOCUMENTO NÃO FISCAL</strong></div></div>',
  '<div class="ws-receipt-pad"><div class="ws-receipt-meta">',
  field('Referência da venda',d.code),field('Data da venda',d.soldAt),
  d.isHistorical?field('Cadastrada no sistema',d.recordedAt):'',
  '</div><div class="ws-receipt-section"><h4>01 <span>Dados do cliente</span></h4><div class="ws-receipt-fields">',
  field('Cliente',d.customer),d.phone?field('Contato',d.phone):'',
  '</div></div><div class="ws-receipt-section"><h4>02 <span>Produto vendido</span></h4>',
  '<div class="ws-receipt-item"><span class="ws-item-symbol" aria-hidden="true">▰</span><div><strong>',
  esc([d.brand,d.model].filter(Boolean).join(' · ')),
  '</strong><small>Bateria usada / recuperada · Quantidade: 1 unidade</small></div></div>',
  '<div class="ws-receipt-fields">',
  d.amperage?field('Amperagem',d.amperage+' Ah'):'',
  d.serial?field('Número de série',d.serial):'',
  d.plate?field('Placa do veículo',d.plate):'',
  '</div></div><div class="ws-receipt-section"><h4>03 <span>Detalhes da venda</span></h4>',
  '<div class="ws-receipt-fields">',field('Forma de pagamento informada',d.payment),'</div>',
  '<div class="ws-receipt-total"><span>VALOR DA VENDA</span><strong>',esc(money(d.price)),'</strong></div></div>',
  '<div class="ws-receipt-section"><h4>04 <span>Garantia</span></h4>',
  '<p class="ws-warranty-copy">',esc(warranty(d.warranty)),'</p>',
  '<p class="ws-warranty-legal">Os direitos de garantia legal previstos no Código de Defesa do Consumidor permanecem preservados.</p></div>',
  d.notes?'<div class="ws-receipt-section ws-receipt-notes"><h4>05 <span>Observações</span></h4><p>'+esc(d.notes)+'</p></div>':'',
  '<div class="ws-receipt-finish"><div>Emitido em ',esc(d.issuedAt),' · Horário de Brasília</div>',
  '<strong>WS BATERIAS</strong><p>Este comprovante documenta a venda registrada. Não substitui documento fiscal obrigatório e não comprova quitação bancária.</p>',
  '</div></div></article>'
 ].join('');
}
function paint(data){
 const W=720,H=1018,scale=2;
 const canvas=document.createElement('canvas');canvas.width=W*scale;canvas.height=H*scale;
 const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Não foi possível criar a notinha.');
 ctx.scale(scale,scale);
 const NAVY='#0b2449',BLUE='#1877f2',INK='#102744',SLATE='#516b8d',PALE='#f1f7ff',LINE='#dce8f8';
 const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
 const line=(x,y,ex,ey,color=LINE,width=1)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.stroke();};
 const text=(s,x,y,size=17,color=INK,weight=500,align='left')=>{
  ctx.fillStyle=color;ctx.font=String(weight)+' '+size+'px Arial, sans-serif';
  ctx.textAlign=align;ctx.fillText(String(s??''),x,y);ctx.textAlign='left';
 };
 const wrap=(s,x,y,maxWidth,size=15,color=INK,lineH=22,maxLines=20,weight=500)=>{
  ctx.font=String(weight)+' '+size+'px Arial,sans-serif';
  const paragraphs=String(s??'').split(/\r?\n/);let lines=[];
  for(const paragraph of paragraphs){
   let current='';
   for(const word of (paragraph||' ').split(/\s+/)){
    const probe=(current?current+' ':'')+word;
    if(ctx.measureText(probe).width<=maxWidth){current=probe;}else{
     if(current)lines.push(current);current=word;
     while(ctx.measureText(current).width>maxWidth&&current.length>1){
      let i=1;while(i<current.length&&ctx.measureText(current.slice(0,i+1)).width<=maxWidth)i++;
      lines.push(current.slice(0,i));current=current.slice(i);
     }
    }
   }
   lines.push(current);
  }
  const clipped=lines.length>maxLines;lines=lines.slice(0,maxLines);
  if(clipped&&lines.length)lines[lines.length-1]=lines[lines.length-1].slice(0,-2)+'…';
  lines.forEach((str,i)=>text(str,x,y+i*lineH,size,color,weight));
  return y+lines.length*lineH;
 };
 rect(0,0,W,H,'#ffffff');rect(0,0,W,170,NAVY);rect(0,163,W,7,BLUE);
 rect(45,29,86,86,BLUE);text('WS',88,86,39,'#fff',900,'center');
 text('WS BATERIAS',149,76,36,'#fff',800);
 text('Baterias usadas e recuperadas',150,104,16,'#b8d7ff',500);
 text('COMPROVANTE DE VENDA',47,149,19,'#fff',800);
 text('DOCUMENTO NÃO FISCAL',674,149,12,'#bbd6fb',700,'right');
 const pad=48;
 text('REFERÊNCIA DA VENDA',pad,215,13,SLATE,800);
 text(data.code,pad,243,22,INK,800);
 text('DATA DA VENDA',pad+333,215,13,SLATE,800);
 text(data.soldAt,pad+333,243,16,INK,700);
 line(pad,267,W-pad,267);
 let y=292;
 const heading=(number,label)=>{
  rect(pad,y-17,29,27,BLUE);text(number,pad+14,y+1,14,'#fff',800,'center');
  text(label,pad+41,y+1,19,INK,800);y+=31;
 };
 heading('01','Cliente');
 y=wrap(data.customer,pad,y+7,620,20,INK,23,2,700)+2;
 if(data.phone){text('Contato: '+data.phone,pad,y+4,14,SLATE,600);y+=22;}
 y+=12;line(pad,y,W-pad,y);y+=30;
 heading('02','Produto');
 y=wrap([data.brand,data.model].filter(Boolean).join(' · '),pad,y+7,614,20,INK,24,2,750)+4;
 text('Bateria usada / recuperada · 1 unidade',pad,y+3,15,SLATE,600);y+=25;
 const tags=[];
 if(data.amperage)tags.push(data.amperage+' Ah');
 if(data.serial)tags.push('Série: '+data.serial);
 if(data.plate)tags.push('Placa: '+data.plate);
 if(tags.length)y=wrap(tags.join('    •    '),pad,y+4,620,13,SLATE,19,2,600)+4;
 y+=8;line(pad,y,W-pad,y);y+=30;
 heading('03','Pagamento e valor');
 text('FORMA INFORMADA',pad,y+6,12,SLATE,750);text(data.payment,pad,y+27,18,INK,700);y+=52;
 rect(pad,y,624,80,PALE);rect(pad,y,8,80,BLUE);
 text('VALOR DA VENDA',pad+24,y+31,15,SLATE,800);
 text(money(data.price),W-pad-24,y+54,34,BLUE,850,'right');y+=98;
 heading('04','Garantia');
 text(warranty(data.warranty),pad,y+8,17,INK,750);y+=34;
 y=wrap('A garantia legal prevista no CDC permanece aplicável.',pad,y+4,615,14,SLATE,20,2,500)+8;
 if(data.notes){text('OBSERVAÇÕES',pad,y+11,12,SLATE,800);y+=27;
  if(y<890)y=wrap(data.notes,pad,y,620,13,INK,19,Math.max(1,Math.floor((935-y)/19)),500)+6;
 }
 rect(0,955,W,63,NAVY);
 text('WS BATERIAS   •   Emitido em '+data.issuedAt,48,981,13,'#e2efff',700);
 text('Comprovante não fiscal • Não comprova quitação bancária',48,1001,11,'#b8d7ff',500);
 return canvas;
}
function pdfBytes(jpeg,width,height){
 const encoder=new TextEncoder(),chunks=[];let size=0;
 const add=v=>{const bytes=typeof v==='string'?encoder.encode(v):v;chunks.push(bytes);size+=bytes.length;};
 const offsets=[0],start=n=>{offsets[n]=size;add(n+' 0 obj\n');};
 add('%PDF-1.4\n%\xC3\xA2\xC3\xA3\xC3\x8F\xC3\x93\n');
 start(1);add('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
 start(2);add('<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n');
 start(3);add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 419.53 595.28] /Resources << /XObject << /Img 5 0 R >> >> /Contents 4 0 R >>\nendobj\n');
 const drawing='q\n419.53 0 0 595.28 0 0 cm\n/Img Do\nQ\n';
 start(4);add('<< /Length '+encoder.encode(drawing).length+' >>\nstream\n');
 add(drawing);add('endstream\nendobj\n');
 start(5);add('<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+
  ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n');
 add(jpeg);add('\nendstream\nendobj\n');
 const xref=size;add('xref\n0 6\n0000000000 65535 f \n');
 for(let n=1;n<=5;n++)add(String(offsets[n]).padStart(10,'0')+' 00000 n \n');
 add('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 const out=new Uint8Array(size);let pos=0;for(const x of chunks){out.set(x,pos);pos+=x.length;}
 return new Blob([out],{type:'application/pdf'});
}
export async function receiptPDFFile(sale,battery){
 const data=details(sale,battery),canvas=paint(data);
 const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Falha ao preparar PDF.')),'image/jpeg',0.96));
 const pdf=pdfBytes(new Uint8Array(await jpeg.arrayBuffer()),canvas.width,canvas.height);
 return new File([pdf],'WS-Baterias-Comprovante-'+data.code.replace(/[^a-z0-9_-]/ig,'-')+'.pdf',{type:'application/pdf'});
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
