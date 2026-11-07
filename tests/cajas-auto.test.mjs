// v111: Cajeras contesta sola "¿Cuánto recibió X por Mercado Pago?" con los cobros reales del horario del turno (datos inventados).
import test from 'node:test'; import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
import {servir} from './servidor-estatico.mjs';
import {crearECHU, URL_ECHU, TOKEN, DATOS} from './echu-falso.mjs';
import {normalizeState, loadErrors} from '../cajas/domain.mjs';
const date = '2026-10-16';
function estado(sinDesglose, mp2468 = 23467400, ventas = null) {
  const rows = [
    {date: '2026-10-15', box: '0001', batch: '2466', cashier: 'Cajera B', opening: 3460000, cash: 4460000, remainder: 4460000, sales: 1000000, digital: 0, openTime: '15:39', closeTime: '19:34'},
    {date, box: '0001', batch: '2467', cashier: 'Cajera A', opening: 4460000, cash: 4460000, remainder: 4460000, sales: 38935801, digital: 38935800, sourceMercadoPagoDeclared: 25266200, sourceCouponDeclared: 13669600, openTime: '09:41', closeTime: '15:30'},
    {date, box: '0001', batch: '2468', cashier: 'Cajera B', opening: 4460000, cash: 4460000, remainder: 4460000, sales: 27290585, digital: 27762504, sourceMercadoPagoDeclared: 23939304, sourceCouponDeclared: 3823200, openTime: '15:39', closeTime: '19:34'},
    ...['2335', '2336'].map((batch, i) => ({date, box: '0003', batch, cashier: i ? 'Cajera B' : 'Cajera A', opening: 0, cash: 0, remainder: 0, sales: 0, digital: 0, openTime: i ? '15:39' : '09:41', closeTime: i ? '19:34' : '15:30'}))];
  if (sinDesglose) rows.forEach(r => { if (r.batch === '2468') { delete r.sourceMercadoPagoDeclared; delete r.sourceCouponDeclared; } });
  return normalizeState({manual: [], reports: rows.map(r => ({type: 'turnClose', date: r.date, branch: '01', rows: [{branch: '01', withdrawals: 0, closingWithdrawal: 0, ...r}]})).concat(ventas ? [{type: 'sales', date, branch: '01', rows: ventas}] : []),
    couponReviews: [{date, allocations: rows.filter(r => r.date === date).map(r => ({branch: '01', box: r.box, batch: r.batch, mercadoPago: r.batch === '2467' ? 25266200 : r.batch === '2468' ? mp2468 : 0, cuentaDni: r.batch === '2467' ? 13669600 : r.batch === '2468' ? 3823200 : 0, other: 0, pendingOrders: 0})),
      mercadoPago: 48733600, cuentaDni: 17492800, other: 0, verified: false, signature: '', note: ''}]});
}
async function abrirCajas(mp, opc = {}) {
  const antes = {e: DATOS.cajas_estado, p: DATOS.pagos_externos};
  DATOS.cajas_estado = {state: estado(opc.sinDesglose, opc.mp2468, opc.ventas), revision: 1, sheetUrl: ''};
  DATOS.pagos_externos = {fecha: date, mp, cuentaDni: opc.dni || {cantidad: 0, total: 0, comisiones: 0, rechazados: 0, cobros: []}};
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

test('v120: cupones del PDF distintos a lo declarado y sin desglose: si lo que entró (MP + Cuenta DNI del turno) da lo de la cajera, se corrige solo', async () => {
  const mpCobros = [{hora: '16:00:00', importe: 200000, canal: 'QR', comision: 0}, {hora: '18:10:00', importe: 34674, canal: 'Point', comision: 0}, {hora: '10:00:00', importe: 5, canal: 'QR', comision: 0}];
  const dni = {cantidad: 2, total: 38232, comisiones: 0, rechazados: 0, cobros: [{hora: '17:00:00', importe: 30000}, {hora: '19:00:00', importe: 8232}]};
  const {page, echu, errores, cerrar} = await abrirCajas({cantidad: 3, total: 234679, comisiones: 0, porCanal: {QR: {cantidad: 2, total: 200005}, Point: {cantidad: 1, total: 34674}}, cobros: mpCobros}, {sinDesglose: true, dni});
  try {
    await page.waitForFunction(() => document.querySelector('#externos') && !document.querySelector('#externos').hidden, null, {timeout: 15000});
    await page.waitForTimeout(900);
    const g = guardados(echu); assert.ok(g.length > 0, 'tiene que guardar la corrección');
    const ultimo = g[g.length - 1].state;
    const c = (ultimo.closingCorrections || []).filter(x => x.field === 'digital');
    assert.equal(c.length, 1); assert.equal(c[0].batch, '2468'); assert.equal(c[0].after, 27290600); assert.equal(c[0].before, 27762504);
    assert.match(c[0].note, /^Error de carga de la cajera: en el turno de 15:39 a 19:34 entraron \$\s?272\.906,00 \(Mercado Pago \$\s?234\.674,00 en 2 cobros \+ Cuenta DNI \$\s?38\.232,00 en 2 cobros\)/);
    assert.match(c[0].note, /Coincide con lo que declaró la cajera \(\$\s?272\.906,00\); en el sistema cargó \$\s?277\.625,04 de cupones\./);
    assert.equal(loadErrors(normalizeState(ultimo), {}).length, 1, 'cuenta como error de carga en el resumen del mes');
    assert.deepEqual(errores, []);
  } finally { await cerrar(); }
});
test('v120: si lo que entró da lo del PDF, los cupones no se tocan', async () => {
  const dni = {cantidad: 1, total: 43205.04, comisiones: 0, rechazados: 0, cobros: [{hora: '17:00:00', importe: 43205.04}]};
  const {page, echu, cerrar} = await abrirCajas({cantidad: 1, total: 234420, comisiones: 0, porCanal: {QR: {cantidad: 1, total: 234420}}, cobros: [{hora: '16:00:00', importe: 234420, canal: 'QR', comision: 0}]}, {sinDesglose: true, dni});
  try {
    await page.waitForFunction(() => document.querySelector('#externos') && !document.querySelector('#externos').hidden, null, {timeout: 15000});
    await page.waitForTimeout(800);
    assert.equal(guardados(echu).filter(x => (x.state.closingCorrections || []).some(c => c.field === 'digital')).length, 0);
  } finally { await cerrar(); }
});

test('v124: si lo que entró no coincide ni con el PDF ni con la cajera pero explica la diferencia de caja, vale lo que entró', async () => {
  // PDF $ 277.625,04 · cajera $ 288.232 · entró $ 272.905,85 = lo vendido: con eso la caja cierra justo.
  const mpCobros = [{hora: '16:00:00', importe: 200000, canal: 'QR', comision: 0}, {hora: '18:00:00', importe: 34674, canal: 'Point', comision: 0}];
  const dni = {cantidad: 1, total: 38231.85, comisiones: 0, rechazados: 0, cobros: [{hora: '17:00:00', importe: 38231.85}]};
  const {page, echu, errores, cerrar} = await abrirCajas({cantidad: 2, total: 234674, comisiones: 0, porCanal: {QR: {cantidad: 1, total: 200000}, Point: {cantidad: 1, total: 34674}}, cobros: mpCobros}, {sinDesglose: true, dni, mp2468: 25000000});
  try {
    await page.waitForFunction(() => document.querySelector('#externos') && !document.querySelector('#externos').hidden, null, {timeout: 15000});
    await page.waitForTimeout(900);
    const g = guardados(echu); assert.ok(g.length > 0, 'tiene que corregir');
    const st = g[g.length - 1].state;
    const c = (st.closingCorrections || []).filter(x => x.field === 'digital' && x.batch === '2468');
    assert.equal(c.length, 1); assert.equal(c[0].after, 27290585);
    assert.match(c[0].note, /La cajera declaró \$\s?288\.232,00 y en el sistema cargó \$\s?277\.625,04 de cupones: no coincide ninguno, vale lo que entró\./);
    const a = st.couponReviews[0].allocations.find(x => x.batch === '2468');
    assert.deepEqual([a.mercadoPago, a.cuentaDni], [23467400, 3823185], 'la declaración pasa a ser lo que entró');
    assert.equal((st.closingCorrections || []).filter(x => x.batch === '2467').length, 0, 'el turno de la mañana sin datos no se toca (lo empeoraría)');
    assert.deepEqual(errores, []);
  } finally { await cerrar(); }
});

test('v125: cobros contra tickets: muestra lo que entró sin ticket, lo cobrado con otro medio y lo que figura cobrado y no entró', async () => {
  const v = (method, amount, ticket, time) => ({date, branch: '01', method, box: '0001', batch: '2468', ticket, amount, cashier: 'B', time});
  const ventas = [v('M PAGO OFFLINE', 20000000, 'Tk B 0001-1', '16:01'), v('Efectivo $', 700000, 'Tk B 0001-2', '18:01'), v('M PAGO OFFLINE', 250000, 'Tk B 0001-3', '19:00'), v('BANELCO', 3823200, 'Tk B 0001-4', '17:01')];
  const mpCobros = [{hora: '16:00:00', importe: 200000, canal: 'QR', comision: 0}, {hora: '17:12:00', importe: 58293.95, canal: 'QR', comision: 0}, {hora: '18:00:00', importe: 7000, canal: 'Point', comision: 0}];
  const dni = {cantidad: 1, total: 38232, comisiones: 0, rechazados: 0, cobros: [{hora: '17:00:00', importe: 38232}]};
  const {page, errores, cerrar} = await abrirCajas({cantidad: 3, total: 265293.95, comisiones: 0, porCanal: {QR: {cantidad: 2, total: 258293.95}, Point: {cantidad: 1, total: 7000}}, cobros: mpCobros}, {sinDesglose: true, dni, ventas});
  try {
    await page.waitForFunction(() => /Cobros contra tickets/.test((document.querySelector('#externos') || {}).textContent || ''), null, {timeout: 15000});
    const t = await page.locator('#externos').textContent();
    assert.match(t, /· caja 0001 · 15:39 a 19:34/);
    assert.match(t, /entraron \$\s?58\.293,95 sin ticket · \$\s?7\.000,00 con otro medio en el ticket · \$\s?2\.500,00 cobrados en el sistema que no entraron/);
    assert.match(t, /17:12 · \$\s?58\.293,95Entró por Mercado Pago y no tiene ticket/);
    assert.match(t, /Entró por Mercado Pago; el ticket Tk B 0001-2 dice Efectivo \$/);
    assert.match(t, /Ticket Tk B 0001-3 \(M PAGO OFFLINE\): figura cobrado y no entró/);
    assert.doesNotMatch(t, /Tk B 0001-4/, 'el de Cuenta DNI coincide');
    if (process.env.CAPTURA) await page.locator('#externos').screenshot({path: process.env.CAPTURA});
    assert.deepEqual(errores, []);
  } finally { await cerrar(); }
});
