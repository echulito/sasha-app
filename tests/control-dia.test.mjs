// v130: un ticket en el detalle de tickets que no está en el cierre ni en los cobros no se cuenta en la caja: no frena el día (datos inventados).
import test from 'node:test'; import assert from 'node:assert/strict';
import {normalizeState, controlStatus} from '../cajas/domain.mjs';
const date='2026-10-16';
const closes=[
 {box:'0001',batch:'2467',cashier:'A',opening:0,cash:0,sales:1000000,digital:1000000,openTime:'09:41',closeTime:'15:30',firstTicket:'1',lastTicket:'1'},
 {box:'0001',batch:'2468',cashier:'B',opening:0,cash:0,sales:2000000,digital:2000000,openTime:'15:39',closeTime:'19:34',firstTicket:'2',lastTicket:'4'},
 {box:'0003',batch:'2335',cashier:'A',opening:0,cash:0,sales:0,digital:0,openTime:'09:41',closeTime:'15:30'},
 {box:'0003',batch:'2336',cashier:'B',opening:0,cash:0,sales:0,digital:0,openTime:'15:39',closeTime:'19:34'}];
const tk=(n,amount,time)=>({date,branch:'01',box:'0001',ticket:'0001-0000000'+n,time,amount,gross:amount,discount:0,units:1,items:[]});
const pago=(n,amount)=>({date,branch:'01',box:'0001',batch:n===1?'2467':'2468',ticket:'Tk B 0001-0000000'+n,method:'M PAGO OFFLINE',amount,cashier:'X'});
function st(extraPago, ventas2468 = 2000000){closes[1].sales = ventas2468; closes[1].digital = ventas2468;return normalizeState({manual:[],reports:[...closes.map(r=>({type:'turnClose',date,branch:'01',rows:[{date,branch:'01',withdrawals:0,closingWithdrawal:0,remainder:0,...r}]})),
 {type:'sales',date,branch:'01',rows:[pago(1,1000000),pago(3,1280000),pago(4,720000)].concat(extraPago?[pago(2,720000)]:[])},
 {type:'tickets',date,branch:'01',rows:[tk(1,1000000,'10:00'),tk(2,720000,'15:49'),tk(3,1280000,'15:50'),tk(4,720000,'15:53')]}]});}
test('ticket sin cobro y fuera del cierre: no se cuenta en la caja y no frena el día', () => {
  const a = controlStatus(st(false), date);
  assert.deepEqual(a.issues.filter(i => /tickets|cobros/i.test(i)), []);
  assert.ok(a.warnings.some(w => w === 'El ticket 0001-00000002 (15:49, $ 7.200,00) figura en el detalle de tickets pero no está en el cierre ni en el detalle de cobros del sistema: no se cuenta en la caja. Si entró plata por él, aparece en «Cobros contra tickets».'));
});
test('si el cierre sí incluye ese ticket (falta el cobro), sigue siendo algo para revisar', () => {
  const a = controlStatus(st(false, 2720000), date);
  assert.ok(a.issues.includes('Los tickets y cobros no coinciden por comprobante'));
  assert.ok(!a.warnings.some(w => /no se cuenta en la caja/.test(w)));
});
test('si todo coincide no hay aviso', () => {
  const a = controlStatus(st(true, 2720000), date);
  assert.deepEqual(a.issues.filter(i => /tickets|cobros/i.test(i)), []);
  assert.ok(!a.warnings.some(w => /no se cuenta en la caja/.test(w)));
});
