import {allTurns,assign,turnKey,openingChecks,operationalAlerts,addClosingCorrection,couponSignature,couponStatus,withinTolerance} from './domain.mjs';
import {declaredPaymentMethods} from './payment-reconciliation.mjs';
const methods={mercadoPago:'Mercado Pago',cuentaDni:'Cuenta DNI'};
const signature=q=>JSON.stringify([q.kind,q.date,q.branch,q.box,q.batch,q.method,q.pdf,q.entered,q.expected,q.fingerprint]);
function answered(s,q){return (s.guidedAnswers||[]).some(a=>a.key===q.key&&a.signature===signature(q));}
function paymentQuestions(s,date){const review=s.couponReviews.find(r=>r.date===date),out=[];for(const t of allTurns(s,date).filter(t=>t.box==='0001')){const source=declaredPaymentMethods(t),a=review?.allocations?.find(a=>turnKey(a)===turnKey(t));if(!source||!a)continue;for(const method of Object.keys(methods)){if(source[method]===a[method])continue;const q={kind:'payment',key:`payment|${date}|${turnKey(t)}|${method}`,date,branch:t.branch,box:t.box,batch:t.batch,cashier:assign(s,t,'close').name,method,label:methods[method],pdf:source[method],entered:a[method]};if(!answered(s,q))out.push(q);}}return out;}
export function guidedQuestions(s,date){const out=paymentQuestions(s,date);for(const a of operationalAlerts(s,date).filter(a=>a.type==='opening'&&!a.reviewed&&a.expected!==null&&!a.status.startsWith('Horarios superpuestos'))){out.push({kind:'opening',key:a.key,date,branch:a.branch,box:a.box,batch:a.batch,cashier:a.cashier,entered:a.opening,expected:a.expected,fingerprint:a.fingerprint});}if(out.length)return out;const status=couponStatus(s,date);if(!status.complete){if(status.allocationComplete&&withinTolerance(status.remaining))return [{kind:'coupons',key:'coupons|'+date,date}];return [];}return operationalAlerts(s,date).filter(a=>a.type==='closing'&&!a.reviewed).map(a=>({kind:'closing',key:a.key,date,branch:a.branch,box:a.box,batch:a.batch,cashier:a.cashier,net:a.net,fingerprint:a.fingerprint}));}
function recordAlert(s,key,note){const a=operationalAlerts(s).find(a=>a.key===key);if(!a)return;const snapshot={cashier:a.cashier,reason:a.reason,original:a.original??null,net:a.net??null,opening:a.opening,expected:a.expected??null,delta:a.delta??null,previous:a.previous?{date:a.previous.date,batch:a.previous.batch,cash:a.previous.cash,closeTime:a.previous.closeTime}:null};s.alertReviews.push({id:crypto.randomUUID(),key:a.key,type:a.type,date:a.date,branch:a.branch,box:a.box,batch:a.batch,cashierId:assign(s,a,'close').id,fingerprint:a.fingerprint,note,reviewedAt:new Date().toISOString(),snapshot:JSON.stringify(snapshot)});}
export function answerGuidedQuestion(original,key,amount,note=''){
 const s=structuredClone(original),q=guidedQuestions(s,key.split('|')[1]).find(q=>q.key===key);if(!q)throw Error('Los datos cambiaron. Revisá la pregunta actualizada.');
 if(['payment','opening'].includes(q.kind)&&(!Number.isSafeInteger(amount)||amount<0||amount>1e14))throw Error('Ingresá un importe válido.');
 const reason=note.trim()||'Importe corroborado por el encargado en la revisión guiada.';
 const t=allTurns(s,q.date).find(t=>t.branch===q.branch&&t.box===q.box&&t.batch===q.batch);
 if(q.kind==='payment'){
  const r=s.couponReviews.find(r=>r.date===q.date),a=r.allocations.find(a=>turnKey(a)===turnKey(q));a[q.method]=amount;
  const included=s.failedPayments.filter(f=>f.date===q.date&&turnKey(f)===turnKey(t)&&f.includedInCoupons).reduce((n,f)=>n+f.amount,0);
  const total=a.mercadoPago+a.cuentaDni+a.other+(a.pendingOrders||0)+included;
  if(total!==t.digital)addClosingCorrection(s,{...q,field:'digital',after:total,note:reason+' '+q.label+': '+(amount/100).toFixed(2)});
  for(const k of ['mercadoPago','cuentaDni','other'])r[k]=r.allocations.reduce((n,a)=>n+a[k],0);
  r.verified=false;r.signature=couponSignature(s,q.date);
  s.guidedAnswers??=[];s.guidedAnswers.push({key:q.key,date:q.date,signature:signature({...q,entered:amount}),amount,note:reason,answeredAt:new Date().toISOString()});
  if(!paymentQuestions(s,q.date).length&&couponStatus(s,q.date).allocationComplete&&withinTolerance(couponStatus(s,q.date).remaining))r.verified=true;
 }else if(q.kind==='opening'){
  if(amount!==t.opening)addClosingCorrection(s,{...q,field:'opening',after:amount,note:reason});
  recordAlert(s,q.key,reason+' Apertura confirmada: '+(amount/100).toFixed(2));
 }else if(q.kind==='closing'){
  if(!note.trim())throw Error('Contá brevemente qué verificaste antes de aceptar la diferencia.');recordAlert(s,q.key,note.trim());
 }else if(q.kind==='coupons'){
  const r=s.couponReviews.find(r=>r.date===q.date);r.verified=true;r.signature=couponSignature(s,q.date);
 }
 s.completedDays=s.completedDays.filter(d=>d!==q.date);return s;
}
