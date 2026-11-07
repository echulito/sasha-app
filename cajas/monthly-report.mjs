import {normalizeState,withDerivedCache,allTurns,assign,roster,isClosedDay,daySales,transactionRows,ticketRows,productLines,storeExpenses,closingBalance,turnCollection,controlStatus,dayObservations,loadErrors} from './domain.mjs';
import {summarize} from './parser.mjs';
import {declaredCashWithdrawals} from './summary-metrics.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n===null?'Sin datos':new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(n/100);
const date=d=>d.split('-').reverse().join('/');
const sum=(rows,key)=>rows.reduce((n,r)=>n+(r[key]||0),0);
export function argentinaToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function monthEnded(month,now=new Date()){return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month<argentinaToday(now).slice(0,7);}
export function monthDates(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Elegí un mes válido');const [y,m]=month.split('-').map(Number),days=new Date(Date.UTC(y,m,0)).getUTCDate();return Array.from({length:days},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));}

export function monthlyReport(raw,month,cashierId='',now=new Date()){
 if(!monthEnded(month,now))throw Error('El resumen final estará disponible cuando termine el mes en Argentina.');
 const s=normalizeState(structuredClone(raw));return withDerivedCache(s,()=>{
  const dates=monthDates(month),monthTurns=allTurns(s).filter(t=>t.date.startsWith(month)),people=s.cashiers.filter(c=>monthTurns.some(t=>assign(s,t,'close').id===c.id)||dates.some(d=>!isClosedDay(d,s)&&roster(s,d).some(p=>p.id===c.id)));
  if(cashierId&&!people.some(c=>c.id===cashierId))throw Error('Cajera no disponible en este mes');
  const belongs=t=>!cashierId||assign(s,t,'close').id===cashierId,turns=monthTurns.filter(belongs),receipts=transactionRows(s).filter(r=>r.date.startsWith(month)&&(!cashierId||assign(s,r).id===cashierId));
  const daily=dates.map(d=>{const ts=turns.filter(t=>t.date===d),rs=receipts.filter(r=>r.date===d),bs=ts.map(t=>closingBalance(s,t)),cs=ts.map(t=>turnCollection(s,t)),closed=isClosedDay(d,s),has=s.reports.some(r=>r.date===d)||s.manual.some(r=>r.date===d),st=has?controlStatus(s,d):null;
   const scheduled=roster(s,d).find(c=>c.id===cashierId),explicit=s.attendance.find(a=>a.date===d)?.people.find(c=>c.id===cashierId);
   const attendance=!cashierId?'—':closed?'Local cerrado':!scheduled?'Fuera de vigencia':explicit?(explicit.present?'Presente registrada':'Ausente registrada'):ts.length?'Actividad registrada':'Sin asistencia registrada';
   const count=rs.length?summarize(rs).tickets:null,revenue=cashierId?(rs.length?summarize(rs).total:sum(ts,'sales')):daySales(s,d);
   return {date:d,closed,has,attendance,absent:!!explicit&&!explicit.present&&!closed,worked:!closed&&(!!explicit?.present||ts.length>0),revenue,tickets:count,average:count?Math.round(revenue/count):null,shortage:bs.reduce((n,b)=>n+Math.max(0,-b.net),0),surplus:bs.reduce((n,b)=>n+Math.max(0,b.net),0),net:sum(bs,'net'),cash:declaredCashWithdrawals(ts),mp:cs.reduce((n,c)=>n+(c.allocation?.mercadoPago||0),0),dni:cs.reduce((n,c)=>n+(c.allocation?.cuentaDni||0),0),other:cs.reduce((n,c)=>n+(c.allocation?.other||0),0),orders:sum(cs,'pendingOrders'),failed:sum(cs,'failed'),state:closed&&!has?'Cerrado':!has?'Sin importar':st.complete&&s.completedDays.includes(d)?'Confirmado':st.complete?'Listo para confirmar':'Revisión pendiente',issues:st?.issues||[]};});
  const expenses=storeExpenses(s).filter(e=>e.date.startsWith(month)&&(!cashierId||turns.some(t=>t.date===e.date&&t.branch===e.branch&&t.box===e.box&&t.batch===e.batch)));
  const products=productLines(s).filter(p=>p.date.startsWith(month)&&(!cashierId||p.cashierId===cashierId));
  const activity=daily.filter(d=>cashierId?turns.some(t=>t.date===d.date):d.has),missing=daily.filter(d=>!d.closed&&!d.has).map(d=>d.date),pending=daily.filter(d=>d.has&&d.state!=='Confirmado').map(d=>d.date),ticketComplete=activity.length>0&&activity.every(d=>d.tickets!==null);
  const totals={revenue:sum(daily,'revenue'),tickets:ticketComplete?sum(daily,'tickets'):null,shortage:sum(daily,'shortage'),surplus:sum(daily,'surplus'),net:sum(daily,'net'),cash:sum(daily,'cash'),mp:sum(daily,'mp'),dni:sum(daily,'dni'),other:sum(daily,'other'),orders:sum(daily,'orders'),failed:sum(daily,'failed'),expenses:sum(expenses,'amount'),units:sum(products,'quantity'),products:new Set(products.map(p=>p.code)).size,worked:daily.filter(d=>d.worked).length,absences:daily.filter(d=>d.absent).length,daysWithShortage:daily.filter(d=>d.shortage>0).length,daysWithSurplus:daily.filter(d=>d.surplus>0).length};
  totals.average=totals.tickets?Math.round(totals.revenue/totals.tickets):null;totals.ticketsPerDay=totals.tickets!==null&&activity.length?totals.tickets/activity.length:null;
  return {month,cashierId,name:cashierId?people.find(c=>c.id===cashierId).name:'General del local',generatedAt:now.toISOString(),people,attendance:people.map(p=>({name:p.name,rows:dates.filter(d=>!isClosedDay(d,s)&&roster(s,d).some(c=>c.id===p.id)).map(d=>{const entry=s.attendance.find(a=>a.date===d)?.people.find(c=>c.id===p.id),activity=monthTurns.some(t=>t.date===d&&assign(s,t,'close').id===p.id);return {date:d,status:entry?(entry.present?'Presente registrada':'Ausente registrada'):activity?'Actividad registrada':'Sin asistencia registrada'};})})),daily,totals,missing,pending,expenses,turns:turns.map(t=>({...t,person:assign(s,t,'close').name,balance:closingBalance(s,t),collection:turnCollection(s,t)})),corrections:(s.closingCorrections||[]).filter(c=>c.date.startsWith(month)&&(!cashierId||c.cashierId===cashierId)),failures:s.failedPayments.filter(f=>f.date.startsWith(month)&&(!cashierId||turns.some(t=>t.date===f.date&&t.branch===f.branch&&t.box===f.box&&t.batch===f.batch))),observations:dates.flatMap(d=>dayObservations(s,d)).filter(o=>!cashierId||o.cashierId===cashierId),loadErrors:loadErrors(s,{month,cashierId})};
 });
}
function table(headers,rows){return '<table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
// Sasha v96 (modelo A): arriba un resumen corto (6 números, "En pocas palabras", cómo se cobró) y después el desglose
// con una línea de explicación en cada parte. Pensado para imprimir en A4 vertical.
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const pesosExactos=n=>(n<0?'-':'+')+'$ '+(Math.abs(n)/100).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
const pesos=n=>n===null||n===undefined?'—':(n<0?'-':'')+'$ '+Math.round(Math.abs(n)/100).toLocaleString('es-AR');
const signo=n=>n===null||n===undefined?'—':(n>0?'+':'')+pesos(n);
const millones=n=>'$ '+(Math.abs(n)/1e8).toFixed(1).replace('.',',')+' M';
const grande=n=>Math.abs(n)>=1e8?millones(n):pesos(n);
const pctTxt=(a,b)=>b>0?Math.round(a/b*100)+'%':'—';
function mesTxt(m){const [y,mm]=m.split('-');return MESES[Number(mm)-1].replace(/^./,c=>c.toUpperCase())+' '+y;}
function tablaA(headers,rows,clases){return '<table><thead><tr>'+headers.map((h,i)=>'<th'+(i?' class="n"':'')+'>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map((v,i)=>'<td'+(i?' class="n'+(clases&&clases[i]?' '+clases[i](v,r):'')+'"':'')+'>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
function seccion(titulo,explica,cuerpo){return '<section class="sec"><h2>'+esc(titulo)+'</h2>'+(explica?'<p class="exp">'+explica+'</p>':'')+cuerpo+'</section>';}
export function reportBody(r,general){const t=r.totals,esCaj=!!r.cashierId,[y,mm]=r.month.split('-'),ultimo=new Date(Date.UTC(Number(y),Number(mm),0)).getUTCDate();
 const parte=esCaj&&general&&general.totals.revenue>0?Math.round(t.revenue/general.totals.revenue*100):null;
 const cajas=[['Facturación',pesos(t.revenue),''],['Tickets · promedio',t.tickets===null?'Detalle incompleto':t.tickets.toLocaleString('es-AR')+' · '+pesos(t.average),''],
  esCaj?['Días trabajados',t.worked+' <span class="chico">· '+t.absences+(t.absences===1?' ausencia':' ausencias')+'</span>','']:['Días con actividad',String(r.daily.filter(d=>d.has).length),''],
  ['Faltantes',pesos(t.shortage),t.shortage>0?'neg':''],['Sobrantes',pesos(t.surplus),t.surplus>0?'pos':''],['Saldo neto',signo(t.net),t.net<0?'neg':t.net>0?'pos':'']];
 const cobros=[['Efectivo declarado (retiros)',t.cash],['Mercado Pago',t.mp],['Cuenta DNI',t.dni],['Otros electrónicos',t.other],['Pedidos a cobrar',t.orders],['Cobros no efectuados',t.failed]].filter(x=>x[1]>0);
 const puntos=[
  (esCaj?'Facturó ':'El local facturó ')+'<b>'+grande(t.revenue)+'</b>'+(parte!==null?', el <b>'+parte+'%</b> del local':'')+(t.average?', con un ticket promedio de <b>'+pesos(t.average)+'</b>':'')+'.',
  'Tuvo faltante en <b>'+t.daysWithShortage+(t.daysWithShortage===1?' día':' días')+'</b> y sobrante en <b>'+t.daysWithSurplus+'</b>; el saldo del mes queda en <b>'+signo(t.net)+'</b>.',
  cobros.length?'Se cobró '+cobros.filter(x=>!/no efectuados/.test(x[0])).map(x=>'<b>'+grande(x[1])+'</b> '+(x[0]==='Efectivo declarado (retiros)'?'en efectivo':'por '+x[0])).join(', ')+'.':'',
  t.expenses>0?'Gastos del local pagados '+(esCaj?'de su caja':'con la caja')+': <b>'+pesos(t.expenses)+'</b> ('+r.expenses.length+(r.expenses.length===1?' gasto':' gastos')+').':'Sin gastos del local en '+(esCaj?'sus cierres':'los cierres')+'.',
  t.failed>0?'Cobros no efectuados: <b>'+pesos(t.failed)+'</b> (plata que no entró).':'',
  // Sasha v106: veces que hubo que corregir lo que cargó la cajera.
  (r.loadErrors||[]).length?'Errores de carga: <b>'+r.loadErrors.length+'</b> '+(r.loadErrors.length===1?'vez':'veces')+' hubo que corregir lo que '+(esCaj?'cargó':'cargaron las cajeras')+'.':(esCaj?'Sin errores de carga.':'')].filter(Boolean);
 const pend=r.missing.length||r.pending.length?'<div class="warn"><b>Pendiente:</b> '+(r.missing.length?r.missing.length+(r.missing.length===1?' día sin importar':' días sin importar')+' ('+esc(r.missing.map(date).map(x=>x.slice(0,5)).join(', '))+')':'')+(r.missing.length&&r.pending.length?' · ':'')+(r.pending.length?r.pending.length+(r.pending.length===1?' día sin confirmar':' días sin confirmar')+' ('+esc(r.pending.map(date).map(x=>x.slice(0,5)).join(', '))+')':'')+'. Los montos de esos días pueden cambiar.</div>':'<div class="okmsg">Todos los días del mes están importados y confirmados.</div>';
 const rojo=v=>v&&v!=='—'&&v!=='$ 0'?'neg':'',verde=v=>v&&v!=='—'&&v!=='$ 0'?'pos':'';
 const dias=r.daily.filter(d=>d.has||d.absent);
 let h='<header class="top"><div><h1>Sasha · Resumen de '+esc(esCaj?r.name:'todo el local')+'</h1><div class="sub">'+esc(mesTxt(r.month))+' · del 01/'+mm+' al '+ultimo+'/'+mm+'</div></div><div class="sub der">Emitido '+esc(new Date(r.generatedAt).toLocaleDateString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}))+'</div></header>';
 h+='<div class="k">'+cajas.map(([k,v,c])=>'<div><small>'+esc(k)+'</small><b class="'+c+'">'+v+'</b></div>').join('')+'</div>';
 h+='<h2>En pocas palabras</h2><ul>'+puntos.map(x=>'<li>'+x+'</li>').join('')+'</ul>'+pend;
 if(cobros.length)h+='<h2>Cómo se cobró</h2>'+tablaA(['Medio','Importe','% de lo facturado'],cobros.map(x=>[x[0],pesos(x[1]),pctTxt(x[1],t.revenue)]));
 h+='<h2 class="des">Desglose · de acá en adelante el detalle</h2>';
 h+=seccion('Cada día','<b>Ventas</b> del día'+(esCaj?' en sus turnos':'')+', <b>tickets</b>, y <b>faltante</b> y <b>sobrante</b> de los cierres (se suman por separado: un sobrante no tapa un faltante). <b>Control</b>: si el día quedó confirmado.',
  tablaA(['Día',...(esCaj?['Asistencia']:[]),'Ventas','Tickets','Faltante','Sobrante','Saldo','Control'],dias.map(d=>[date(d.date).slice(0,5),...(esCaj?[d.attendance]:[]),d.has?pesos(d.revenue):'—',d.tickets??'—',d.has?pesos(d.shortage):'—',d.has?pesos(d.surplus):'—',d.has?signo(d.net):'—',d.state]),esCaj?[0,0,0,0,rojo,verde,0,0]:[0,0,0,rojo,verde,0,0]));
 h+=seccion('Cómo se cobró cada día','<b>Efectivo declarado</b> son los retiros de efectivo (alivios y retiro al cierre), no "ventas menos cupones". <b>Pedidos</b>: ventas facturadas que se cobran al entregar.',
  tablaA(['Día','Efectivo','Mercado Pago','Cuenta DNI','Otros','Pedidos','No efectuados'],r.daily.filter(d=>d.has).map(d=>[date(d.date).slice(0,5),pesos(d.cash),pesos(d.mp),pesos(d.dni),pesos(d.other),pesos(d.orders),pesos(d.failed)])));
 h+=seccion('Gastos del local · '+pesos(t.expenses),'Salen de la caja 3 y ya están dentro de las salidas de efectivo del cierre: no se descuentan dos veces. El comprobante es opcional.',
  r.expenses.length?tablaA(['Día','Cajera','Caja / vuelco','Concepto','Importe','Comprobante'],r.expenses.map(e=>[date(e.date).slice(0,5),e.cashier,e.box+' / '+e.batch,e.description,pesos(e.amount),e.receipt?.name?'Sí':'No'])):'<p class="nada">No hay gastos registrados.</p>');
 h+=seccion('Cierres por turno y caja','Cada cierre de caja del PDF: ventas, efectivo contado y el saldo que dejó. <b>Cupones</b>: si se corroboraron con Mercado Pago y Cuenta DNI.',
  tablaA(['Día','Cajera','Caja / vuelco','Horario','Ventas','Efectivo contado','Saldo','Cupones'],r.turns.map(x=>[date(x.date).slice(0,5),x.person,x.box+' / '+x.batch,(x.openTime||'')+'–'+(x.closeTime||''),pesos(x.sales),pesos(x.cash),signo(x.balance.net),x.collection.verified?'Corroborados':'Pendientes'])));
 h+=seccion('Asistencia','Solo cuentan las ausencias registradas; que falte un dato no quiere decir que haya faltado.',
  tablaA(['Cajera','Días trabajados','Ausencias','Fechas de ausencia'],r.attendance.filter(p=>!esCaj||p.name===r.name).map(p=>[p.name,p.rows.filter(x=>['Presente registrada','Actividad registrada'].includes(x.status)).length,p.rows.filter(x=>x.status==='Ausente registrada').length,p.rows.filter(x=>x.status==='Ausente registrada').map(x=>date(x.date).slice(0,5)).join(', ')||'—'])));
 h+=seccion('Correcciones','Importes del cierre que se corrigieron a mano, con el motivo. El PDF original se conserva.',
  r.corrections.length?tablaA(['Día','Cajera','Caja / vuelco','Qué','Antes','Después','Motivo'],r.corrections.map(c=>[date(c.date).slice(0,5),c.cashier,c.box+' / '+c.batch,({cash:'Efectivo',opening:'Apertura',digital:'Cupones',withdrawals:'Alivios',closingWithdrawal:'Retiro cierre'})[c.field]||c.field,pesos(c.before),pesos(c.after),c.note])):'<p class="nada">Sin correcciones.</p>');
 h+=seccion('Cobros no efectuados','Pagos con tarjeta o QR que figuran en el cierre pero no se acreditaron.',
  r.failures.length?tablaA(['Día','Caja / vuelco','Medio','Importe','Referencia'],r.failures.map(f=>[date(f.date).slice(0,5),f.box+' / '+f.batch,f.method,pesos(f.amount),f.note])):'<p class="nada">Sin cobros no efectuados.</p>');
 if((r.loadErrors||[]).length){const porCaj=new Map();r.loadErrors.forEach(e=>porCaj.set(e.cashier||'Sin asignar',(porCaj.get(e.cashier||'Sin asignar')||0)+1));
  h+=seccion('Errores de carga · '+r.loadErrors.length,'Lo que hubo que corregir porque se cargó mal en el sistema. Sirve para darle seguimiento.',
   (esCaj?'':tablaA(['Cajera','Errores de carga'],[...porCaj].map(([n,c])=>[n,String(c)])))+tablaA(['Día','Cajera','Caja / vuelco','Qué','Detalle'],r.loadErrors.map(e=>[date(e.date).slice(0,5),e.cashier,e.box+' / '+e.batch,e.what,e.note.replace(/^.*?Error de carga de la cajera:?\s*/,'')||'—'])));}
 // Sasha v103: pedidos online facturados por la Caja 3 (van solo por la Caja 1).
 if(r.observations&&r.observations.length)h+=seccion('Observaciones del día','Lo que queda registrado aunque el saldo de la caja ya esté corregido: pedidos facturados por la caja equivocada, cobros que entraron con diferencia contra su ticket (la diferencia ya está en el saldo de la cajera) y tickets cargados en el sistema con un medio de pago distinto al que se cobró.',
  tablaA(['Día','Cajera','Caja / vuelco','Importe','Observación'],r.observations.map(o=>[date(o.date).slice(0,5),o.cashier,o.box+' / '+o.batch,o.kind==='medio'?pesosExactos(o.amount).replace(/^\+/,''):o.kind==='ticket'?pesosExactos(o.amount):pesos(o.amount),o.kind==='ticket'||o.kind==='medio'?o.text:'Pedido online facturado por la Caja 3: van solo por la Caja 1.'+(/declaró en la Caja 1/.test(o.text)?' Lo declaró en la Caja 1 y el saldo quedó bien.':'')])));
 const obs=r.daily.filter(d=>d.issues.length);
 if(obs.length)h+=seccion('Observaciones pendientes','Lo que quedó para revisar en cada día.',obs.map(d=>'<p class="obs"><b>'+date(d.date).slice(0,5)+':</b> '+d.issues.map(esc).join(' · ')+'</p>').join(''));
 return h;
}
export function printDocument(r,general){const titulo='Sasha · Resumen de '+(r.cashierId?r.name:'todo el local')+' · '+mesTxt(r.month);return '<!doctype html><html lang="es"><meta charset="utf-8"><title>'+esc(titulo)+'</title><style>'+
 '@page{size:A4 portrait;margin:12mm 13mm 14mm}*{box-sizing:border-box}body{font:10.5px Arial,sans-serif;color:#202124;margin:0 auto;max-width:190mm;padding:16px}'+
 'h1{font-size:19px;margin:0;color:#1f3a5f}h2{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:#1f3a5f;margin:16px 0 6px;border-bottom:2px solid #1f3a5f;padding-bottom:3px;break-after:avoid}'+
 '.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1f3a5f;padding-bottom:7px}.sub{color:#5f6368;font-size:11.5px;margin-top:2px}.der{text-align:right}'+
 '.k{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.k div{border:1px solid #d0d4d9;border-radius:6px;padding:8px 10px;break-inside:avoid}.k small{color:#5f6368;font-size:9.5px;display:block}.k b{font-size:17px;display:block;margin-top:3px}.chico{font-size:10px;color:#5f6368;font-weight:400}'+
 '.pos{color:#137333}.neg{color:#c5221f}ul{margin:4px 0;padding-left:16px}li{margin:3px 0;line-height:1.45}'+
 '.warn{background:#fef7e0;color:#7a4b00;padding:7px 9px;border-radius:5px;margin-top:8px}.okmsg{background:#e6f4ea;color:#137333;padding:7px 9px;border-radius:5px;margin-top:8px}'+
 'table{width:100%;border-collapse:collapse;font-size:9.5px;margin:2px 0 4px}th,td{border-bottom:1px solid #e3e6ea;padding:3.5px 5px;text-align:left;vertical-align:top}th{color:#5f6368;font-size:8.5px;text-transform:uppercase;border-bottom:1.5px solid #9aa0a6}.n{text-align:right}'+
 'thead{display:table-header-group}tr{break-inside:avoid}.exp{color:#5f6368;font-size:9.5px;margin:0 0 4px;line-height:1.4}.nada{color:#5f6368;margin:2px 0}.obs{margin:2px 0;font-size:9.5px}'+
 '.sec{margin-top:4px}.des{margin-top:20px}.toolbar{padding:12px;background:#e8f0fe;border-radius:8px;margin-bottom:12px}.toolbar button{padding:10px 14px;border:0;border-radius:8px;background:#1a73e8;color:#fff;font-weight:700;cursor:pointer}'+
 '.pie{display:none}@media print{.toolbar{display:none}body{padding:0;max-width:none}.pie{display:block;position:fixed;bottom:0;left:0;right:0;font-size:8px;color:#9aa0a6;text-align:right}}'+
 '</style><div class="toolbar"><button onclick="window.print()">Imprimir / Guardar como PDF</button> <span style="color:#5f6368">En la impresora elegí A4 vertical.</span></div><div class="pie">'+esc(titulo)+'</div>'+reportBody(r,general)+'</html>';}
export function monthlyPanel(state,month,now=new Date()){
 if(!monthEnded(month,now))return '<div class="panel"><h2>Cierre mensual</h2><p>Los resúmenes finales y sus PDF estarán disponibles cuando termine el mes. Mientras tanto, podés consultar las métricas y el seguimiento diario.</p></div>';
 const r=monthlyReport(state,month,'',now);return '<section class="panel"><h2>Cierre mensual · '+esc(month)+'</h2><p>Resumen general y uno por cajera, con todas las cajas del mes. Cada botón abre su informe para imprimir o guardar como PDF.</p>'+table(['Resumen','Facturación','Faltantes','Sobrantes','Gastos','Errores de carga'],[r,...r.people.map(c=>monthlyReport(state,month,c.id,now))].map(x=>[x.name,money(x.totals.revenue),money(x.totals.shortage),money(x.totals.surplus),money(x.totals.expenses),String((x.loadErrors||[]).length)]))+'<div class="actions"><button class="button primary" data-monthly-report="">General · Imprimir / PDF</button>'+r.people.map(c=>'<button class="button" data-monthly-report="'+esc(c.id)+'">'+esc(c.name)+' · Imprimir / PDF</button>').join('')+'</div>'+(r.missing.length||r.pending.length?'<p class="notice">Hay días sin importar o sin confirmar. Los informes los identificarán como pendientes.</p>':'')+'</section>';
}
