// v110: comparación de lo declarado por las cajeras con lo que entró de verdad (datos inventados).
import test from 'node:test'; import assert from 'node:assert/strict';
import {compararExternos} from '../cajas/externos.mjs';
// ECHU manda pesos; Cajas trabaja en centavos.
const X = {mp: {cantidad: 12, total: 5200, comisiones: 41.005, porCanal: {QR: {cantidad: 10, total: 4000}, Point: {cantidad: 1, total: 500}, Transferencia: {cantidad: 1, total: 700}}},
  cuentaDni: {cantidad: 3, total: 774.03, comisiones: 6.9663, rechazados: 1}};
test('coincide dentro de $100; Mercado Pago compara QR + Point (pesos de ECHU pasados a centavos) y muestra aparte lo demás', () => {
  const r = compararExternos({mercadoPago: 450050, cuentaDni: 77403, pendingOrders: 0}, X);
  assert.deepEqual(r.filas.map(f => [f.nombre, f.declarado, f.entro, f.dif, f.ok]), [['Mercado Pago', 450050, 450000, -50, true], ['Cuenta DNI', 77403, 77403, 0, true]]);
  assert.equal(r.filas[0].extra.cobros, 11);
  assert.deepEqual(r.filas[0].extra.otros, [{canal: 'Transferencia', total: 70000}]);
  assert.deepEqual(r.comisiones, {mp: 4101, cuentaDni: 697, total: 4798});
  assert.deepEqual(r.notas, []);
});
test('el caso del 06/11: declarado $ 770.860 y entraron $ 770.860 por Mercado Pago: coincide (antes decía que faltaban)', () => {
  const r = compararExternos({mercadoPago: 77086000, cuentaDni: 0, pendingOrders: 0}, {mp: {cantidad: 30, total: 789893.48, comisiones: 189.06, porCanal: {QR: {cantidad: 29, total: 770860}, 'Online / otros': {cantidad: 1, total: 19033.48}}}});
  assert.deepEqual([r.filas[0].entro, r.filas[0].ok], [77086000, true]);
  assert.deepEqual(r.filas[0].extra.otros, [{canal: 'Online / otros', total: 1903348}]);
});
test('diferencias: falta plata en Cuenta DNI, sobra en Mercado Pago', () => {
  const r = compararExternos({mercadoPago: 400000, cuentaDni: 90000, pendingOrders: 30000}, X);
  assert.deepEqual(r.filas.map(f => [f.dif, f.ok]), [[50000, false], [-12597, false]]);
  assert.equal(r.filas[0].extra.pedidosOnline, 30000);
});
test('sin clave de Mercado Pago o sin declaraciones: avisa y no compara', () => {
  const r = compararExternos({mercadoPago: 1, cuentaDni: 77403}, {mp: {sinClave: true}, cuentaDni: X.cuentaDni});
  assert.deepEqual(r.filas.map(f => f.nombre), ['Cuenta DNI']); assert.match(r.notas[0], /falta la clave/);
  const s = compararExternos(null, X);
  assert.equal(s.filas.length, 0); assert.match(s.notas[0], /no hay declaraciones/); assert.equal(s.comisiones.total, 4798);
  assert.match(compararExternos(null, {mp: {error: 'la clave de Mercado Pago no sirve'}, cuentaDni: {error: 'x'}}).notas.join(' '), /no sirve.*Cuenta DNI: x/);
});

import {cobrosEnTurno, respuestaAutomatica} from '../cajas/externos.mjs';
const COBROS = [{hora: '08:59:59', importe: 1000, canal: 'QR'}, {hora: '09:00:10', importe: 15000.5, canal: 'QR'}, {hora: '12:30:00', importe: 20000, canal: 'Point'},
  {hora: '13:00:00', importe: 5000, canal: 'Online / otros'}, {hora: '14:15:59', importe: 100, canal: 'QR'}, {hora: '14:16:00', importe: 7000, canal: 'QR'}];
test('cobros del turno: solo los del horario (apertura a cierre, minuto incluido) y de los canales pedidos', () => {
  assert.deepEqual(cobrosEnTurno(COBROS, '09:00', '14:15', ['QR', 'Point']), {total: 3510050, cantidad: 3, desde: '09:00', hasta: '14:15'});
  assert.equal(cobrosEnTurno(COBROS, '09:00', '14:15').cantidad, 4, 'sin canales: todos');
  assert.equal(cobrosEnTurno(COBROS, '', '14:15'), null);
  assert.equal(cobrosEnTurno(COBROS, '15:00', '14:00'), null);
  assert.deepEqual(cobrosEnTurno([], '09:00', '10:00'), {total: 0, cantidad: 0, desde: '', hasta: ''});
});
test('respuesta automática: coincida con el PDF o con lo declarado, es error de carga de la cajera (las dos las carga ella); si no coincide nada, pregunta', () => {
  assert.deepEqual(respuestaAutomatica(11652300, 13166301, 13166301), {monto: 13166301, errorCajera: true, coincide: 'pdf'});
  assert.deepEqual(respuestaAutomatica(11652300, 13166301, 11652350), {monto: 11652300, errorCajera: true, coincide: 'cajera'});
  assert.deepEqual(respuestaAutomatica(11652300, 13166301, 12000000), {monto: 12000000, errorCajera: true, coincide: 'ninguno'}, 'v124: vale lo que entró');
  assert.equal(respuestaAutomatica(11652300, 13166301, NaN), null);
});

