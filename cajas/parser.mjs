export const cents=s=>{let t=String(s).replace(/\$/g,'').trim(),neg=t.includes('(')||t.startsWith('-');t=t.replace(/[()\s-]/g,'');if(t.includes(','))t=t.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(?:\.\d{3})+$/.test(t))t=t.replace(/\./g,'');let n=Number(t);if(!Number.isFinite(n))throw Error('Importe inválido: '+s);return Math.round(n*100)*(neg?-1:1)};
export function parseReport(text){
 text=text.split('\n').map(l=>l.replace(/[^\S\n]+/g,' ')).join('\n');
 if(/Ventas con Excepciones/.test(text))return parseTicketProducts(text);
 if(/C\s*I\s*E\s*R\s*R\s*E\s+D\s*E\s+C\s*A\s*J\s*A/.test(text))return parseTurnClose(text);
 const dm=text.match(/(?:Fecha:\s*|Desde el:\s*)(\d{2})\/(\d{2})\/(\d{4})/);if(!dm)throw Error('No se encontró la fecha del reporte');
 const date=`${dm[3]}-${dm[2]}-${dm[1]}`, branch=(text.match(/Sucursal:\s*(\d+)/)||[])[1];if(!branch)throw Error('No se encontró la sucursal');
 if(/Detalle de Ventas por Forma de Pago/.test(text)){
 const end=text.match(/hasta:\s*(\d{2})\/(\d{2})\/(\d{4})/);if(end&&`${end[3]}-${end[2]}-${end[1]}`!==date)throw Error('El PDF «Detalle de Ventas por Forma de Pago» abarca del '+dm[1]+'/'+dm[2]+'/'+dm[3]+' al '+end[1]+'/'+end[2]+'/'+end[3]+'. Descargá el informe con Desde y Hasta en la misma fecha. El nombre del archivo no cambia las fechas internas.');
 const rows=[];for(const original of text.split('\n')){const time=original.match(/\b([0-2]\d:[0-5]\d)(?::[0-5]\d)?\b/)?.[1],line=original.replace(/(?:\d{2}\/\d{2}\/\d{4}\s+)?\b[0-2]\d:[0-5]\d(?::[0-5]\d)?\b/g,' ').trim();const m=line.match(/^\s*(.+?)\s+(?:(\d+)\s+)?(\d{4})\s+(\d+)\s+((?:Tk|NC)\s+\w+\s+\d{4}-\d+)\s+(-?[\d.,]+)\s+(.*)$/);if(!m)continue;
 const tail=m[7].trim().replace(/^\S+\s+\S+\s+/, m[1].trim()==='Efectivo $'?'$&':'');
 rows.push({date,branch,...(time?{time}:{}),method:m[1].trim().replace(/\s+/g,' '),box:m[3],batch:m[4],ticket:m[5].replace(/\s+/g,' '),amount:cents(m[6]),cashier:tail.replace(/\s+/g,' ')});}
 if(!rows.length)throw Error('No se pudieron leer los cobros');
 const total=text.match(/^TOTAL\s+\d+\s+oper\.\s+([\d.,]+)/m);if(!total||rows.reduce((s,r)=>s+r.amount,0)!==cents(total[1]))throw Error('El detalle leído no coincide con el total: revisá el archivo');
 return {type:'sales',date,branch,rows};
 }
 if(/Planilla de Caja/.test(text)){
 const boxes=[...(text.match(/Concepto[^\n]+/)||[''])[0].matchAll(/Caja\s+(\d+)/g)].map(m=>m[1]);if(!boxes.length)throw Error('No se encontraron las cajas');
 const fields={opening:/INICIO Efectivo \$/,sales:/TOTAL VENTA \(Pesificado\)/,withdrawals:/TOTAL SALIDAS Efectivo \$/,cash:/DECLARADO Efectivo \$/,digital:/DECLARADO Cupones/};let values={};
 for(const [key,re] of Object.entries(fields)){const line=text.split('\n').find(l=>re.test(l));if(!line)throw Error('Falta el campo '+key);const nums=line.match(/\(?-?\d[\d.]*,\d{2}\)?/g)||[];if(nums.length!==boxes.length+1)throw Error('No se pudo leer '+key);values[key]=nums.map(cents);if(values[key].slice(0,-1).reduce((s,n)=>s+n,0)!==values[key].at(-1))throw Error('Total inconsistente en '+key);}
 const extraDigital=Array(boxes.length+1).fill(0),sourceMercadoPago=Array(boxes.length+1).fill(0);
 for(const line of text.split('\n').filter(l=>/DECLARADO /.test(l)&&!/DECLARADO (?:Efectivo \$|Cupones)/.test(l))){const nums=line.match(/\(?-?\d[\d.]*,\d{2}\)?/g)||[];if(nums.length!==boxes.length+1)throw Error('No se pudo leer el medio adicional declarado');const amounts=nums.map(cents);if(amounts.slice(0,-1).reduce((s,n)=>s+n,0)!==amounts.at(-1))throw Error('Total inconsistente en medio adicional declarado');amounts.forEach((n,i)=>{extraDigital[i]+=n;if(/DECLARADO M PAGO OFF(?:LINE)?(?: |$)/.test(line))sourceMercadoPago[i]+=n;});}
 return {type:'close',date,branch,rows:boxes.map((box,i)=>({date,branch,box,opening:values.opening[i],sales:values.sales[i],withdrawals:Math.abs(values.withdrawals[i]),cash:values.cash[i],digital:values.digital[i]+extraDigital[i],sourceCouponDeclared:values.digital[i],sourceMercadoPagoDeclared:sourceMercadoPago[i],extraDigitalDeclared:extraDigital[i],scope:'Día completo',cashier:'Sin asignar'}))};
 }
 throw Error('Formato no reconocido. Usá Detalle de Ventas, Planilla de Caja o Cierre de Caja de Civil Systems.');
}
export const difference=r=>r.cash+r.digital+r.withdrawals-r.opening-r.sales;
export const ticketKey=r=>`${r.date}|${r.branch}|${r.box}|${r.ticket}`;
export function summarize(rows){const cash=rows.filter(r=>r.method==='Efectivo $').reduce((s,r)=>s+r.amount,0), total=rows.reduce((s,r)=>s+r.amount,0),tickets=new Set(rows.filter(r=>r.documentType!=='NC'&&!/^NC\b/i.test(r.ticket||'')).map(ticketKey)).size;return {cash,total,digital:total-cash,tickets,average:tickets?Math.round(total/tickets):0};}

