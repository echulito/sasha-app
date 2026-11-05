// v111: Cajeras contesta sola "¿Cuánto recibió X por Mercado Pago?" con los cobros reales del horario del turno (datos inventados).
import test from 'node:test'; import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
import {servir} from './servidor-estatico.mjs';
import {crearECHU, URL_ECHU, TOKEN, DATOS} from './echu-falso.mjs';
import {normalizeState, loadErrors} from '../cajas/domain.mjs';
const date = '2026-10-16';
function estado() {
  const rows = [
    {date: '2026-10-15', box: '0001', batch: '2466', cashier: 'Cajera B', opening: 3460000, cash: 4460000, remainder: 4460000, sales: 1000000, digital: 0, openTime: '15:39', closeTime: '19:34'},
    {date, box: '0001', batch: '2467', cashier: 'Cajera A', opening: 4460000, cash: 4460000, remainder: 4460000, sales: 38935801, digital: 38935800, sourceMercadoPagoDeclared: 25266200, sourceCouponDeclared: 13669600, openTime: '09:41', closeTime: '15:30'},
    {date, box: '0001', batch: '2468', cashier: 'Cajera B', opening: 4460000, cash: 4460000, remainder: 4460000, sales: 27290585, digital: 27762504, sourceMercadoPagoDeclared: 23939304, sourceCouponDeclared: 3823200, openTime: '15:39', closeTime: '19:34'},
    ...['2335', '2336'].map((batch, i) => ({date, box: '0003', batch, cashier: i ? 'Cajera B' : 'Cajera A', opening: 0, cash: 0, remainder: 0, sales: 0, digital: 0, openTime: i ? '15:39' : '09:41', closeTime: i ? '19:34' : '15:30'}))];
  return normalizeState({manual: [], reports: rows.map(r => ({type: 'turnClose', date: r.date, branch: '01', rows: [{branch: '01', withdrawals: 0, closingWithdrawal: 0, ...r}]})),
    couponReviews: [{date, allocations: rows.filter(r => r.date === date).map(r => ({branch: '01', box: r.box, batch: r.batch, mercadoPago: r.batch === '2467' ? 25266200 : r.batch === '2468' ? 23467400 : 0, cuentaDni: r.batch === '2467' ? 13669600 : r.batch === '2468' ? 3823200 : 0, other: 0, pendingOrders: 0})),
      mercadoPago: 48733600, cuentaDni: 17492800, other: 0, verified: false, signature: '', note: ''}]});
}
async function abrirCajas(mp) {
  const antes = {e: DATOS.cajas_estado, p: DATOS.pagos_externos};
  DATOS.cajas_estado = {state: estado(), revision: 1, sheetUrl: ''};
  DATOS.pagos_externos = {fecha: date, mp, cuentaDni: {cantidad: 0, total: 0, comisiones: 0, rechazados: 0, cobros: []}};
  const b = await chromium.launch(), web = await servir();
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires'});
  const echu = crearECHU(); await ctx.route(URL_ECHU + '**', r => echu.manejar(r));
  await ctx.addInitScript(([u, t]) => { localStorage.setItem('echu_url', u); localStorage.setItem('echu_token', t); }, [URL_ECHU, TOKEN]);
  const page = await ctx.newPage(); const errores = []; page.on('pageerror', e => errores.push(e.message));
  await page.goto(web.url + 'cajas/index.html');
  return {page, echu, errores, cerrar: async () => { await b.close(); web.cerrar(); DATOS.cajas_estado = antes.e; DATOS.pagos_externos = antes.p; }};
}
const guardados = echu => echu.pedidos.filter(p => /"accion":"cajas_guardar"/.test(p.cuerpo || '')).map(p => JSON.parse(JSON.parse(p.cuerpo).datos));
test('si en el horario del turno entró lo del informe PDF: se contesta solo y queda como error de carga, con lo que declaró la cajera', async () => {
  const cobros = [{hora: '15:40:00', importe: 200000, canal: 'QR', comision: 0}, {hora: '19:30:00', importe: 39393.04, canal: 'Point', comision: 0},
    {hora: '10:00:00', importe: 252662, canal: 'QR', comision: 0}, {hora: '19:50:00', importe: 9999, canal: 'QR', comision: 0}];
  const {page, echu, errores, cerrar} = await abrirCajas({cantidad: 4, total: 501054.04, comisiones: 0, porCanal: {QR: {cantidad: 3, total: 462661}, Point: {cantidad: 1, total: 39393.04}}, cobros});
  try {
    await page.waitForFunction(() => document.querySelector('#externos') && !document.querySelector('#externos').hidden, null, {timeout: 15000});
    await page.waitForTimeout(800);
    const g = guardados(echu);
    assert.ok(g.length > 0, 'tiene que guardar la respuesta automática');
    const ultimo = g[g.length - 1].state;
    const nota = (ultimo.guidedAnswers || []).map(a => a.note).join(' | ');
    assert.equal(loadErrors(normalizeState(ultimo), {}).length, 1, 'cuenta como error de carga en el resumen del mes');
    assert.match(nota, /^Error de carga de la cajera: Mercado Pago acreditó/);
    assert.match(nota, /2 cobros de 15:40 a 19:30, turno de 15:39 a 19:34/);
    assert.match(nota, /La cajera declaró \$\s?234\.674,00 \(en el sistema estaba bien\)/);
    assert.deepEqual(errores, []);
  } finally { await cerrar(); }
});
test('si lo que entró no coincide con nada, no contesta solo: muestra el botón con lo que entró de verdad', async () => {
  const {page, echu, errores, cerrar} = await abrirCajas({cantidad: 1, total: 100000, comisiones: 0, porCanal: {QR: {cantidad: 1, total: 100000}}, cobros: [{hora: '16:00:00', importe: 100000, canal: 'QR', comision: 0}]});
  try {
    await page.waitForFunction(() => document.querySelector('#externos') && !document.querySelector('#externos').hidden, null, {timeout: 15000});
    await page.waitForTimeout(500);
    assert.equal(guardados(echu).filter(s => (s.state.guidedAnswers || []).length).length, 0);
    assert.equal(await page.locator('[data-real]').count(), 1);
    assert.match(await page.locator('[data-real]').first().textContent(), /Entró de verdad: \$\s?100\.000,00 \(1 cobros\)/);
    assert.deepEqual(errores, []);
  } finally { await cerrar(); }
});
test('si entró lo que declaró la cajera (el sistema estaba mal): también es error de carga, y dice cuánto cargó en el sistema', async () => {
  const cobros = [{hora: '16:00:00', importe: 234674, canal: 'QR', comision: 0}];
  const {page, echu, errores, cerrar} = await abrirCajas({cantidad: 1, total: 234674, comisiones: 0, porCanal: {QR: {cantidad: 1, total: 234674}}, cobros});
  try {
    await page.waitForFunction(() => document.querySelector('#externos') && !document.querySelector('#externos').hidden, null, {timeout: 15000});
    await page.waitForTimeout(800);
    const g = guardados(echu), ultimo = g[g.length - 1].state, nota = (ultimo.guidedAnswers || []).map(a => a.note).join(' | ');
    assert.match(nota, /^Error de carga de la cajera: Mercado Pago acreditó \$\s?234\.674,00 \(1 cobros de 16:00 a 16:00/);
    assert.match(nota, /Coincide con lo que declaró la cajera; en el sistema cargó \$\s?239\.393,04\./);
    assert.equal(loadErrors(normalizeState(ultimo), {}).length, 1);
    assert.deepEqual(errores, []);
  } finally { await cerrar(); }
});
