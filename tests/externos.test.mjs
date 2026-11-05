// v110: comparación de lo declarado por las cajeras con lo que entró de verdad (datos inventados).
import test from 'node:test'; import assert from 'node:assert/strict';
import {compararExternos} from '../cajas/externos.mjs';
const X = {mp: {cantidad: 12, total: 520000, comisiones: 4100.5, porCanal: {QR: {cantidad: 10, total: 400000}, Point: {cantidad: 1, total: 50000}, Transferencia: {cantidad: 1, total: 70000}}},
  cuentaDni: {cantidad: 3, total: 77403, comisiones: 696.63, rechazados: 1}};
test('coincide dentro de $100; Mercado Pago compara QR + Point y muestra aparte lo demás', () => {
  const r = compararExternos({mercadoPago: 450050, cuentaDni: 77403, pendingOrders: 0}, X);
  assert.deepEqual(r.filas.map(f => [f.nombre, f.declarado, f.entro, f.dif, f.ok]), [['Mercado Pago', 450050, 450000, -50, true], ['Cuenta DNI', 77403, 77403, 0, true]]);
  assert.deepEqual(r.filas[0].extra.otros, [{canal: 'Transferencia', total: 70000}]);
  assert.deepEqual(r.comisiones, {mp: 4100.5, cuentaDni: 696.63, total: 4797.13});
  assert.deepEqual(r.notas, []);
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
  assert.equal(s.filas.length, 0); assert.match(s.notas[0], /no hay declaraciones/); assert.equal(s.comisiones.total, 4797.13);
  assert.match(compararExternos(null, {mp: {error: 'la clave de Mercado Pago no sirve'}, cuentaDni: {error: 'x'}}).notas.join(' '), /no sirve.*Cuenta DNI: x/);
});