import {correccionCupones} from '../cajas/externos.mjs';
test('cupones del turno: corrige solo si lo que entró da lo de la cajera y no lo del PDF', () => {
  assert.deepEqual(correccionCupones(27762504, 27290600, 27290600), {monto: 27290600, coincide: 'cajera'});
  assert.deepEqual(correccionCupones(27762504, 27290600, 27290650), {monto: 27290600, coincide: 'cajera'}, 'tolerancia $1');
  assert.equal(correccionCupones(27762504, 27290600, 27762504), null, 'entró lo del PDF: está bien');
  assert.deepEqual(correccionCupones(27762504, 27290600, 1000), {monto: 1000, coincide: 'ninguno'}, 'v124: no coincide con nada: vale lo que entró');
  assert.deepEqual(correccionCupones(61243700, 61243700, 56584005), {monto: 56584005, coincide: 'ninguno'}, 'PDF y cajera iguales pero de más (caso del 05/11)');
  assert.equal(correccionCupones(100, 150, 150), null, 'lo que entró da lo del PDF (dentro de $1): nada que corregir');
  assert.equal(correccionCupones(NaN, 1, 1), null);
});

test('Cuenta DNI: los rechazados llegan con su importe y hora para mostrarlos (no suman a lo que entró)', () => {
  const r = compararExternos({mercadoPago: 0, cuentaDni: 10000}, {cuentaDni: {cantidad: 1, total: 100, comisiones: 0, rechazados: 1, rechazadosLista: [{hora: '14:39:38', importe: 61291, estado: 'RECHAZADA'}]}});
  assert.equal(r.filas[0].entro, 10000);
  assert.deepEqual(r.filas[0].extra.rechazadosLista, [{hora: '14:39:38', importe: 61291, estado: 'RECHAZADA'}]);
});

import {cruzarCobros, medioDeTicket} from '../cajas/externos.mjs';
test('cruce: cada cobro real busca su ticket (mismo importe, hora más cercana); lo que sobra de cada lado se muestra', () => {
  assert.equal(medioDeTicket('BANELCO'), 'Cuenta DNI'); assert.equal(medioDeTicket('M PAGO OFFLINE'), 'Mercado Pago'); assert.equal(medioDeTicket('VISA'), 'Mercado Pago'); assert.equal(medioDeTicket('Efectivo $'), 'Efectivo');
  const mp = [{hora: '15:50:10', importe: 160140}, {hora: '16:10:00', importe: 4798}, {hora: '17:12:30', importe: 58293.95}, {hora: '18:00:00', importe: 7000}, {hora: '09:00:00', importe: 999}];
  const dni = [{hora: '16:58:12', importe: 61518}];
  const pagos = [{method: 'M PAGO OFFLINE', amount: 16014000, ticket: 'Tk 1', time: '15:51'}, {method: 'M PAGO OFFLINE', amount: 479800, ticket: 'Tk 2', time: '16:11'},
    {method: 'BANELCO', amount: 6151800, ticket: 'Tk 3', time: '16:59'}, {method: 'Efectivo $', amount: 700000, ticket: 'Tk 4', time: '18:01'},
    {method: 'M PAGO OFFLINE', amount: 250000, ticket: 'Tk 5', time: '19:00'}, {method: 'Efectivo $', amount: 150000, ticket: 'Tk 6', time: '19:10'}];
  const r = JSON.parse(JSON.stringify(cruzarCobros(mp, dni, pagos, '15:34', '19:37')));
  assert.equal(r.reales, 5, 'el de las 09:00 es de otro turno');
  assert.deepEqual(r.sinTicket, [{medio: 'Mercado Pago', hora: '17:12', importe: 5829395}, {medio: 'Mercado Pago', hora: '18:00', importe: 700000, registrado: {ticket: 'Tk 4', medio: 'Efectivo $'}}]);
  assert.deepEqual(r.sinEntrar, [{medio: 'Mercado Pago', metodo: 'M PAGO OFFLINE', ticket: 'Tk 5', hora: '19:00', importe: 250000}]);
  assert.deepEqual([r.totalSinTicket, r.totalOtroMedio, r.totalSinEntrar], [5829395, 700000, 250000]);
  assert.equal(cruzarCobros([], [], [], 'x', '19:00'), null);
});

