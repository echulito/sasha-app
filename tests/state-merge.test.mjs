// v161: dos dispositivos guardan en Cajas. En vez de frenar con "hay otra revisión", se combinan los cambios (datos inventados).
import test from 'node:test'; import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
import {servir} from './servidor-estatico.mjs';
import {crearECHU, URL_ECHU, TOKEN, DATOS} from './echu-falso.mjs';
import {normalizeState} from '../cajas/domain.mjs';
import {mergeStates, digestState} from '../cajas/state-merge.mjs';

const cierre = (date, batch, sales) => ({type: 'turnClose', date, branch: '01', rows: [{date, branch: '01', box: '0001', batch, cashier: 'Cajera A', opening: 0, cash: 0, remainder: 0, sales, digital: 0, withdrawals: 0, closingWithdrawal: 0, openTime: '09:00', closeTime: '15:00'}]});
const base = () => normalizeState({manual: [], reports: [cierre('2026-11-10', '100', 1000), cierre('2026-11-11', '101', 2000)], completedDays: ['2026-11-10'],
  failedPayments: [{id: 'f1', date: '2026-11-10', amount: 500, note: ''}], closedDays: [{date: '2026-10-12', reason: 'Feriado'}], metricGoals: {venta: 100}});
const clon = x => structuredClone(x);

test('con punto de partida: cada dispositivo aporta lo suyo y no se pisa nada', () => {
  const b = base(), local = clon(b), remoto = clon(b);
  local.completedDays.push('2026-11-11'); local.failedPayments[0].note = 'corregido acá'; local.metricGoals.venta = 150;
  remoto.reports.push(cierre('2026-11-12', '102', 3000)); remoto.closedDays.push({date: '2026-11-13', reason: 'Inventario'}); remoto.metricGoals.tickets = 40;
  remoto.failedPayments.push({id: 'f2', date: '2026-11-12', amount: 900, note: ''});
  const m = mergeStates(local, remoto, digestState(b));
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.changed, true);
  assert.deepEqual(m.state.completedDays, ['2026-11-10', '2026-11-11']);
  assert.equal(m.state.reports.length, 3);
  assert.deepEqual(m.state.failedPayments.map(f => f.id + ':' + f.note), ['f1:corregido acá', 'f2:']);
  assert.deepEqual(m.state.closedDays.map(d => d.date), ['2026-10-12', '2026-11-13']);
  assert.deepEqual(m.state.metricGoals, {venta: 150, tickets: 40});
});

test('con punto de partida: lo que se borró en un lado queda borrado; lo que borró el otro no vuelve', () => {
  const b = base(), local = clon(b), remoto = clon(b);
  local.failedPayments = [];                       // acá se borró el cobro f1
  remoto.completedDays = [];                       // en el otro se reabrió el día 10
  const m = mergeStates(local, remoto, digestState(b));
  assert.deepEqual(m.state.failedPayments, []);
  assert.deepEqual(m.state.completedDays, [], 'el día reabierto en el otro dispositivo no reaparece');
  assert.deepEqual(m.conflicts, []);
});

test('con punto de partida: si los dos cambiaron el mismo dato, queda el de este dispositivo y se avisa', () => {
  const b = base(), local = clon(b), remoto = clon(b);
  local.failedPayments[0].note = 'nota de acá'; remoto.failedPayments[0].note = 'nota del otro';
  const m = mergeStates(local, remoto, digestState(b));
  assert.equal(m.state.failedPayments[0].note, 'nota de acá');
  assert.deepEqual(m.conflicts, ['cobro no efectuado 10/11']);
});

test('sin punto de partida (celular que quedó trabado): se suma lo que tiene cada uno; si el mismo dato difiere queda Google y se avisa', () => {
  const b = base(), local = clon(b), remoto = clon(b);
  local.completedDays.push('2026-11-11'); local.reports[1].rows[0].sales = 2500;
  remoto.reports.push(cierre('2026-11-12', '102', 3000)); remoto.reports[1].rows[0].sales = 2600;
  const m = mergeStates(local, remoto, null);
  assert.deepEqual(m.state.completedDays, ['2026-11-10', '2026-11-11']);
  assert.equal(m.state.reports.length, 3);
  assert.equal(m.state.reports[1].rows[0].sales, 2600, 'ante la duda queda lo de Google');
  assert.deepEqual(m.conflicts, ['informe importado 11/11']);
  assert.equal(m.changed, true);
  // si acá no había nada distinto, no hay nada para subir
  assert.equal(mergeStates(clon(remoto), remoto, null).changed, false);
});

