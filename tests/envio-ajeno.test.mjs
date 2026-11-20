// v181: un envío mandado con el usuario de otra cajera se reconoce por sus importes (coinciden con el cierre de la otra)
// y queda anotado como error de carga de quien lo mandó (datos del 19/11/2026, nombres de prueba).
import test from 'node:test'; import assert from 'node:assert/strict';
import {normalizeState, loadErrors, controlStatus} from '../cajas/domain.mjs';
import {misattributedSubmissions} from '../cajas/team-domain.mjs';
const fila = o => Object.assign({expenses: [], date: '2026-11-19', branch: '01', scope: 'Turno PDF', credits: 0, withdrawals: 0, extraDigitalDeclared: 0, systemDifference: 0, operations: 1}, o);
const turno = row => ({type: 'turnClose', date: '2026-11-19', branch: '01', filename: 'cierre ' + row.batch + '.pdf', rows: [row]});
function estado(envio) {
  const s = normalizeState({reports: [
    turno(fila({box: '0001', batch: '2522', openTime: '09:41', closeTime: '15:30', opening: 5884000, sales: 16998251, grossSales: 16998251, remainder: 0, closingWithdrawal: 5884000, cash: 5884000, digital: 16992250, sourceCouponDeclared: 2116000, sourceMercadoPagoDeclared: 14876250, cashier: 'VANESA'})),
    turno(fila({box: '0001', batch: '2523', openTime: '15:32', closeTime: '19:32', opening: 5884000, sales: 22307301, grossSales: 22307301, remainder: 5884000, closingWithdrawal: 0, cash: 5884000, digital: 19995400, sourceCouponDeclared: 4430300, sourceMercadoPagoDeclared: 15565100, cashier: 'FERNANDA ITA MAIDANA'}))], manual: []});
  s.teamSubmissions = [envio];
  return s;
}
const envio = (o = {}) => Object.assign({id: 'envio-prueba-0001', date: '2026-11-19', cashierId: 'vanesa', cashier: 'Vanesa', shift: 'mañana', start: '09:30', end: '15:30', sentAt: '2026-11-19T22:33:56.000Z',
  boxes: [{box: '0001', mercadoPago: 17877000, cuentaDni: 4430300, other: 0, pendingOrders: 0, expenses: []}]}, o);

test('el envío con el usuario de Vanesa y los importes del cierre de Fernanda se reconoce como de Fernanda', () => {
  const c = misattributedSubmissions(estado(envio()));
  assert.equal(c.length, 1);
  assert.equal(c[0].cashierId, 'fernanda');
  assert.match(c[0].basis, /Cuenta DNI \$ 44\.303 = cierre de la caja 0001, vuelco 2523/);
});
test('si coincide con el cierre de quien figura, o no coincide con nadie, no se toca', () => {
  assert.equal(misattributedSubmissions(estado(envio({boxes: [{box: '0001', mercadoPago: 14876250, cuentaDni: 4430300, other: 0, pendingOrders: 0, expenses: []}]}))).length, 0, 'MP de Vanesa coincide: es de ella');
  assert.equal(misattributedSubmissions(estado(envio({boxes: [{box: '0001', mercadoPago: 100, cuentaDni: 12345600, other: 0, pendingOrders: 0, expenses: []}]}))).length, 0);
  assert.equal(misattributedSubmissions(estado(envio({sentAsId: 'x'}))).length, 0, 'ya corregido');
  const s = estado(envio()); s.teamSubmissions.push(envio({id: 'envio-prueba-0002', cashierId: 'fernanda', cashier: 'Fernanda', shift: 'tarde'}));
  assert.equal(misattributedSubmissions(s).length, 0, 'si Fernanda ya mandó el suyo, no se pisa');
});
test('ya pasado a Fernanda: queda como error de carga de ella y como observación del día', () => {
  const s = estado(envio({cashierId: 'fernanda', cashier: 'Fernanda', shift: 'tarde', start: '15:30', end: '19:30', sentAsId: 'vanesa', sentAs: 'Vanesa', reassignBasis: 'Cuenta DNI $ 44.303 = cierre de la caja 0001, vuelco 2523'}));
  const e = loadErrors(s, {month: '2026-11'});
  assert.equal(e.length, 1);
  assert.deepEqual([e[0].cashier, e[0].box, e[0].batch, e[0].what], ['Fernanda', '0001', '2523', 'Envío']);
  assert.match(e[0].note, /^Fernanda mandó su envío con el usuario de Vanesa\. Se pasó solo a Fernanda/);
  assert.equal(loadErrors(s, {month: '2026-11', cashierId: 'vanesa'}).length, 0, 'no cuenta para Vanesa');
  assert.ok(controlStatus(s, '2026-11-19').warnings.some(w => /usuario de Vanesa/.test(w)));
});