test('cruce v126: un cobro con unos pesos de diferencia y hora cercana se asocia a su ticket (caso del 06/11: $ 10.100 por un ticket de $ 10.107)', () => {
  const r = JSON.parse(JSON.stringify(cruzarCobros([], [{hora: '18:06:50', importe: 10100}], [{method: 'BANELCO', amount: 1010700, ticket: 'Tk B 0001-00122320', time: '18:04'}], '15:29', '19:33')));
  assert.deepEqual(r.sinTicket, []); assert.deepEqual(r.sinEntrar, []);
  assert.deepEqual(r.diferencias, [{medio: 'Cuenta DNI', hora: '18:06', importe: 1010000, ticket: 'Tk B 0001-00122320', metodo: 'BANELCO', importeTicket: 1010700, dif: -700}]);
  assert.equal(r.totalDiferencia, -700);
  // lejos en la hora o muy distinto: no se asocia
  const lejos = cruzarCobros([], [{hora: '18:40:00', importe: 10100}], [{method: 'BANELCO', amount: 1010700, ticket: 'T', time: '18:04'}], '15:29', '19:33');
  assert.equal(lejos.diferencias.length, 0); assert.equal(lejos.sinTicket.length, 1); assert.equal(lejos.sinEntrar.length, 1);
  const distinto = cruzarCobros([], [{hora: '18:05:00', importe: 8000}], [{method: 'BANELCO', amount: 1010700, ticket: 'T', time: '18:04'}], '15:29', '19:33');
  assert.equal(distinto.diferencias.length, 0);
  // mismo importe exacto en otro medio pero lejos en la hora: no se asocia
  const otro = cruzarCobros([{hora: '16:00:00', importe: 7000}], [], [{method: 'Efectivo $', amount: 700000, ticket: 'T', time: '19:00'}], '15:29', '19:33');
  assert.deepEqual(JSON.parse(JSON.stringify(otro.sinTicket)), [{medio: 'Mercado Pago', hora: '16:00', importe: 700000}]);
});

test('v131: un cobro real que coincide con un ticket anulado en el sistema (no está en el cierre ni en los cobros) se muestra así', async () => {
  const {cruzarCobros} = await import('../cajas/externos.mjs');
  const pagos = [{method: 'M PAGO OFFLINE', amount: 2925600, ticket: 'Tk B 0001-00000059', time: '16:36'}];
  const r = cruzarCobros([{hora: '16:31:10', importe: 43248, canal: 'QR'}, {hora: '16:36:00', importe: 29256, canal: 'QR'}], [], pagos, '15:34', '19:37',
    [{ticket: '0001-00000058', hora: '16:30', importe: 4324800}]);
  assert.equal(r.sinTicket.length, 1); assert.deepEqual(r.sinTicket[0].anulado, {ticket: '0001-00000058', hora: '16:30', importe: 4324800});
  assert.equal(r.totalAnulado, 4324800); assert.equal(r.totalSinTicket, 0); assert.equal(r.diferencias.length, 0);
});

test('v133: dos cobros en el mismo minuto o con 1 minuto de diferencia que juntos dan un ticket se asocian a ese ticket', async () => {
  const {cruzarCobros} = await import('../cajas/externos.mjs');
  const pagos = [{method: 'Efectivo $', amount: 1504600, ticket: 'Tk B 0001-00000066', time: '16:49'}, {method: 'M PAGO OFFLINE', amount: 2939900, ticket: 'Tk B 0001-00000065', time: '16:48'}];
  const r = cruzarCobros([{hora: '16:48:30', importe: 29399, canal: 'QR'}, {hora: '16:49:40', importe: 1506, canal: 'QR'}, {hora: '16:50:10', importe: 13540, canal: 'QR'}], [], pagos, '15:34', '19:37', []);
  assert.equal(r.sinTicket.length, 0, 'no queda nada sin ticket');
  assert.equal(r.combinados.length, 1);
  const c = r.combinados[0];
  assert.equal(c.ticket, 'Tk B 0001-00000066'); assert.equal(c.metodo, 'Efectivo $'); assert.equal(c.importe, 1504600); assert.equal(c.dif, 0);
  assert.deepEqual(c.movimientos.map(m => m.hora), ['16:49', '16:50']);
  assert.equal(r.totalCombinadoOtroMedio, 1504600);
});
test('v133: si los dos cobros están a más de 1 minuto del ticket, no se juntan', async () => {
  const {cruzarCobros} = await import('../cajas/externos.mjs');
  const pagos = [{method: 'Efectivo $', amount: 1504600, ticket: 'Tk B 0001-00000066', time: '16:49'}];
  const r = cruzarCobros([{hora: '16:49:40', importe: 1506, canal: 'QR'}, {hora: '16:53:10', importe: 13540, canal: 'QR'}], [], pagos, '15:34', '19:37', []);
  assert.equal(r.combinados.length, 0); assert.equal(r.sinTicket.length, 2);
});