async function abrir({local, revLocal, conBase, servidor}) {
  const antes = {e: DATOS.cajas_estado, g: DATOS.cajas_guardar};
  DATOS.cajas_estado = () => ({state: servidor.state, revision: servidor.revision, sheetUrl: ''});
  DATOS.cajas_guardar = p => { const d = JSON.parse(p.datos); servidor.intentos.push(d.revision);
    if (d.revision !== servidor.revision) throw Object.assign(Error('La planilla cambió. Recargá la app antes de guardar.'), {status: 409});
    servidor.state = d.state; servidor.revision = 'r' + (servidor.intentos.length + 10); return {revision: servidor.revision, saved: true}; };
  const b = await chromium.launch(), web = await servir();
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires'});
  const echu = crearECHU(); await ctx.route(URL_ECHU + '**', r => echu.manejar(r));
  await ctx.addInitScript(([u, t, st, rev, dig]) => {
    localStorage.setItem('echu_url', u); localStorage.setItem('echu_token', t);
    if (st && !localStorage.getItem('yaSembrado')) { localStorage.setItem('yaSembrado', '1'); localStorage.setItem('sashaControlCajasV1', st); localStorage.setItem('cajasRevision', rev); localStorage.setItem('cajasPending', 'true');
      if (dig) localStorage.setItem('cajasBase', dig); }
  }, [URL_ECHU, TOKEN, local ? JSON.stringify(local) : '', revLocal || '', conBase ? JSON.stringify({revision: revLocal, digest: digestState(conBase)}) : '']);
  const page = await ctx.newPage(); const errores = []; page.on('pageerror', e => errores.push(e.message));
  await page.goto(web.url + 'cajas/index.html');
  return {page, errores, cerrar: async () => { await b.close(); web.cerrar(); DATOS.cajas_estado = antes.e; DATOS.cajas_guardar = antes.g; }};
}

test('celular trabado con cambios sin subir y otra revisión en Google: al abrir se combina solo, sube y deja de avisar', async () => {
  const b = base(), local = clon(b), remoto = clon(b);
  local.excludedProductCodes.push('111'); remoto.excludedProductCodes.push('222'); remoto.completedDays.push('2026-11-11');
  const servidor = {state: remoto, revision: 'r2', intentos: []};
  const {page, errores, cerrar} = await abrir({local, revLocal: 'r1', servidor});
  try {
    await page.waitForFunction(() => localStorage.getItem('cajasPending') === null, null, {timeout: 20000});
    assert.deepEqual(servidor.state.excludedProductCodes.slice().sort(), ['111', '222']);
    assert.deepEqual(servidor.state.completedDays, ['2026-11-10', '2026-11-11']);
    assert.deepEqual(servidor.intentos, ['r2'], 'guardó una sola vez, sobre la revisión de Google');
    const texto = await page.locator('body').innerText();
    assert.doesNotMatch(texto, /No se pudo cargar Google Sheets|otra revisión/);
    assert.match(texto, /Se combinaron los cambios de este dispositivo con los de Google/);
    assert.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('sashaConflictBackup'))).data, 'queda una copia de lo que había en el celular');
    assert.deepEqual(errores, []);
  } finally { await cerrar(); }
});

test('app abierta y otro dispositivo guarda mientras tanto: el próximo guardado se combina solo (sin "la planilla cambió")', async () => {
  const b = base();
  const servidor = {state: clon(b), revision: 'r1', intentos: []};
  const {page, errores, cerrar} = await abrir({servidor});
  try {
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('cajasBase')).revision === 'r1'; } catch { return false; } }, null, {timeout: 20000});
    // otro dispositivo guarda
    const otro = clon(b); otro.excludedProductCodes.push('999'); servidor.state = otro; servidor.revision = 'r2';
    await page.evaluate(() => { document.querySelector('#excludedProductCode').value = '555'; document.querySelector('#excludedProductForm').requestSubmit(); });
    await page.waitForFunction(() => localStorage.getItem('cajasPending') === null && localStorage.getItem('cajasRevision') !== 'r1', null, {timeout: 20000});
    assert.deepEqual(servidor.state.excludedProductCodes.slice().sort(), ['555', '999']);
    assert.deepEqual(servidor.intentos, ['r1', 'r2'], 'el primer intento chocó, el segundo ya iba combinado');
    assert.doesNotMatch(await page.locator('body').innerText(), /La planilla cambió|otra revisión/);
    assert.deepEqual(errores, []);
  } finally { await cerrar(); }
});
