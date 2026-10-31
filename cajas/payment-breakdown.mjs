import {allTurns,couponStatus,dayStatus,isClosedDay} from './domain.mjs';
import {declaredCashWithdrawals} from './summary-metrics.mjs';
export function dailyPaymentBreakdown(state,date){
 const turns=allTurns(state,date),coupon=couponStatus(state,date),closed=isClosedDay(date,state)&&!turns.length;
 if(closed)return [0,0,0,0,'Cerrado'];
 const r=coupon.review;
 return [turns.length?declaredCashWithdrawals(turns)/100:'',r?r.mercadoPago/100:'',r?r.cuentaDni/100:'',r?r.other/100:'',coupon.complete&&dayStatus(state,date).complete?'Corroborado':'Pendiente de corroborar'];
}
export function addPaymentBreakdown(data,state){
 const rows=data['Control diario'];
 data['Control diario']=[rows[0].slice(0,12).concat(['Efectivo declarado','Mercado Pago','Cuenta DNI','Otros electrónicos','Estado de cobros']),...rows.slice(1).map(r=>r.slice(0,12).concat(dailyPaymentBreakdown(state,new Date((r[0]-25569)*86400000).toISOString().slice(0,10))))];
 return data;
}