export function parseTurnClose(text){
 const stamp=label=>{const m=text.match(new RegExp(label+':\\s*(\\d{2})/(\\d{2})/(\\d{4})\\s+(\\d{2}:\\d{2})'));if(!m)throw Error('Falta '+label);return {date:`${m[3]}-${m[2]}-${m[1]}`,time:m[4]};},open=stamp('Apertura'),close=stamp('Fecha Cierre');
 if(open.date!==close.date)throw Error('El cierre cruza de día: requiere revisión');
 const box=text.match(/Caja:\s*(\d+)/)?.[1],batch=text.match(/Vuelco:\s*(\d+)/)?.[1],label=text.match(/Sucursal:\s*(\S+)/)?.[1],branch=label==='GON-1970'?'01':/^\d+$/.test(label||'')?label.padStart(2,'0'):null;
 if(!box||!batch||!branch)throw Error('Caja, vuelco o sucursal no reconocidos');
 const value=(re,optional=false)=>{const line=text.split('\n').find(l=>re.test(l));if(!line){if(optional)return 0;throw Error('Falta '+re.source)}const m=line.match(/(-?[\d.,]+)\s*$/);if(!m)throw Error('Importe ilegible');return cents(m[1]);};
 const opening=value(/^Saldo Inicial Efectivo/),grossSales=value(/^Ing\. x Venta \[TC=/),credits=text.split('\n').filter(l=>/^N\. de Cr[eé]dito /.test(l)&&!/\[TC=/.test(l)).reduce((n,l)=>n+cents(l.match(/(-?[\d.,]+)\s*$/)[1]),0),sales=grossSales+credits,movement=value(/^Movimientos Efectivo/),cash=value(/^TOTAL Declarado Efectivo/),digital=value(/^T[O0]TAL Declarado CUPONES/,true),final=value(/^Saldo Final \[TC=/),declared=value(/^T[O0]TAL Declarado \[TC=/),systemDifference=value(/^Diferencia \[TC=/);
 const methodTotal=re=>text.split('\n').filter(l=>re.test(l)&&!/\[TC=/.test(l)).reduce((sum,l)=>{const m=l.match(/(-?[\d.,]+)\s*$/);if(!m)throw Error('Importe ilegible');return sum+cents(m[1]);},0),allSales=methodTotal(/^Ing\. x Venta /),allFinal=methodTotal(/^Saldo Final /),allDeclared=methodTotal(/^T[O0]TAL Declarado /);if(allSales!==grossSales||allFinal!==final||opening+sales+movement!==final||allDeclared!==declared||final-declared!==systemDifference)throw Error('Los totales del cierre no coinciden');
 const extraDigitalDeclared=allDeclared-cash-digital;
 const remainder=value(/^Resto en Caja Efectivo/),closingWithdrawal=text.split('\n').filter(l=>/^RETIRO EFECTIVO X CIERRE/.test(l)).reduce((n,l)=>n-cents(l.match(/(-?[\d.,]+)\s*$/)[1]),0);if(remainder<0||closingWithdrawal<0||cash-closingWithdrawal!==remainder)throw Error('El resto en caja y el retiro al cierre no coinciden');
 const tickets=text.match(/Tickets:\s*(\d+)\s+al\s+(\d+)/),operations=Number(text.match(/Cantidad de Operaciones:\s*(\d+)/)?.[1]||0);
 const expenses=text.split('\n').map(l=>l.match(/^(GASTO\b.*?)\s+(-?[\d.,]+)\s*$/i)).filter(Boolean).map((m,index)=>({index,description:m[1],amount:-cents(m[2])}));if(expenses.some(e=>e.amount<=0))throw Error('Gasto del cierre no válido');
 const row={expenses,date:close.date,branch,box:box.padStart(4,'0'),batch,scope:'Turno PDF',openTime:open.time,closeTime:close.time,opening,sales,grossSales,credits,remainder,closingWithdrawal,withdrawals:-movement,cash,digital:digital+extraDigitalDeclared,sourceCouponDeclared:digital,sourceMercadoPagoDeclared:methodTotal(/^T[O0]TAL Declarado M PAGO OFF(?:LINE)?(?: |$)/),extraDigitalDeclared,systemDifference,firstTicket:tickets?.[1]||'',lastTicket:tickets?.[2]||'',operations,cashier:text.match(/Cajero\/a:\s*([^\n]+)/)?.[1]?.trim()||''};
 return {type:'turnClose',date:close.date,branch,rows:[row]};
}

export function parseTicketProducts(text){
 text=text.split('\n').map(l=>l.replace(/[^\S\n]+/g,' ').trim()).join('\n');
 const header=text.match(/Ventas con Excepciones\s*-\s*\((\d{2})\/(\d{2})\/(\d{4})\s+al\s+(\d{2})\/(\d{2})\/(\d{4})\)/);if(!header)throw Error('No se encontró la fecha de tickets');
 const date=`${header[3]}-${header[2]}-${header[1]}`;if(date!==`${header[6]}-${header[5]}-${header[4]}`)throw Error('Importá tickets de un solo día');
 const summary=[];for(const line of text.split('\n')){const m=line.match(/^\d{2}\/\d{2}\/\d{4}\s+(\S+)\s+(\d{4})\s+(\d+)\s+(-?[\d.,]+)\s/);if(m)summary.push({label:m[1],box:m[2],count:Number(m[3]),amount:cents(m[4])});}
 const top=text.match(/^Total:\s+(\d+)\s+(-?[\d.,]+)/m);if(!top||!summary.length)throw Error('Falta resumen de tickets');
 let context=null,current=null;const rows=[];
 for(const line of text.split('\n')){
  const ctx=line.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*Pto\. de Venta:\s*(\d+)\s*-\s*Sucursal:\s*(\S+)/);if(ctx){if(current)throw Error('Ticket sin cierre');const label=ctx[5],branch=label==='GON-1970'?'01':/^\d+$/.test(label)?label.padStart(2,'0'):null;if(!branch)throw Error('Sucursal no reconocida');if(`${ctx[3]}-${ctx[2]}-${ctx[1]}`!==date)throw Error('Fecha de ticket incorrecta');context={date,branch,box:ctx[4].padStart(4,'0')};continue;}
  const receipt=line.match(/^Tk\s+N[º°o]?\s*(\d{4}-\d+)/i);if(receipt){if(current)throw Error('Ticket anterior incompleto');if(!context||receipt[1].slice(0,4)!==context.box)throw Error('Caja del ticket no coincide');current={...context,ticket:receipt[1],items:[]};continue;}
  const end=line.match(/^Descuento:\s*([\d.,]+)%\s+(\d{2}:\d{2})\s*hs\s+Importe:\s*(-?[\d.,]+)/);if(end){if(!current||!current.items.length)throw Error('Ticket sin productos');current.time=end[2];current.amount=cents(end[3]);current.discountPercent=Number(end[1].replace(',','.'));if(!Number.isFinite(current.discountPercent)||current.discountPercent<0||current.discountPercent>100)throw Error('Descuento inválido');current.gross=current.items.reduce((a,x)=>a+x.gross,0);current.discount=current.gross-current.amount;if(current.gross<0||current.amount<0)throw Error('Ticket negativo requiere revisión');const calculated=Math.round(current.gross*(100-current.discountPercent)/100);if(Math.abs(calculated-current.amount)>Math.max(5,current.items.length,Math.ceil(Math.abs(current.gross)*0.00005)+1))throw Error('Los productos y el total del ticket '+current.ticket+' no coinciden: '+current.gross+' / '+current.amount);allocateNet(current.items,current.amount,current.gross);rows.push(current);current=null;continue;}
  if(current){const item=line.match(/^(\d{1,10})\s+(.+?)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s+([\d.,]+)%$/);if(item){const quantity=Number(item[3].replace(',','.'));if(!Number.isFinite(quantity)||quantity===0)throw Error('Cantidad inválida');const gross=cents(item[4]);if(gross!==0&&Math.sign(gross)!==Math.sign(quantity))throw Error('Signo de producto inconsistente');current.items.push({code:item[1],name:item[2],quantity,gross,bonusPercent:Number(item[5].replace(',','.'))});}else if(/^\d{1,10}\s/.test(line))throw Error('No se pudo leer una línea de producto');}
 }
 if(current)throw Error('El último ticket está incompleto');
 if(rows.length!==Number(top[1])||Math.abs(rows.reduce((a,r)=>a+r.amount,0)-cents(top[2]))>1)throw Error('Tickets leídos no coinciden con el total del reporte');
 const keys=new Set();for(const row of rows){const key=row.box+'|'+row.ticket;if(keys.has(key))throw Error('Ticket repetido en el reporte');keys.add(key);}
 for(const box of summary){const rs=rows.filter(r=>r.box===box.box);if(rs.length!==box.count||Math.abs(rs.reduce((a,r)=>a+r.amount,0)-box.amount)>1)throw Error('Total por caja inconsistente');}
 return {type:'tickets',date,branch:rows[0].branch,rows,total:rows.reduce((n,r)=>n+r.amount,0),summaryTotal:cents(top[2]),roundingDifference:rows.reduce((n,r)=>n+r.amount,0)-cents(top[2]),ticketCount:rows.length};
}
function allocateNet(items,total,gross){if(!gross){if(total)throw Error('Ticket sin importe bruto');for(const x of items)x.net=x.gross;return;}let allocated=0;const shares=items.map((x,i)=>{const value=x.gross*total/gross;x.net=Math.floor(value);allocated+=x.net;return {i,fraction:value-x.net}}).sort((a,b)=>b.fraction-a.fraction||a.i-b.i);for(let n=0;n<total-allocated;n++)items[shares[n%shares.length].i].net++;}
