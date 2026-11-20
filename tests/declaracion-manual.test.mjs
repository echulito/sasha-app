// v184: la cajera que no mandó su declaración: el encargado la carga a mano desde "Envíos de cajeras".
// Sirve para el reparto, pero en el informe del día y del mes le sigue contando que no declaró (datos de prueba).
import test from 'node:test'; import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {normalizeState, loadErrors, controlStatus, declaracionesFaltantes} from '../cajas/domain.mjs';
import {misattributedSubmissions} from '../cajas/team-domain.mjs';
import {servir} from './servidor-estatico.mjs';
import {crearECHU, URL_ECHU, TOKEN, DATOS} from './echu-falso.mjs';
const require = createRequire(import.meta.url);
const fila = o => Object.assign({expenses: [], date: '2026-11-19', branch: '01', scope: 'Turno PDF', credits: 0, withdrawals: 0, extraDigitalDeclared: 0, systemDifference: 0, operations: 1}, o);
const turno = row => ({type: 'turnClose', date: '2026-11-19', branch: '01', filename: 'cierre ' + row.batch + '.pdf', rows: [row]});
const reportes = () => [
  turno(fila({box: '0001', batch: '2522', openTime: '09:41', closeTime: '15:30', opening: 5884000, sales: 16998251, grossSales: 16998251, remainder: 0, closingWithdrawal: 5884000, cash: 5884000, digital: 16992250, sourceCouponDeclared: 2116000, sourceMercadoPagoDeclared: 14876250, cashier: 'VANESA'})),
  turno(fila({box: '0001', batch: '2523', openTime: '15:32', closeTime: '19:32', opening: 5884000, sales: 22307301, grossSales: 22307301, remainder: 5884000, closingWithdrawal: 0, cash: 5884000, digital: 19995400, sourceCouponDeclared: 4430300, sourceMercadoPagoDeclared: 15565100, cashier: 'FERNANDA ITA MAIDANA'}))];
const deFernanda = {id: 'envio-prueba-0001', date: '2026-11-19', cashierId: 'fernanda', cashier: 'Fernanda', shift: 'tarde', start: '15:30', end: '19:30', sentAt: '2026-11-19T22:33:56.000Z',
  sentAsId: 'vanesa', sentAs: 'Vanesa', reassignBasis: 'Cuenta DNI $ 44.303 = cierre de la caja 0001, vuelco 2523',
  boxes: [{box: '0001', mercadoPago: 17877000, cuentaDni: 4430300, other: 0, pendingOrders: 0, expenses: []}]};
const aMano = {id: 'manual-2026-11-19-vanesa-x1', date: '2026-11-19', cashierId: 'vanesa', cashier: 'Vanesa', shift: 'mañana', start: '09:30', end: '15:30', sentAt: '2026-11-20T17:00:00.000Z', manual: true,
  boxes: [{box: '0001', mercadoPago: 14876250, cuentaDni: 2116000, other: 0, pendingOrders: 0, expenses: []}]};

test('cargada a mano: ya no se ofrece cargarla, pero en el informe le sigue contando "Sin declaración" (con la aclaración)', () => {
  const s = normalizeState({reports: reportes(), manual: []});
  s.teamSubmissions = [deFernanda];
  assert.deepEqual(declaracionesFaltantes(s, '2026-11-19').map(x => [x.name, x.manual]), [['Vanesa', false]]);
  s.teamSubmissions.push(aMano);
  assert.deepEqual(declaracionesFaltantes(s, '2026-11-19').map(x => [x.name, x.manual]), [['Vanesa', true]]);
  const v = loadErrors(s, {month: '2026-11', cashierId: 'vanesa'});
  assert.deepEqual(v.map(x => [x.cashier, x.what]), [['Vanesa', 'Sin declaración']]);
  assert.match(v[0].note, /^Vanesa no mandó su declaración .* La cargó el encargado a mano\.$/);
  assert.ok(controlStatus(s, '2026-11-19').warnings.some(w => /Vanesa no mandó su declaración.*a mano/.test(w)));
  assert.equal(loadErrors(s, {month: '2026-11', cashierId: 'fernanda'}).length, 1, 'lo de Fernanda (usuario de Vanesa) sigue igual');
  assert.equal(misattributedSubmissions(s).length, 0, 'la cargada a mano nunca se pasa a otra cajera');
});

test('en Envíos de cajeras aparece "Agregar manualmente declaración faltante", viene con lo del cierre y se guarda en ECHU', async () => {
  const {chromium} = require('playwright');
  const enviados = [], antes = {e: DATOS.cajas_estado, n: DATOS.cajas_envios};
  const estado = normalizeState({reports: reportes(), manual: []});
  DATOS.cajas_estado = {state: estado, revision: 1, sheetUrl: ''};
  let lista = [deFernanda];
  DATOS.cajas_envios = p => { if (p.datos) { const b = JSON.parse(p.datos); enviados.push(b); if (b.action === 'add') lista = lista.concat([Object.assign({}, b.submission, {cashier: 'Vanesa', shift: 'mañana', start: '09:30', end: '15:30', sentAt: '2026-11-20T17:00:00.000Z', manual: true})]); } return {submissions: lista}; };
  const b = await chromium.launch(), web = await servir();
  try {
    const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires'});
    const echu = crearECHU(); await ctx.route(URL_ECHU + '**', r => echu.manejar(r));
    await ctx.addInitScript(([u, t]) => { localStorage.setItem('echu_url', u); localStorage.setItem('echu_token', t); }, [URL_ECHU, TOKEN]);
    const page = await ctx.newPage(); const errores = []; page.on('pageerror', e => errores.push(e.message));
    await page.goto(web.url + 'cajas/index.html');
    const resumen = page.locator('summary', {hasText: 'Agregar manualmente declaración faltante'});
    await resumen.first().waitFor({state: 'attached', timeout: 20000});
    const form = page.locator('form[data-team-add="vanesa"]').first();
    assert.equal(await form.locator('[name="mercadoPago"]').inputValue(), '148762,50', 'viene con lo declarado en su cierre');
    assert.equal(await form.locator('[name="cuentaDni"]').inputValue(), '21160,00');
    await page.locator('form[data-team-add="vanesa"]').evaluateAll(fs => fs.forEach(f => { f.closest('details').open = true; }));
    await form.evaluate(f => { f.elements.note.value = 'No la mandó'; f.requestSubmit(); });
    await page.waitForFunction(() => /cargada a mano/i.test(document.body.innerText), null, {timeout: 15000});
    const add = enviados.find(x => x.action === 'add');
    assert.ok(add, 'se mandó a ECHU');
    assert.deepEqual([add.submission.cashierId, add.submission.date, add.submission.note], ['vanesa', '2026-11-19', 'No la mandó']);
    assert.deepEqual(add.submission.boxes, [{box: '0001', expenses: [], mercadoPago: 14876250, cuentaDni: 2116000, other: 0, pendingOrders: 0}]);
    assert.match(add.submission.id, /^[-a-zA-Z0-9]{8,80}$/);
    assert.equal(await page.locator('form[data-team-add]').count(), 0, 'ya no se ofrece cargarla de nuevo');
    assert.match(await page.evaluate(() => document.body.textContent), /Vanesa no mandó su declaración: la cargó el encargado a mano/);
    assert.deepEqual(errores, []);
  } finally {
    await b.close(); web.cerrar();
    DATOS.cajas_estado = antes.e; if (antes.n === undefined) delete DATOS.cajas_envios; else DATOS.cajas_envios = antes.n;
  }
});
