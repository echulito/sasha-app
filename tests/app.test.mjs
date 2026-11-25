// Pruebas de la app Sasha (unitarias de la conexión + regresión de pantallas).
// Correr: node --test tests/      ·  Aprobar capturas nuevas a propósito: ACTUALIZAR=1 node --test tests/
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
import {servir} from './servidor-estatico.mjs';
import {crearECHU, URL_ECHU, TOKEN, PIN, huella, DATOS} from './echu-falso.mjs';

const DIR = new URL('.', import.meta.url).pathname, CAPT = DIR + 'capturas/';
const ACTUALIZAR = process.env.ACTUALIZAR === '1';
// Las capturas dependen de las letras instaladas: en GitHub (CI) se comparan solo si se pide.
const CON_CAPTURAS = !process.env.CI || process.env.CAPTURAS === '1';
let navegador, web;
test.before(async () => { navegador = await chromium.launch(); web = await servir(); });
test.after(async () => { await navegador?.close(); web?.cerrar(); });

async function abrir({modo = 'normal', logueado = true, ruta = '', consulta = false} = {}) {
  const ctx = await navegador.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires'});
  const echu = crearECHU(modo);
  await ctx.route(URL_ECHU + '**', r => echu.manejar(r));
  await ctx.addInitScript(([u, t, cq]) => { try { localStorage.setItem('echu_url', u); if (t) localStorage.setItem('echu_token', t); if (cq) localStorage.setItem('echu_modo', 'consulta'); } catch (e) {} }, [URL_ECHU, logueado ? TOKEN : '', consulta]);
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push('JS: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errores.push('consola: ' + m.text()); });
  page.on('response', r => { if (r.status() === 404) errores.push('404: ' + r.url()); });
  await page.goto(web.url + ruta);
  return {ctx, page, echu, errores};
}

test('entra con el PIN por POST: ni el PIN ni la sesión viajan en la dirección', async () => {
  const {ctx, page, echu, errores} = await abrir({logueado: false});
  await page.fill('#lpin', PIN); await page.click('#lbtn');
  await page.getByText('Este mes').first().waitFor({state: 'attached'});
  const login = echu.pedidos.find(p => p.metodo === 'POST' && /"accion":"login"/.test(p.cuerpo));
  assert.ok(login, 'el login tiene que ir por POST');
  for (const p of echu.pedidos) assert.doesNotMatch(p.url, /[?&](pin|token)=/, 'dato secreto en la dirección: ' + p.url);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('PIN equivocado: avisa y no entra', async () => {
  const {ctx, page} = await abrir({logueado: false});
  await page.fill('#lpin', '000000'); await page.click('#lbtn');
  await page.getByText('PIN incorrecto.').waitFor();
  await ctx.close();
});

test('lo que se manda lleva su huella y coincide con lo que llegó', async () => {
  const {ctx, page, echu} = await abrir();
  await page.getByText('Este mes').first().waitFor({state: 'attached'});
  const posts = echu.pedidos.filter(p => p.metodo === 'POST');
  assert.ok(posts.length > 0);
  for (const p of posts) assert.equal(new URL(p.url).searchParams.get('h'), huella(p.cuerpo));
  await ctx.close();
});

test('resumen: muestra los datos y avisa "Llegó completo" arriba (3 segundos)', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  await assert.doesNotReject(page.locator('#avisoSub', {hasText: 'Llegó completo'}).waitFor({state: 'visible', timeout: 3000}));
  await page.waitForTimeout(3300);
  assert.equal(await page.locator('#avisoSub').isVisible(), false);
  assert.match(await page.locator('#sub').innerText(), /Datos del 02\/11\/2026/);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('si la respuesta no coincide con su huella, la app NO usa esos datos', async () => {
  const {ctx, page} = await abrir({modo: 'corrupto'});
  await page.locator('#resumen', {hasText: 'llegó incompleta'}).waitFor({state: 'attached', timeout: 15000});
  assert.equal(await page.getByText('Este mes · noviembre').count(), 0);
  await ctx.close();
});

test('con ECHU sin actualizar (versión anterior) la app sigue andando', async () => {
  const {ctx, page, errores} = await abrir({modo: 'viejo'});
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('con ECHU sin actualizar también se puede entrar con el PIN', async () => {
  const {ctx, page, errores} = await abrir({modo: 'viejo', logueado: false});
  await page.fill('#lpin', PIN); await page.click('#lbtn');
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('guardar: el botón se pone verde "✓ … en ECHU · Llegó completo" y vuelve solo (modelo C)', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="ajustes"]');
  const b = page.locator('#bact'); const antes = await b.innerText();
  await b.click();
  await page.locator('#bact.okEchu', {hasText: '✓ Pedido en ECHU'}).waitFor({timeout: 5000});
  assert.match(await page.locator('.okEchuMini').innerText(), /^Llegó completo · \d\d:\d\d$/);
  await page.waitForTimeout(3300);
  assert.equal(await b.innerText(), antes);
  assert.equal(await page.locator('.okEchuMini').count(), 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});

async function irAGastos(page) {
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="gas"]');
  await page.locator('#c-gas .cmp').first().waitFor();
}
test('Plata v189: los sueldos van juntos en un renglón con el total y llevan a Sueldos para pagarlos con los recibos', async () => {
  const antes = DATOS.inicio;
  DATOS.inicio = Object.assign({}, antes, {pagos: {total: 3184000, items: [
    {nombre: 'Sueldos', monto: 3003000, vence: '07/12', dias: 5, medio: 'MIXTO', medioTexto: 'mixto', vencido: false, ef: 1778000, mp: 1225000, cual: 0, detalle: 'Adrián, Vanesa, Fernanda', ir: 'sueldos'},
    {nombre: 'Alquiler', monto: 181000, vence: '09/12', dias: 7, medio: 'MERCADO PAGO', vencido: false}]}});
  const {ctx, page, errores} = await abrir();
  try {
    await page.click('#bnav button[data-b="caja"]'); await page.click('#cajsec button[data-s="plata"]');
    const card = page.locator('.card', {hasText: 'Pagos de los próximos 7 días'});
    await card.waitFor();
    const t = await card.innerText();
    assert.match(t, /Sueldos · 07\/12\s*Adrián, Vanesa, Fernanda\s*efectivo \$ 1\.778\.000 \+ MP \$ 1\.225\.000\s*\$ 3\.003\.000/);
    assert.equal((t.match(/Sueldos? ·/g) || []).length, 1, 'un solo renglón de sueldos');
    assert.equal(await card.locator('[data-pagar]').count(), 1, 'Pagar solo en Alquiler');
    await card.locator('button', {hasText: 'Ir a Sueldos'}).click();
    assert.equal(await page.locator('#csub button.on').innerText(), 'Sueldos');
    assert.deepEqual(errores, []);
  } finally { DATOS.inicio = antes; await ctx.close(); }
});

test('gastos v191: si la factura no se pudo leer (sin saldo), se carga igual a mano con la lista de gastos sin sumas ni sueldos', async () => {
  const antes = DATOS.gastos_datos, antesL = DATOS.gastos_factura_leer;
  DATOS.gastos_datos = Object.assign({}, antes, {filas: [
    {fila: 44, label: 'Sueldos', nivel: 0, col: 0, total: true, formula: true, cat: 'sue', valor: 3000}, {fila: 47, label: 'Sueldo', nivel: 1, col: 3, formula: false, cat: 'sue', valor: 1100},
    {fila: 71, label: 'Seguridad', nivel: 0, col: 0, total: true, formula: true, cat: 'seg', valor: 154}, {fila: 73, label: 'Verisure', nivel: 1, col: 3, formula: false, raiz: 'Seguridad', cat: 'seg', valor: 74},
    {fila: 66, label: 'Luz - Edenor', nivel: 0, col: 2, formula: false, cat: 'srv', valor: 300}]});
  DATOS.gastos_factura_leer = () => ({ok: false, error: 'LECTURA', mensaje: 'No se pudo leer: OpenAI se quedó sin saldo. Configurá la clave GRATIS de Gemini. Mientras tanto, cargalo a mano abajo.'});
  const {ctx, page, errores} = await abrir();
  try {
    await irAGastos(page);
    await page.setInputFiles('#gfadj', {name: 'f.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')});
    await page.locator('#gf_gasto').waitFor();
    assert.match(await page.locator('#gfac').innerText(), /OpenAI se quedó sin saldo/);
    const ops = await page.locator('#gf_gasto option').allInnerTexts();
    assert.deepEqual(ops.map(o => o.replace(/ · hoy.*/, '')), ['Elegí el gasto…', 'Verisure (Seguridad)', 'Luz - Edenor', '+ Gasto nuevo…']);
    assert.deepEqual(errores, []);
  } finally { DATOS.gastos_datos = antes; DATOS.gastos_factura_leer = antesL; await ctx.close(); }
});

test('gastos v193: factura de servicio con 1er y 2do vencimiento, mes en que se aplica y código para pagar', async () => {
  const antesL = DATOS.gastos_factura_leer, enviados = [];
  const hoy = new Date(), prox = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 10), mm = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  DATOS.gastos_factura_leer = () => ({ok: true, sugerido: 'Agua - AySA', gastos: [{label: 'Agua - AySA', fila: 68, valor: 45022}],
    comprobante: {tipo: 'factura', lado: 'compra', nombre: 'AGUA Y SANEAMIENTOS ARGENTINOS SA', total: 46897.39, vencimiento: mm(prox) + '-10', importe2: 48104.61, vencimiento2: mm(prox) + '-28', mes: mm(prox), codigoPago: '30411134946946261210000046897392500012072210'}});
  DATOS.gastos_factura_guardar = p => { const d = JSON.parse(p.datos); enviados.push(d); return {gasto: d.gasto, monto: d.monto, antes: 45022, vence: d.vence, mes: d.mes, programado: true, gastos: DATOS.gastos_datos}; };
  const {ctx, page, errores} = await abrir();
  try {
    await irAGastos(page);
    await page.setInputFiles('#gfadj', {name: 'f.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')});
    await page.locator('#gf_mes').waitFor();
    assert.equal(await page.inputValue('#gf_monto'), '$ 46.897,39', 'el del 1er vencimiento');
    assert.equal(await page.inputValue('#gf_m2'), '$ 48.104,61', 'v194: el 2do vencimiento se puede corregir y se guarda');
    assert.match(await page.inputValue('#gf_v2'), /^\d{4}-\d\d-28$/);
    assert.match(await page.locator('#gfac').innerText(), /Si pasa el 1er vencimiento y no está pagado, cambia solo al 2do/);
    assert.equal(await page.inputValue('#gf_mes'), mm(prox), 'por defecto, el mes del vencimiento');
    assert.equal(await page.inputValue('#gf_cod'), '30411134946946261210000046897392500012072210');
    await page.click('#gf_ok');
    await page.waitForFunction(() => /desde/.test(document.getElementById('gfac').innerText));
    assert.deepEqual([enviados[0].mes, enviados[0].codigoPago, enviados[0].monto], [mm(prox), '30411134946946261210000046897392500012072210', 46897.39]);
    assert.equal(enviados[0].importe2, 48104.61); assert.match(enviados[0].vence2, /-28$/);
    assert.deepEqual(errores, []);
  } finally { DATOS.gastos_factura_leer = antesL; delete DATOS.gastos_factura_guardar; await ctx.close(); }
});

test('Plata v193: "Pagar ahora" con Mercado Pago (copia el código y abre la app); lo de efectivo no lo tiene', async () => {
  const antes = DATOS.inicio;
  DATOS.inicio = Object.assign({}, antes, {pagos: {total: 217897, items: [
    {nombre: 'Agua - AySA', monto: 46897, vence: '10/12', dias: 5, medio: 'MERCADO PAGO', vencido: false, ef: 0, mp: 46897, cual: 0, codigoPago: '30411134946946261210000046897392500012072210'},
    {nombre: 'Limpieza (Lita)', monto: 171000, vence: '11/12', dias: 6, medio: 'EFECTIVO', vencido: false, ef: 171000, mp: 0, cual: 0}]}});
  const {ctx, page, errores} = await abrir();
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => { window.mpAbrirApp = () => { window.__abrioMp = true; }; });
    await page.click('#bnav button[data-b="caja"]'); await page.click('#cajsec button[data-s="plata"]');
    const card = page.locator('.card', {hasText: 'Pagos de los próximos 7 días'});
    await card.waitFor();
    assert.equal(await card.locator('[data-mp-pagar]').count(), 1, 'Lita (efectivo) sin Pagar ahora');
    await card.locator('[data-mp-pagar]').click();
    assert.equal(await page.inputValue('#mp_dato'), '30411134946946261210000046897392500012072210');
    assert.match(await page.locator('#mpPagarBox').innerText(), /Pagar servicios/);
    await page.click('#mp_ir');
    await page.waitForFunction(() => window.__abrioMp === true);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '30411134946946261210000046897392500012072210');
    assert.deepEqual(errores, []);
  } finally { DATOS.inicio = antes; await ctx.close(); }
});

test('gastos v188: cada gasto en su categoría (el desglose con su gasto), totales sin contar dos veces y se cambia la categoría', async () => {
  const antes = DATOS.gastos_datos, guardados = [];
  const F = (fila, label, nivel, valor, cat, o) => Object.assign({fila, label, nivel, valor, cat, col: nivel ? 3 : 2, formula: false, hijos: false, raiz: '', padre: ''}, o || {});
  const cats = [{k: 'sue', n: 'Sueldos y cargas sociales'}, {k: 'alq', n: 'Alquiler'}, {k: 'srv', n: 'Servicios (luz, agua, internet)'}, {k: 'seg', n: 'Seguridad y seguros'},
    {k: 'imp', n: 'Impuestos y tasas'}, {k: 'hon', n: 'Contadora y sistemas'}, {k: 'mkt', n: 'Marketing y venta online'}, {k: 'lim', n: 'Limpieza y mantenimiento'}, {k: 'fin', n: 'Bancos y gastos financieros'}, {k: 'otr', n: 'Otros e imprevistos'}];
  const datos = Object.assign({}, antes, {categorias: cats, filas: [
    F(44, 'Sueldos', 0, 3000, 'sue', {col: 0, total: true, formula: true, hijos: true}), F(45, 'Sueldos empleados', 1, 2000, 'sue', {formula: true, hijos: true}),
    F(46, 'Adrián', 2, 1500, 'sue', {formula: true, hijos: true}), F(47, 'Sueldo', 3, 1100, 'sue'), F(48, 'Cargas sociales (mitad)', 3, 400, 'sue'),
    F(50, 'Vanesa', 2, 500, 'sue', {formula: true, hijos: true}), F(51, 'Sueldo', 3, 500, 'sue'), F(59, 'Ezequiel (dueño)', 1, 1000, 'sue'),
    F(71, 'Seguridad', 0, 154, 'seg', {col: 0, total: true, formula: true, hijos: true}), F(72, 'Medina', 1, 80, 'seg'), F(73, 'Verisure', 1, 74, 'seg'),
    F(61, 'Alquiler', 0, 1481, 'alq'), F(64, 'ALSMI', 0, 4, 'imp')]});
  DATOS.gastos_datos = datos;
  DATOS.gastos_guardar = p => { const b = JSON.parse(p.datos); guardados.push(b);
    if (b.categorias) datos.filas.forEach(f => { if (b.categorias[f.label]) f.cat = b.categorias[f.label]; });
    return datos; };
  const {ctx, page, errores} = await abrir();
  try {
    await irAGastos(page);
    const t = await page.locator('#c-gas').innerText();
    assert.match(t, /Sueldos y cargas sociales\s*\$ 3\.000/, 'solo el primer nivel: 3.000 (no 3.000 + 2.000 + 1.500…)');
    // v199: el total arriba de todo, antes del desglose
    assert.match(t, /Total de gastos fijos del mes\s*\$ [\d.]+[\s\S]*Sueldos y cargas sociales/i);
    assert.match(t, /Seguridad y seguros\s*\$ 154/);
    assert.doesNotMatch(t, /Marketing y venta online/, 'las categorías sin gastos no aparecen');
    await page.locator('#c-gas .cmp', {hasText: 'Sueldos y cargas sociales'}).locator('.t').click();
    // v196: el desglose se abre de a un nivel
    const caja = page.locator('#c-gas .cmp', {hasText: 'Sueldos y cargas sociales'});
    let sue = await caja.innerText();
    assert.match(sue, /▸\s*Sueldos\s*ver desglose/); assert.doesNotMatch(sue, /Sueldos empleados|Adrián/);
    await caja.locator('span[title] b', {hasText: /^Sueldos$/}).click();
    sue = await caja.innerText();
    assert.match(sue, /▸\s*Sueldos empleados\s*ver desglose\s*\$ 2\.000/); assert.match(sue, /Ezequiel \(dueño\)/); assert.doesNotMatch(sue, /Adrián/);
    await caja.locator('span[title] b', {hasText: /^Sueldos empleados$/}).click();
    sue = await caja.innerText();
    assert.match(sue, /Adrián\s*ver desglose\s*\$ 1\.500/); assert.match(sue, /Vanesa\s*ver desglose\s*\$ 500/); assert.doesNotMatch(sue, /Cargas sociales/);
    await caja.locator('span[title] b', {hasText: /^Adrián$/}).click();
    await caja.locator('span[title] b', {hasText: /^Vanesa$/}).click();
    sue = await caja.innerText();
    assert.match(sue, /Cargas sociales \(mitad\)/);
    assert.doesNotMatch(sue, /Medina|Verisure/, 'la seguridad no va en sueldos');
    assert.equal(await page.locator('#c-gas [data-gf]').count(), 4, 'se editan Sueldo, Cargas, Sueldo y Ezequiel; las sumas no');
    const inputs = page.locator('#c-gas [data-gf]');
    await inputs.nth(2).fill('650');
    await page.locator('#c-gas .cmp', {hasText: 'Sueldos y cargas sociales'}).locator('button.btn', {hasText: 'Guardar'}).click();
    await page.waitForTimeout(300);
    assert.deepEqual(guardados[0].valores, [{fila: 51, label: 'Sueldo', valor: 650}], 'el Sueldo de Vanesa, por renglón');
    // v198: sin el selector de categoría en cada gasto (confundía)
    await page.locator('#c-gas .cmp > .t', {hasText: 'Impuestos y tasas'}).click();
    assert.equal(await page.locator('#c-gas .cmp select').count(), 0);
    assert.deepEqual(errores, []);
  } finally { DATOS.gastos_datos = antes; delete DATOS.gastos_guardar; await ctx.close(); }
});

test('gastos › inflación: muestra qué pasó en el mes, los meses anteriores y se guarda la inflación', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await irAGastos(page);
  await page.getByText('Inflación de octubre').waitFor();
  assert.match(await page.locator('#c-gas').innerText(), /Tus precios de venta\s*\+3,1%\s*▲ 0,4 sobre la inflación/);
  // v200: rentabilidad del mes (costos +4,0% contra precios +3,1%, con margen 42%: 0,58 − 0,58 × 1,04 / 1,031 = −0,5 puntos), en rojo
  assert.match(await page.locator('#c-gas').innerText(), /Tu rentabilidad \(margen\)\s*los costos subieron más que los precios\s*−0,5 puntos/);
  assert.equal(await page.locator('#c-gas .cmpx', {hasText: 'Tu rentabilidad'}).locator('b.neg').count(), 1);
  assert.match(await page.locator('#c-gas').innerText(), /Cuánto vendiste, sin inflación\s*es cantidad, no ganancia\s*−2,0%/);
  assert.equal(await page.locator('#c-gas .cmpx', {hasText: 'Cuánto vendiste'}).locator('b.pos, b.neg').count(), 0, 'sin verde ni rojo');
  assert.match(await page.locator('#c-gas table').innerText(), /MARGEN/i);
  await page.click('#c-gas tr[data-m="2026-09"]');
  await page.getByText('Inflación de septiembre').waitFor();
  await page.fill('#gi_v', '2,9'); await page.click('#gi_ok');
  await page.waitForTimeout(500);
  const g = echu.pedidos.filter(p => p.metodo === 'POST' && /gastos_guardar/.test(p.cuerpo)).pop();
  assert.deepEqual(JSON.parse(JSON.parse(g.cuerpo).datos), {inflacion: {mes: '2026-09', valor: 0.029}});
  assert.deepEqual(errores, []);
  await ctx.close();
});
test('gastos › aumento de cada gasto: con el % se calcula el monto y con el monto el %', async () => {
  const {ctx, page, errores} = await abrir();
  await irAGastos(page);
  await page.locator('#c-gas .cmp .t', {hasText: 'Alquiler y servicios'}).click();
  const i = await page.evaluate(() => GA.D.filas.findIndex(f => f.label === 'Luz'));
  const j = await page.evaluate(() => GA.D.filas.findIndex(f => f.label === 'Alquiler'));
  assert.equal(await page.inputValue('[data-ga="' + j + '"]'), '5');
  await page.fill('[data-ga="' + i + '"]', '10');
  await page.dispatchEvent('[data-ga="' + i + '"]', 'input');
  assert.equal(await page.inputValue('[data-gf="' + i + '"]'), '198.000');
  await page.fill('[data-gf="' + j + '"]', '1.575.000'); await page.dispatchEvent('[data-gf="' + j + '"]', 'input');
  assert.match(await page.inputValue('[data-ga="' + j + '"]'), /^10,[23]$/);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('recorre todas las pestañas sin errores ni bloqueos de seguridad', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  for (const b of ['resumen', 'caja', 'productos', 'mas', 'inicio']) { await page.click('#bnav button[data-b="' + b + '"]'); await page.waitForTimeout(400); }
  await page.click('#bnav button[data-b="productos"]'); await page.click('#productos .bcomp button[data-t="simulador"]'); await page.waitForTimeout(400);
  await page.click('#bnav button[data-b="caja"]'); await page.click('#cajsec button[data-s="plata"]'); await page.waitForTimeout(300);
  for (const d of ['conta', 'limpieza', 'ajustes']) { await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="' + d + '"]'); await page.waitForTimeout(400); }
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('versión de consulta: es la misma app (Resumen, Productos y Simular) sin Ajustes; de Administración ve solo Gastos (v195)', async () => {
  const {ctx, page, echu, errores} = await abrir({consulta: true, ruta: '?consulta'});
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  assert.equal(await page.evaluate(() => document.body.classList.contains('consulta')), true);
  const visibles = await page.$$eval('#bnav button', bs => bs.filter(b => b.offsetParent).map(b => b.dataset.b));
  assert.deepEqual(visibles, ['resumen', 'productos', 'admin']);
  for (const t of visibles.filter(x => x !== 'admin')) { await page.click('#bnav button[data-b="' + t + '"]'); await page.waitForTimeout(300); }
  await page.click('#productos .bcomp button[data-t="simulador"]'); await page.waitForTimeout(300);
  // Con el PIN de consulta no se pide el Inicio (muestra plata y cajas).
  assert.ok(!echu.pedidos.some(p => /"accion":"inicio"|accion=inicio/.test((p.cuerpo || '') + p.url)));
  assert.ok(echu.pedidos.every(p => p.metodo !== 'POST' || /[?&]h=/.test(p.url)));
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('v197: la app de consultas ve los gastos y pide cambios de importes: quedan pendientes de aprobación y se aprueban desde la app con el PIN completo', async () => {
  const antes = DATOS.gastos_datos, pedidos = [];
  const datos = Object.assign({}, antes, {filas: [{fila: 61, label: 'Alquiler', nivel: 0, valor: 1481000, cat: 'alq', col: 2, pagable: true, pagado: false, dia: 9},
    {fila: 62, label: 'Agua - AySA', nivel: 0, valor: 45022, cat: 'srv', col: 2, pagable: true, pagado: true, dia: 10}],
    categorias: [{k: 'alq', n: 'Alquiler'}, {k: 'srv', n: 'Servicios (luz, agua, internet)'}], solicitudes: []});
  DATOS.gastos_datos = datos;
  DATOS.gastos_solicitar = p => { const d = JSON.parse(p.datos); pedidos.push(d);
    datos.solicitudes = [{id: 'S1', fecha: '2026-11-24 17:40', estado: 'pendiente', desde: 'consulta', nota: '', cambios: d.valores.map(v => ({tipo: 'monto', fila: v.fila, label: v.label, antes: 45022, valor: v.valor}))}];
    return datos; };
  const {ctx, page, echu, errores} = await abrir({consulta: true, ruta: '?consulta'});
  try {
    await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
    await page.click('#bnav button[data-b="admin"]');
    await page.locator('#c-gas .cmp').first().waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#bnav button[data-b="admin"]').getAttribute('class'), 'solo-consulta on');
    assert.equal(await page.locator('#admsec').isVisible(), false, 'ni Limpieza ni las otras partes');
    assert.equal(await page.locator('#csub').isVisible(), false);
    await page.locator('#c-gas .cmp > .t', {hasText: 'Servicios'}).click();
    await page.locator('#c-gas [data-gpag]').first().waitFor();
    const t = await page.locator('#c-gas').innerText();
    assert.match(t, /Agua - AySA/); assert.match(t, /pagado este mes\s*·\s*vence el 10/);
    assert.equal(await page.locator('#c-gas [data-gpag]').first().isDisabled(), true, 'el pagado no lo cambia');
    assert.equal(await page.locator('#c-gas button', {hasText: /^Guardar$/}).count(), 0);
    assert.equal(await page.locator('#gfcam').count(), 0, 'no se cargan facturas');
    await page.locator('#c-gas [data-gf]').first().fill('50.000');
    await page.click('#c-gas button:has-text("Pedir el cambio")');
    await page.locator('#c-gas', {hasText: /Tus pedidos de cambio/i}).waitFor();
    assert.deepEqual(pedidos, [{valores: [{fila: 62, label: 'Agua - AySA', valor: 50000}], pct: []}]);
    const t2 = await page.locator('#c-gas').innerText();
    assert.match(t2, /Tus pedidos de cambio[\s\S]*pendiente de aprobación[\s\S]*Agua - AySA: \$ 45\.022 → \$ 50\.000/i);
    assert.ok(!echu.pedidos.some(p => /gastos_guardar|gasto_pagado|gastos_solicitud"/.test(p.cuerpo || '')));
    assert.deepEqual(errores, []);
  } finally { DATOS.gastos_datos = antes; delete DATOS.gastos_solicitar; await ctx.close(); }
});

test('v201: Gastos por mes: por defecto el en curso; los anteriores se ven y se corrigen; la proyección del que viene con aumentos programados', async () => {
  const antes = DATOS.gastos_datos, guardados = [], aumentos = [];
  DATOS.gastos_datos = Object.assign({}, antes, {mes: '2026-11', filas: [{fila: 61, label: 'Alquiler', nivel: 0, valor: 1481000, cat: 'alq', col: 2}],
    categorias: [{k: 'alq', n: 'Alquiler'}, {k: 'srv', n: 'Servicios (luz, agua, internet)'}]});
  const pasado = {mes: '2026-10', tipo: 'pasado', meses: ['2026-09', '2026-10'], filas: [{label: 'Alquiler', valor: 1400000, cat: 'alq'}, {label: 'Luz - Edenor', valor: 280000, cat: 'srv'}]};
  const proy = r => ({mes: '2026-12', tipo: 'proyeccion', meses: [], filas: [{label: 'Alquiler', cat: 'alq', actual: 1481000, valor: r ? 1599480 : 1481000, motivo: r ? 'aumento programado +8% cada 3 meses' : '',
    aumento: r || null, aumentoTxt: r ? '+8% cada 3 meses (próximo: dic 2026)' : ''}]});
  DATOS.gastos_mes = p => p.mes === '2026-10' ? pasado : proy(null);
  DATOS.gastos_mes_guardar = p => { guardados.push(JSON.parse(p.datos)); return Object.assign({}, pasado, {filas: [pasado.filas[0], Object.assign({}, pasado.filas[1], {valor: 290000})]}); };
  DATOS.gastos_aumento = p => { const d = JSON.parse(p.datos); aumentos.push(d); return proy({cada: d.cada, pct: d.pct / 100, desde: d.desde}); };
  const {ctx, page, errores} = await abrir();
  try {
    await irAGastos(page);
    assert.equal(await page.inputValue('#gmes'), '2026-11', 'por defecto el mes en curso');
    await page.selectOption('#gmes', '2026-10');
    await page.locator('#c-gas', {hasText: /Total de gastos fijos de octubre 2026/i}).waitFor();
    assert.match(await page.locator('#c-gas').innerText(), /\$ 1\.680\.000/);
    await page.locator('#c-gas .cmp > .t', {hasText: 'Servicios'}).click();
    await page.fill('#c-gas [data-gm="1"]', '290.000');
    await page.click('#c-gas button:has-text("Guardar")');
    await page.locator('#gmmsg', {hasText: 'Corregido'}).waitFor();
    assert.deepEqual(guardados, [{mes: '2026-10', valores: [{label: 'Luz - Edenor', valor: 290000}]}]);
    await page.selectOption('#gmes', '2026-12');
    await page.locator('#c-gas', {hasText: /Gastos fijos proyectados de diciembre 2026/i}).waitFor();
    await page.locator('#c-gas .cmp > .t', {hasText: 'Alquiler'}).click();
    assert.match(await page.locator('#c-gas').innerText(), /igual que este mes/);
    await page.click('#c-gas button:has-text("Aumento")');
    await page.selectOption('#ga_c0', '3'); await page.fill('#ga_p0', '8'); await page.fill('#ga_d0', '2026-12');
    await page.click('#gaum0 button:has-text("Guardar")');
    await page.locator('#c-gas', {hasText: 'aumento programado +8% cada 3 meses'}).waitFor();
    assert.deepEqual(aumentos, [{label: 'Alquiler', cada: 3, pct: 8, desde: '2026-12', mes: '2026-12'}]);
    assert.match(await page.locator('#c-gas').innerText(), /\$ 1\.599\.480[\s\S]*\+\$ 118\.480 · aumento programado/);
    await page.selectOption('#gmes', '2026-11');
    await page.locator('#c-gas', {hasText: /Total de gastos fijos del mes/i}).waitFor();
    assert.deepEqual(errores, []);
  } finally { DATOS.gastos_datos = antes; ['gastos_mes', 'gastos_mes_guardar', 'gastos_aumento'].forEach(k => delete DATOS[k]); await ctx.close(); }
});

test('v197: el pedido de la app de consultas se aprueba (o rechaza) desde Gastos', async () => {
  const antes = DATOS.gastos_datos, resueltos = [];
  const datos = Object.assign({}, antes, {filas: [{fila: 62, label: 'Agua - AySA', nivel: 0, valor: 45022, cat: 'srv', col: 2}], categorias: [{k: 'srv', n: 'Servicios (luz, agua, internet)'}],
    solicitudes: [{id: 'S1', fecha: '2026-11-24 17:40', estado: 'pendiente', desde: 'consulta', nota: 'vino la factura', cambios: [{tipo: 'monto', fila: 62, label: 'Agua - AySA', antes: 45022, valor: 50000}]}]});
  DATOS.gastos_datos = datos;
  DATOS.gastos_solicitud = p => { const d = JSON.parse(p.datos); resueltos.push(d); datos.solicitudes = [Object.assign({}, datos.solicitudes[0], {estado: 'aprobado'})]; datos.filas[0] = Object.assign({}, datos.filas[0], {valor: 50000}); return datos; };
  const {ctx, page, errores} = await abrir();
  try {
    await irAGastos(page);
    const t = await page.locator('#c-gas').innerText();
    assert.match(t, /Cambios pedidos desde la app de consultas[\s\S]*Agua - AySA: \$ 45\.022 → \$ 50\.000[\s\S]*vino la factura/i);
    await page.locator('#c-gas .cmp > .t', {hasText: 'Servicios'}).click();
    assert.match(await page.locator('#c-gas .cmp', {hasText: 'Servicios'}).innerText(), /pendiente de aprobación: \$ 50\.000/);
    await page.click('#c-gas button:has-text("Aprobar")');
    await page.waitForFunction(() => !/Cambios pedidos desde/i.test(document.getElementById('c-gas').innerText));
    assert.deepEqual(resueltos, [{id: 'S1', aprobar: true}]);
    assert.deepEqual(errores, []);
  } finally { DATOS.gastos_datos = antes; delete DATOS.gastos_solicitud; await ctx.close(); }
});

test('v195: "¿Pagado este mes?" se tilda desde Gastos y Más dice Administración', async () => {
  const antes = DATOS.gastos_datos, pedidos = [];
  const datos = Object.assign({}, antes, {filas: [{fila: 62, label: 'Agua - AySA', nivel: 0, valor: 45022, cat: 'srv', col: 2, pagable: true, pagado: false, dia: 10},
    {fila: 63, label: 'Marketing', nivel: 0, valor: 5000, cat: 'srv', col: 2}], categorias: [{k: 'srv', n: 'Servicios (luz, agua, internet)'}]});
  DATOS.gastos_datos = datos;
  DATOS.gasto_pagado = p => { const d = JSON.parse(p.datos); pedidos.push(d); datos.filas[0] = Object.assign({}, datos.filas[0], {pagado: d.pagado}); return datos; };
  const {ctx, page, errores} = await abrir();
  try {
    await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
    await page.click('#bnav button[data-b="mas"]');
    assert.match(await page.locator('#mas [data-ir="conta"]').innerText(), /^Administración/);
    await page.click('#mas [data-ir="conta"]');
    // v203: arriba ya no está Limpieza | Administración: Limpieza es la última pestaña de Administración
    assert.equal(await page.locator('#admsec').isVisible(), false);
    assert.deepEqual(await page.locator('#csub button').allInnerTexts(), ['IVA', 'Sueldos', 'Gastos', 'Contadora', 'Limpieza']);
    await page.click('#csub button[data-s="lim"]');
    assert.equal(await page.locator('#a-limpieza').isVisible(), true);
    assert.equal(await page.locator('#c-gas').isVisible(), false, 'con Limpieza se ve solo lo de limpieza');
    await page.click('#csub button[data-s="gas"]');
    assert.equal(await page.locator('#a-limpieza').isVisible(), false);
    await page.click('#csub button[data-s="gas"]'); await page.locator('#c-gas .cmp').first().waitFor();
    await page.locator('#c-gas .cmp > .t', {hasText: 'Servicios'}).click();
    assert.equal(await page.locator('#c-gas [data-gpag]').count(), 1, 'solo los que tienen vencimiento');
    await page.locator('#c-gas [data-gpag]').check();
    await page.locator('#c-gas label b.pos', {hasText: 'pagado este mes'}).waitFor();
    assert.deepEqual(pedidos, [{fila: 62, label: 'Agua - AySA', pagado: true}]);
    await page.locator('#c-gas [data-gpag]').uncheck();
    await page.waitForFunction(() => !document.querySelector('#c-gas label b.pos'));
    assert.deepEqual(pedidos[1], {fila: 62, label: 'Agua - AySA', pagado: false});
    assert.deepEqual(errores, []);
  } finally { DATOS.gastos_datos = antes; delete DATOS.gasto_pagado; await ctx.close(); }
});

test('link de cajeras: abre sin errores', async () => {
  const {ctx, page, errores} = await abrir({ruta: 'cajeras/?api=' + encodeURIComponent(URL_ECHU)});
  await page.locator('#username').waitFor();
  await page.waitForTimeout(500);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Inicio (modelo A): números, avisos y cada botón lleva al lugar para resolver', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  await page.locator('#inicio .iav').first().waitFor();
  const t = await page.locator('#inicio').innerText();
  assert.match(t, /Ventas del mes\s*\$ 1\.650\.000/);
  assert.match(t, /Plata libre\s*\$ 412\.000\s*saldos del 01\/11\/2026/);
  assert.match(t, /Pagos 7 días\s*\$ 238\.500\s*2 vencimientos/);
  assert.match(t, /PARA RESOLVER · 4/i);
  assert.deepEqual(await page.$$eval('#inicio .iav b', bs => bs.map(b => b.textContent)), ['Caja 0003 · Cajera Uno · 01/11', 'Vence Alquiler · 04/11', '6 productos se agotan', '12 cambios de costo']);
  // Resolver -> Caja y plata › Cajas (con el módulo de cajeras)
  await page.click('#inicio .iav button[data-ir="caja"]');
  assert.equal(await page.locator('#caja').isVisible(), true);
  assert.equal(await page.locator('#caja-cajas #a-cajeras').isVisible(), true);
  assert.equal(await page.locator('#bnav button.on').getAttribute('data-b'), 'caja');
  // Ver pagos -> Plata y pagos
  await page.click('#bnav button[data-b="inicio"]'); await page.click('#inicio .iav button[data-ir="pagos"]');
  const pl = await page.locator('#caja-plata').innerText();
  assert.match(pl, /Libre para mercadería\s*\$ 412\.000[\s\S]*Alquiler · 04\/11\s*MP \$ 180\.000\s*\$ 180\.000/);
  // v137: cuánto va en efectivo y cuánto por Mercado Pago (sin los datos nuevos de ECHU sale del medio de cada pago)
  assert.match(pl, /Hay ahora\s*\$ 250\.000\s*\$ 480\.000\s*Pagos 7 días\s*\$ 0\s*− \$ 180\.000\s*Queda\s*\$ 250\.000\s*\$ 300\.000/);
  assert.match(pl, /cualquiera de los dos: \$ 58\.500 de los 7 días/);
  await page.click('#bnav button[data-b="inicio"]');
  assert.match(await page.locator('#inicio').innerText(), /Pagos 7 días\s*\$ 238\.500\s*2 vencimientos\s*Efectivo \$ 0 · MP \$ 180\.000 · cualquiera \$ 58\.500/);
  // Armar pedido -> Compras › Simular › Armar pedido
  await page.click('#bnav button[data-b="inicio"]'); await page.click('#inicio .iav button[data-ir="pedido"]');
  assert.equal(await page.locator('#simulador').isVisible(), true);
  assert.equal(await page.locator('#simmodo button.on').getAttribute('data-m'), 'ped');
  assert.equal(await page.locator('#bnav button.on').getAttribute('data-b'), 'productos');
  // Ventas -> el Resumen de siempre
  await page.click('#bnav button[data-b="resumen"]'); await page.getByText('Este mes · noviembre').waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('IVA: tarjeta Compras (facturas − notas de crédito + remitos sin factura) y total en Facturas y Remitos', async () => {
  const {ctx, page, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="iva"]');
  await page.locator('#ctiles .card').nth(3).waitFor();
  // 121.000 − 12.100 + 50.000 (el remito con factura no se suma dos veces)
  assert.match(await page.locator('#ctiles').innerText(), /Compras\s*\$ 158\.900\s*facturas \+ remitos/);
  await page.click('#cseg button[data-s="compras"]');
  assert.match(await page.locator('#clista').innerText(), /Total de facturas a la fecha: \$ 108\.900 \(2\)/);
  await page.click('#cseg button[data-s="remitos"]');
  assert.match(await page.locator('#clista').innerText(), /Total de remitos a la fecha: \$ 80\.000 \(2\) · sin factura: \$ 50\.000/);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Sueldos: editar desde la lista y borrar un empleado (dos toques)', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="sue"]');
  await page.locator('#slista .cmp').nth(1).waitFor();
  await page.locator('#slista .cmp').nth(1).getByText('editar').click();
  assert.equal(await page.inputValue('#se_nom'), 'Empleado Dos');
  await page.click('#se_del');
  assert.match(await page.locator('#se_del').innerText(), /Tocá de nuevo/);
  await page.click('#se_del'); await page.waitForTimeout(500);
  assert.ok(echu.pedidos.some(p => /"accion":"sue_borrar_emp"/.test(p.cuerpo || '') && /"id":"E2"/.test(p.cuerpo || '')));
  assert.equal(await page.locator('#slista .cmp').count(), 1);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Pagar sueldos: estado del recibo, monotributo, dueños aparte; confirmar el reparto y bajar un PDF con el recibo y el de efectivo', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="sue"]');
  await page.locator('#spagar').waitFor();
  const t = await page.locator('#slista').innerText();
  assert.match(t, /Empleada\s+recibo ✓/); assert.match(t, /Empleado\s+falta factura/);
  assert.match(t, /Mercado Pago \$ 600\.000 · Efectivo \$ 300\.000/);
  assert.match(t, /incluye monotributo \$ 50\.000/);
  assert.match(t, /Empleados\s*\$ 1\.450\.000/);
  // abajo, en la liquidación, también van los importes reales del recibo (neto total con el efectivo)
  assert.match(await page.locator('#slista .cmp').nth(0).innerText(), /\$ 900\.000[\s\S]*recibo de la contadora\s*MP \$ 600\.000 \+ efectivo \$ 300\.000/);
  assert.match(await page.locator('#slista .cmp').nth(1).innerText(), /\$ 550\.000[\s\S]*Monotributo \(cuota \$ 50\.000\)[\s\S]*falta la factura/, 'monotributo: sin categoría ni liquidación de Comercio'); assert.match(t, /Dueño Uno \(dueño\)\s*\$ 1\.000\.000/); assert.match(t, /Total sueldos\s*\$ 2\.850\.000/);
  // monotributo: "sigue igual" guarda la cuota del mes
  await page.getByText('Sí, igual').click(); await page.waitForTimeout(400);
  assert.ok(echu.pedidos.some(p => /"accion":"sue_monotributo"/.test(p.cuerpo || '') && /\\"importe\\":50000/.test(p.cuerpo || '')));
  // confirmar: E2 pide 100.000 en efectivo
  await page.click('#spagar');
  assert.equal(await page.inputValue('[data-i="0"][data-sp="mp"]'), '$ 600.000');
  await page.fill('[data-i="1"][data-sp="ef"]', '100000'); await page.dispatchEvent('[data-i="1"][data-sp="ef"]', 'change');
  assert.equal(await page.inputValue('[data-i="1"][data-sp="mp"]'), '$ 450.000');
  await page.fill('[data-i="1"][data-sp="ef"]', '600000'); await page.dispatchEvent('[data-i="1"][data-sp="ef"]', 'change');
  assert.equal(await page.inputValue('[data-i="1"][data-sp="mp"]'), '$ 50.000', 'el monotributo queda por Mercado Pago');
  await page.fill('[data-i="1"][data-sp="ef"]', '100000'); await page.dispatchEvent('[data-i="1"][data-sp="ef"]', 'change');
  await page.click('#sp_ok');
  await page.locator('#sp_msg .pos').first().waitFor();
  await page.locator('#slista .chip.v', {hasText: 'Pago confirmado'}).waitFor();
  // v138: queda confirmado y registrado en ECHU (con la fecha y lo de cada uno) y el botón pasa a "Volver a bajar los PDF"
  const reg = JSON.parse(JSON.parse(echu.pedidos.find(x => /"accion":"sue_pagado"/.test(x.cuerpo || '')).cuerpo).datos);
  assert.equal(reg.pagos.length, 2); assert.match(reg.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(await page.locator('#slista').innerText(), /✓ Pago confirmado el \d{2}\/\d{2}\/\d{4}\s*Efectivo \$ 400\.000 · Mercado Pago \$ 1\.050\.000 · total \$ 1\.450\.000/);
  assert.equal(await page.locator('#spagar').innerText(), 'Volver a bajar los PDF');
  assert.match(await page.locator('#sp_msg').innerText(), /1 recibo\/factura y 2 recibos de efectivo[\s\S]*Pago confirmado y registrado/);
  // v137: siempre queda la barra para abrir/imprimir el PDF (el celular no deja abrir el menú de compartir sin un toque nuevo)
  assert.match(await page.locator('#pdfbarra').innerText(), /PDF listo[\s\S]*Abrir \/ imprimir[\s\S]*Compartir[\s\S]*Guardar/);
  const b64 = await page.evaluate(() => { let s = ''; ULT_PDF.bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); });
  const L = createRequire(import.meta.url)('../pdf-lib.min.js');
  const doc = await L.PDFDocument.load(Buffer.from(b64, 'base64'));
  assert.equal(doc.getPageCount(), 3, 'recibo de la contadora + 2 recibos de efectivo');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Sueldos: el empleado guarda cómo cobra (recibo o monotributo), con qué se le paga y su neto', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="sue"]');
  await page.locator('#slista .cmp').nth(0).waitFor();
  await page.locator('#slista .cmp').nth(0).getByText('editar').click();
  assert.equal(await page.inputValue('#se_pmed'), 'mixto');
  assert.ok(await page.locator('#se_cat').isVisible()); assert.ok(!(await page.locator('#se_pcuota').isVisible()));
  await page.selectOption('#se_ptipo', 'monotributo');
  // v136: con monotributo cambia el formulario: CUIT y cuota; sin categoría, jornada ni sindicato
  assert.ok(!(await page.locator('#se_cat').isVisible())); assert.ok(!(await page.locator('#se_pct').isVisible())); assert.ok(!(await page.locator('#se_afi').isVisible()));
  assert.equal(await page.locator('#se_cuillbl').innerText(), 'CUIT'); assert.ok(await page.locator('#se_pcuota').isVisible());
  await page.selectOption('#se_pmed', 'efectivo'); await page.fill('#se_pneto', '1.200.000');
  await page.click('#se_ok'); await page.waitForTimeout(300);
  assert.match(await page.locator('#se_msg').innerText(), /Poné la cuota del monotributo/);
  await page.fill('#se_pcuota', '75.000');
  await page.click('#se_ok'); await page.waitForTimeout(500);
  const q = echu.pedidos.find(x => /"accion":"sue_monotributo"/.test(x.cuerpo || ''));
  assert.ok(q, 'la cuota se guarda'); const dq = JSON.parse(JSON.parse(q.cuerpo).datos); assert.equal(dq.empleado, 'E1'); assert.equal(dq.importe, 75000); assert.match(dq.periodo, /^\d{4}-\d{2}$/);
  const p = echu.pedidos.find(x => /"accion":"sue_empleado"/.test(x.cuerpo || ''));
  assert.ok(p); const datos = JSON.parse(JSON.parse(p.cuerpo).datos);
  assert.deepEqual(datos.pago, {tipo: 'monotributo', medio: 'efectivo', neto: 1200000, mp: 0});
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Sueldos: el neto se escribe con $ y puntos; en mixto trae por MP lo del recibo y se puede cambiar (el efectivo se acomoda)', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="sue"]');
  await page.locator('#slista .cmp').nth(0).waitFor();
  await page.locator('#slista .cmp').nth(0).getByText('editar').click();
  assert.equal(await page.inputValue('#se_pneto'), '$ 900.000');
  assert.equal(await page.inputValue('#se_pmp'), '$ 600.000', 'por defecto, lo del recibo');
  assert.equal(await page.inputValue('#se_pef'), '$ 300.000');
  await page.fill('#se_pneto', ''); await page.type('#se_pneto', '1100000');
  assert.equal(await page.inputValue('#se_pneto'), '$ 1.100.000');
  assert.equal(await page.inputValue('#se_pef'), '$ 500.000');
  await page.fill('#se_pef', ''); await page.type('#se_pef', '400000');
  assert.equal(await page.inputValue('#se_pmp'), '$ 700.000');
  assert.match(await page.locator('#se_mixnota').innerText(), /Lo cambiaste/);
  await page.click('#se_ok'); await page.waitForTimeout(400);
  const p = echu.pedidos.filter(x => /"accion":"sue_empleado"/.test(x.cuerpo || '')).pop();
  assert.deepEqual(JSON.parse(JSON.parse(p.cuerpo).datos).pago, {tipo: 'recibo', medio: 'mixto', neto: 1100000, mp: 700000});
  // si se deja lo del recibo, no queda fijo (cada mes toma el recibo nuevo)
  await page.locator('#slista .cmp').nth(0).getByText('editar').click();
  await page.click('#se_ok'); await page.waitForTimeout(400);
  const p2 = echu.pedidos.filter(x => /"accion":"sue_empleado"/.test(x.cuerpo || '')).pop();
  assert.equal(JSON.parse(JSON.parse(p2.cuerpo).datos).pago.mp, 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Sueldos: al abrir un empleado con recibo de la contadora, arriba va el recibo (neto, efectivo y total) y el cálculo de la app queda plegado', async () => {
  const {ctx, page, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="sue"]');
  await page.locator('#slista .cmp').nth(0).waitFor();
  await page.locator('#slista .cmp').nth(0).click();
  const t = await page.locator('#slista').innerText();
  assert.match(t, /recibo de la contadora/i);
  assert.match(t, /Neto del recibo · Mercado Pago\s*\$ 600\.000,00/); assert.match(t, /Efectivo\s*\$ 300\.000,00/); assert.match(t, /Total que cobra\s*\$ 900\.000,00/);
  assert.equal(await page.locator('#slista details').evaluate(d => d.open), false);
  await page.click('#sverdoc'); await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => ULT_PDF && ULT_PDF.bytes.length > 100));
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Contadora: lista por de dónde sale, con lo que falta; subir, sacar, no va este mes, mandar (con confirmación si falta algo) y ZIP para WhatsApp', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="cdor"]');
  await page.locator('#c-cdor .kgr').first().waitFor();
  const t = await page.locator('#c-cdor').innerText();
  assert.match(t, /Para la contadora · octubre 2026/); assert.match(t, /Vence el jueves 05\/11 · faltan 3 de 9/);
  assert.deepEqual(await page.locator('#c-cdor .kgt').allInnerTexts(), ['VENTAS (SISTEMA)', 'LO ARMA LA APP', 'MERCADO PAGO Y MERCADO LIBRE', 'BANCO']);
  assert.match(t, /IVA Compras ✓ automático\s*23 facturas · \$ 8\.412\.330/);
  assert.match(t, /Extracto del banco no va este mes\s*Banco Provincia \(PDF\) · cada 3 meses/);
  assert.equal(await page.locator('#c-cdor [data-ksubir="libro_cbte"].btn').count(), 1);
  // percepciones que arma ECHU: automático, con la opción de subir el archivo igual
  assert.match(t, /Percepciones · Mercado Libre ✓ automático\s*Lo trae ECHU de Mercado Libre y lo arma en Excel al mandar\.\s*subir el archivo igual/);
  // subir
  await page.evaluate(() => { document.getElementById('kfile').dataset.doc = 'libro_cbte'; });
  await page.setInputFiles('#kfile', {name: 'LIBRO_CBTE.TXT', mimeType: 'text/plain', buffer: Buffer.from('202610010830000100000')});
  await page.waitForTimeout(500);
  const sub = echu.pedidos.filter(p => /"accion":"contador_subir"/.test(p.cuerpo || '')).pop();
  assert.ok(sub); const cu = JSON.parse(sub.cuerpo);
  assert.equal(cu.doc, 'libro_cbte'); assert.equal(cu.nombre, 'LIBRO_CBTE.TXT'); assert.equal(Buffer.from(cu.archivo, 'base64').toString(), '202610010830000100000');
  // sacar: dos toques
  const x = page.locator('[data-kborrar="A-iva_ventas"]'); await x.click(); assert.equal(await x.innerText(), '¿sacar?'); await x.click(); await page.waitForTimeout(300);
  assert.ok(echu.pedidos.some(p => /"accion":"contador_borrar"/.test(p.cuerpo || '') && /A-iva_ventas/.test(p.cuerpo)));
  // no va este mes
  await page.click('[data-knova="perc_mp"]'); await page.waitForTimeout(300);
  assert.ok(echu.pedidos.some(p => /"accion":"contador_nova"/.test(p.cuerpo || '') && /perc_mp/.test(p.cuerpo) && /valor\\?":\\?"true/.test(p.cuerpo)));
  // mandar: si falta algo, pide un segundo toque
  await page.click('#kmail');
  assert.match(await page.locator('#kmail').innerText(), /Faltan 3: tocá de nuevo/);
  assert.ok(!echu.pedidos.some(p => /"accion":"contador_enviar"/.test(p.cuerpo || '')));
  await page.click('#kmail'); await page.waitForFunction(() => /se mandó/.test(document.getElementById('kmsg').innerText));
  assert.match(await page.locator('#kmsg').innerText(), /se mandó a contadora@ejemplo\.com \(1,2 MB\)/);
  // ZIP para WhatsApp (sin "Compartir" en el navegador de prueba: se baja)
  const [desc] = await Promise.all([page.waitForEvent('download', {timeout: 5000}).catch(() => null), page.click('#kwsp')]);
  await page.waitForTimeout(300);
  assert.ok(echu.pedidos.some(p => /"accion":"contador_zip"/.test(p.cuerpo || '')));
  assert.match(await page.locator('#kwsp').innerText(), /listo/);
  if (desc) assert.equal(desc.suggestedFilename(), 'Contadora - Octubre 2026.zip');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Contadora: "Subir archivos del mes" manda todos juntos; dice dónde fue cada uno, lo repetido no se duplica y lo que no reconoce se avisa', async () => {
  const antes = DATOS.contador_subir;
  const vistos = new Set();
  DATOS.contador_subir = p => {
    if (p.doc !== 'auto') return antes;
    if (/foto/.test(p.nombre)) throw new Error('No supe dónde va "' + p.nombre + '": subilo desde su renglón.');
    const doc = /CBTE/.test(p.nombre) ? 'libro_cbte' : /ALICUOTAS/.test(p.nombre) ? 'libro_alic' : 'ret_cert';
    if (vistos.has(p.archivo)) return {id: 'R', doc, nombre: p.nombre, repetido: true};
    vistos.add(p.archivo); return {id: 'N' + vistos.size, doc, nombre: p.nombre};
  };
  try {
    const {ctx, page, echu, errores} = await abrir();
    await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="cdor"]');
    await page.locator('#c-cdor .kgr').first().waitFor();
    assert.equal(await page.locator('#ktodo').innerText(), '+ Subir archivos del mes');
    await page.setInputFiles('#kfiletodo', [
      {name: 'LIBRO_IVA_DIGITAL_VENTAS_CBTE_SASHA 2026-10.TXT', mimeType: 'text/plain', buffer: Buffer.from('comprobantes octubre')},
      {name: 'LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_SASHA 2026-10.TXT', mimeType: 'text/plain', buffer: Buffer.from('alicuotas octubre')},
      {name: 'LIBRO_IVA_DIGITAL_VENTAS_CBTE_SASHA 2026-10 (1).TXT', mimeType: 'text/plain', buffer: Buffer.from('comprobantes octubre')},
      {name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg')}]);
    await page.waitForFunction(() => /ya estaba/.test((document.getElementById('kres') || {}).innerText || ''), null, {timeout: 8000});
    const subidos = echu.pedidos.filter(p => /"accion":"contador_subir"/.test(p.cuerpo || '')).map(p => JSON.parse(p.cuerpo));
    assert.equal(subidos.length, 4); assert.ok(subidos.every(x => x.doc === 'auto'));
    const r = await page.locator('#kres').innerText();
    assert.match(r, /✓ 2 subidos: Libro IVA Digital · comprobantes, Libro IVA Digital · alícuotas/);
    assert.match(r, /1 ya estaba \(no se duplicó\): LIBRO_IVA_DIGITAL_VENTAS_CBTE_SASHA 2026-10 \(1\)\.TXT/);
    assert.match(r, /No supe dónde va "foto\.jpg": subilo desde su renglón\./);
    if (process.env.CAPTURA) await page.screenshot({path: process.env.CAPTURA});
    assert.deepEqual(errores, []);
    await ctx.close();
  } finally { DATOS.contador_subir = antes; }
});

test('Compartir › Sasha: los archivos que llegan (por ejemplo de WhatsApp) se suben solos a la contadora, cada uno a su lugar', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await page.waitForFunction(() => !!window.caches);
  await page.evaluate(async () => {
    const c = await caches.open('sasha-compartidos');
    await c.put(new Request('./compartido/1-0'), new Response(new Blob(['comprobantes octubre'], {type: 'text/plain'}), {headers: {'Content-Type': 'text/plain', 'X-Nombre': encodeURIComponent('LIBRO_IVA_DIGITAL_VENTAS_CBTE_SASHA PERFUMERÍAS 2026-10.TXT')}}));
    await c.put(new Request('./compartido/1-1'), new Response(new Blob(['PK zip'], {type: 'application/zip'}), {headers: {'Content-Type': 'application/zip', 'X-Nombre': encodeURIComponent('Certificados-de-retenciones-octubre2026.zip')}}));
  });
  await page.goto(page.url().split('?')[0] + '?compartido=1');
  await page.waitForFunction(() => /subido/.test((document.getElementById('kres') || {}).innerText || ''), null, {timeout: 10000});
  assert.equal(await page.locator('#csub button.on').innerText(), 'Contadora');
  const sub = echu.pedidos.filter(p => /"accion":"contador_subir"/.test(p.cuerpo || '')).map(p => JSON.parse(p.cuerpo));
  assert.deepEqual(sub.map(x => [x.doc, x.nombre, x.mime]), [['auto', 'LIBRO_IVA_DIGITAL_VENTAS_CBTE_SASHA PERFUMERÍAS 2026-10.TXT', 'text/plain'], ['auto', 'Certificados-de-retenciones-octubre2026.zip', 'application/zip']]);
  assert.equal(Buffer.from(sub[0].archivo, 'base64').toString(), 'comprobantes octubre');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(async () => (await (await caches.open('sasha-compartidos')).keys()).length), 0, 'después de subirlos se borran');
  assert.doesNotMatch(page.url(), /compartido/);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Compartir › Sasha: los PDF de las cajas van a "Importar PDF" de Cajas; los de la contadora, a Contadora', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await page.waitForFunction(() => !!window.caches);
  await page.evaluate(async () => {
    const c = await caches.open('sasha-compartidos');
    const poner = (k, nombre, tipo, txt) => c.put(new Request('./compartido/' + k), new Response(new Blob([txt], {type: tipo}), {headers: {'Content-Type': tipo, 'X-Nombre': encodeURIComponent(nombre)}}));
    await poner('2-0', 'Cierre de caja 0001 vuelco 2.pdf', 'application/pdf', '%PDF-1.4 no es un pdf de verdad');
    await poner('2-1', 'LIBRO_IVA_DIGITAL_VENTAS_ERR_SASHA 2026-10.PDF', 'application/pdf', '%PDF errores');
  });
  await page.goto(page.url().split('?')[0] + '?compartido=1');
  await page.waitForFunction(() => { try { return /Cierre de caja 0001 vuelco 2\.pdf/.test(document.getElementById('cajframe').contentDocument.getElementById('message').textContent); } catch (e) { return false; } }, null, {timeout: 15000});
  const sub = echu.pedidos.filter(p => /"accion":"contador_subir"/.test(p.cuerpo || '')).map(p => JSON.parse(p.cuerpo).nombre);
  assert.deepEqual(sub, ['LIBRO_IVA_DIGITAL_VENTAS_ERR_SASHA 2026-10.PDF'], 'a la contadora va solo el de la contadora');
  assert.equal(await page.locator('#cajsec button.on').innerText(), 'Cajas');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(async () => (await (await caches.open('sasha-compartidos')).keys()).length), 0);
  assert.deepEqual(errores.filter(e => !/cajas|Google Sheets/i.test(e)), []);
  await ctx.close();
});

test('Compartir › Sasha: el manifiesto acepta archivos y el service worker los guarda y abre la app', async () => {
  const m = JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(m.share_target.method, 'POST'); assert.equal(m.share_target.enctype, 'multipart/form-data');
  assert.ok(m.share_target.params.files[0].accept.includes('.txt') && m.share_target.params.files[0].accept.includes('.zip'));
  const ctx = await navegador.newContext({serviceWorkers: 'allow'});
  const page = await ctx.newPage();
  await ctx.route(URL_ECHU + '**', r => r.fulfill({status: 200, contentType: 'application/json', body: '{"ok":false,"error":"PIN"}'}));
  await page.goto(web.url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const r = await page.evaluate(async () => {
    const fd = new FormData(); fd.append('archivos', new File(['hola txt'], 'LIBRO.TXT', {type: 'text/plain'})); fd.append('archivos', new File(['PK'], 'R.zip', {type: 'application/zip'}));
    const res = await fetch('./?compartir=1', {method: 'POST', body: fd});
    const c = await caches.open('sasha-compartidos'); const ks = await c.keys();
    const nombres = await Promise.all(ks.map(async k => decodeURIComponent((await c.match(k)).headers.get('X-Nombre'))));
    return {url: res.url, nombres: nombres.sort()};
  });
  assert.match(r.url, /\?compartido=1$/);
  assert.deepEqual(r.nombres, ['LIBRO.TXT', 'R.zip']);
  await ctx.close();
});

test('Inicio: el aviso de la contadora lleva a la pantalla Contadora', async () => {
  const antes = DATOS.inicio.avisos;
  DATOS.inicio.avisos = [{nivel: 'amarillo', titulo: 'Contadora · faltan 3 de octubre', detalle: 'Vence el 05/11.', ir: 'contadora'}].concat(antes);
  try {
    const {ctx, page, errores} = await abrir();
    await page.locator('#inicio .iav').first().waitFor();
    await page.locator('#inicio [data-ir="contadora"]').first().click();
    await page.locator('#c-cdor .kgr').first().waitFor();
    assert.equal(await page.locator('#csub button.on').innerText(), 'Contadora');
    assert.deepEqual(errores, []);
    await ctx.close();
  } finally { DATOS.inicio.avisos = antes; }
});

// ---------- Regresión de pantallas: tienen que verse igual que las aprobadas ----------
async function diferencia(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const img = src => new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = 'data:image/png;base64,' + src; });
    const [x, y] = [await img(a), await img(b)];
    if (x.width !== y.width || x.height !== y.height) return 1;
    const c = document.createElement('canvas'); c.width = x.width; c.height = x.height; const g = c.getContext('2d');
    g.drawImage(x, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(y, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 40) n++;
    return n / (c.width * c.height);
  }, [a.toString('base64'), b.toString('base64')]);
}
test('pantallas iguales a las aprobadas (regresión visual)', {skip: !CON_CAPTURAS && 'en CI sin CAPTURAS=1'}, async () => {
  fs.mkdirSync(CAPT, {recursive: true});
  const {ctx, page} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  await page.waitForTimeout(3300); // que se vaya el aviso
  const cambios = [];
  const IR = {inicio: ['#bnav button[data-b="inicio"]'], resumen: ['#bnav button[data-b="resumen"]'], cajas: ['#bnav button[data-b="caja"]', '#cajsec button[data-s="cajas"]'], plata: ['#bnav button[data-b="caja"]', '#cajsec button[data-s="plata"]'],
    productos: ['#bnav button[data-b="productos"]', '#productos .bcomp button[data-t="productos"]'], simulador: ['#bnav button[data-b="productos"]', '#productos .bcomp button[data-t="simulador"]'],
    mas: ['#bnav button[data-b="mas"]'], admin: ['#bnav button[data-b="mas"]', '#mas [data-ir="limpieza"]'], ajustes: ['#bnav button[data-b="mas"]', '#mas [data-ir="ajustes"]']};
  for (const t of Object.keys(IR)) {
    for (const sel of IR[t]) { if (await page.locator(sel).isVisible()) await page.click(sel); }
    await page.waitForTimeout(600);
    await page.locator('#avisoSub').waitFor({state: 'hidden', timeout: 6000}); // el aviso lleva la hora: se espera a que se vaya
    // el calendario marca el día de hoy: se tapa para que la captura no cambie con la fecha
    const png = await page.screenshot({fullPage: true, mask: [page.locator('#verapp'), page.locator('.cal')], animations: 'disabled'});
    const ruta = CAPT + t + '.png';
    if (ACTUALIZAR || !fs.existsSync(ruta)) { fs.writeFileSync(ruta, png); continue; }
    const d = await diferencia(page, fs.readFileSync(ruta), png);
    if (d > 0.002) { fs.writeFileSync(CAPT + t + '.NUEVA.png', png); cambios.push(t + ' (' + (d * 100).toFixed(2) + '% distinto)'); }
  }
  // Administración › Contabilidad › Gastos (con la inflación)
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="gas"]');
  await page.locator('#c-gas .cmp').first().waitFor(); await page.locator('#avisoSub').waitFor({state: 'hidden', timeout: 6000});
  {
    const png = await page.screenshot({fullPage: true, mask: [page.locator('#verapp')], animations: 'disabled'}), ruta = CAPT + 'gastos.png';
    if (ACTUALIZAR || !fs.existsSync(ruta)) fs.writeFileSync(ruta, png);
    else { const d = await diferencia(page, fs.readFileSync(ruta), png); if (d > 0.002) { fs.writeFileSync(CAPT + 'gastos.NUEVA.png', png); cambios.push('gastos (' + (d * 100).toFixed(2) + '% distinto)'); } }
  }
  await ctx.close();
  assert.deepEqual(cambios, [], 'Cambió cómo se ve: ' + cambios.join(', ') + '. Mirá tests/capturas/*.NUEVA.png');
});

test('Sueldos v136: al abrir un empleado de monotributo no hay recibo de Comercio: lo que cobra, la cuota y la factura', async () => {
  const {ctx, page, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="sue"]');
  await page.locator('#slista .cmp').nth(1).waitFor();
  await page.locator('#slista .cmp').nth(1).click();
  const t = await page.locator('#slista').innerText();
  assert.match(t, /monotributo/); assert.match(t, /Lo que cobra · Mercado Pago\s*\$ 500\.000/); assert.match(t, /Cuota de monotributo · Mercado Pago\s*\$ 50\.000/);
  assert.match(t, /Total que cobra\s*\$ 550\.000/); assert.match(t, /Falta la factura/);
  assert.doesNotMatch(t, /Horas extra|Presentismo|NETO A COBRAR/);
  await page.screenshot({path: process.env.CAPTURA || '/dev/null'}).catch(() => {});
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('Facturas v139: el comprobante tiene CAE y vencimiento del CAE, y se mandan al guardar', async () => {
  DATOS.conta_guardar = p => ({comprobante: Object.assign(JSON.parse(p.datos), {id: 'N1', periodo: '2026-11', estado: 'ok'})});
  const {ctx, page, errores, echu} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="iva"]');
  await page.locator('#ctiles .card').nth(3).waitFor();
  await page.evaluate(() => { CT.form = {nuevo: true, datos: {tipo: 'factura', letra: 'A', lado: 'compra', fecha: '2026-11-05', cae: '76451234567890', caeVto: '2026-11-15'}}; cForm(); });
  assert.equal(await page.inputValue('#cf_cae'), '76451234567890'); assert.equal(await page.inputValue('#cf_caevto'), '2026-11-15');
  await page.fill('#cf_prov', 'RAZ Y CIA'); await page.fill('#cf_total', '1.210'); await page.fill('#cf_cae', '7645 1234 5678 91');
  await page.click('#cf_guardar'); await page.waitForTimeout(500);
  const q = echu.pedidos.find(x => /conta_guardar/.test(x.cuerpo || x.url || ''));
  assert.ok(q, 'se mandó'); const datos = JSON.parse(JSON.parse(q.cuerpo).datos);
  assert.equal(datos.cae, '76451234567891'); assert.equal(datos.caeVto, '2026-11-15');
  assert.deepEqual(errores, []);
  delete DATOS.conta_guardar;
  await ctx.close();
});

test('Gastos v140: factura de un gasto en PDF: se lee, viene el gasto elegido, muestra el aumento y guarda importe, vencimiento e IVA Compras', async () => {
  DATOS.gastos_factura_leer = () => ({ok: true, sugerido: 'Luz', comprobante: {tipo: 'factura', letra: 'A', nombre: 'EDENOR SA', cuit: '30655116202', total: 207000, vencimiento: '2026-11-18', periodoFacturado: 'Octubre 2026'},
    gastos: [{label: 'Alquiler', valor: 1500000}, {label: 'Luz', valor: 180000}]});
  DATOS.gastos_factura_guardar = p => { const d = JSON.parse(p.datos); return {gasto: d.gasto, antes: 180000, monto: d.monto, vence: d.vence, comprobante: d.iva ? {id: 'C1'} : null, gastos: DATOS.gastos_datos}; };
  const {ctx, page, errores, echu} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="gas"]');
  await page.locator('#c-gas .cmp').first().waitFor();
  await page.setInputFiles('#gfadj', {name: 'factura.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ' + 'x'.repeat(300))});
  await page.locator('#gf_gasto').waitFor();
  assert.equal(await page.inputValue('#gf_gasto'), 'Luz'); assert.equal(await page.inputValue('#gf_vence'), '2026-11-18');
  assert.match(await page.locator('#gf_dif').innerText(), /Tenías \$ 180\.000 → pasa a \$ 207\.000 \(\+15,0%\)\. Se aplica en este mes\./);
  assert.ok(await page.locator('#gf_iva').isChecked());
  await page.click('#gf_ok');
  await page.locator('#gfac .pos').waitFor();
  assert.match(await page.locator('#gfac').innerText(), /Listo: Luz \$ 207\.000 \(tenías \$ 180\.000\), vence el 18\/11\/2026 · quedó en IVA Compras\./);
  const q = echu.pedidos.find(x => /gastos_factura_guardar/.test(x.cuerpo || ''));
  const cuerpo = JSON.parse(q.cuerpo), d = JSON.parse(cuerpo.datos);
  assert.equal(cuerpo.mime, 'application/pdf'); assert.match(cuerpo.imagen, /^data:application\/pdf;base64,/);
  assert.deepEqual([d.gasto, d.monto, d.vence, d.iva], ['Luz', 207000, '2026-11-18', true]); assert.equal(d.comprobante.cuit, '30655116202');
  assert.deepEqual(errores, []);
  delete DATOS.gastos_factura_leer; delete DATOS.gastos_factura_guardar;
  await ctx.close();
});

test('Facturas v185: la letra se elige (A, B o C); una B de compra se carga solo con el total; las percepciones van por separado', async () => {
  DATOS.conta_guardar = p => ({comprobante: Object.assign(JSON.parse(p.datos), {id: 'N1', periodo: '2026-11', estado: 'ok'})});
  const {ctx, page, errores, echu} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="iva"]');
  await page.locator('#ctiles .card').nth(3).waitFor();
  const guardado = async () => { await page.waitForFunction(() => true); await page.waitForTimeout(400); const q = echu.pedidos.filter(x => /conta_guardar/.test(x.cuerpo || x.url || '')).pop(); return q && JSON.parse(JSON.parse(q.cuerpo).datos); };
  // sin letra leída: hay que elegirla
  await page.evaluate(() => { CT.form = {nuevo: true, datos: {tipo: 'factura', letra: '', lado: 'compra', fecha: '2026-11-20', nombre: 'INC SA', total: 86352.01}}; cForm(); });
  assert.equal(await page.inputValue('#cf_letra'), '');
  await page.fill('#cf_prov', 'INC SA'); await page.click('#cf_guardar');
  assert.match(await page.locator('#cf_msg').innerText(), /Elegí la letra de la factura/);
  assert.equal(echu.pedidos.filter(x => /conta_guardar/.test(x.cuerpo || '')).length, 0);
  // factura B: solo el total (sin neto ni IVA)
  await page.selectOption('#cf_letra', 'B');
  await page.locator('#cf_sin_iva').waitFor();
  assert.match(await page.locator('#cf_sin_iva').innerText(), /Factura B: no da crédito de IVA y no va a la contadora/);
  assert.equal(await page.locator('#cf_i21').count(), 0);
  assert.equal(await page.inputValue('#cf_total'), '86.352,01');
  await page.click('#cf_guardar');
  let d = await guardado();
  assert.deepEqual([d.letra, d.total], ['B', 86352.01]);
  // factura A con percepciones: cada una en su renglón, los totales salen del detalle
  await page.evaluate(() => { CT.form = {nuevo: true, datos: {tipo: 'factura', letra: 'A', lado: 'compra', fecha: '2026-11-19', nombre: 'RAZ Y CIA', total: 103561.87, neto: {21: 83517.64}, iva: {21: 17538.7},
    percepciones: [{nombre: 'IB410DGR05', tipo: 'IIBB', jurisdiccion: '', importe: 2505.53}]}}; cForm(); });
  assert.equal(await page.locator('#cf_percs [data-perc]').count(), 1);
  await page.click('#cf_perc_mas');
  await page.locator('#cf_percs [data-perc]').nth(1).locator('[data-k=tipo]').selectOption('IVA');
  await page.locator('#cf_percs [data-perc]').nth(1).locator('[data-k=nombre]').fill('IVA RG5329');
  await page.locator('#cf_percs [data-perc]').nth(1).locator('[data-k=importe]').fill('10,50');
  await page.fill('#cf_prov', 'RAZ Y CIA'); await page.click('#cf_guardar');
  d = await guardado();
  assert.deepEqual(d.percepciones, [{tipo: 'IIBB', nombre: 'IB410DGR05', jurisdiccion: '', importe: 2505.53}, {tipo: 'IVA', nombre: 'IVA RG5329', jurisdiccion: '', importe: 10.5}]);
  assert.deepEqual([d.percIIBB, d.percIVA], [2505.53, 10.5]);
  assert.deepEqual(errores, []);
  delete DATOS.conta_guardar;
  await ctx.close();
});

test('Facturas v187: el CUIT y la razón social de la factura se asocian al proveedor de ECHU (nombre de fantasía)', async () => {
  DATOS.conta_guardar = p => ({comprobante: Object.assign(JSON.parse(p.datos), {id: 'N2', periodo: '2026-11', estado: 'ok'})});
  const {ctx, page, errores, echu} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="iva"]');
  await page.locator('#ctiles .card').nth(3).waitFor();
  await page.evaluate(() => { CT.mes.proveedores = [{nombre: 'RAZ Y CIA', cuit: '', cuits: []}, {nombre: 'DAI NIPPON', cuit: '30500000003', cuits: ['30500000003']}]; });
  // lo leído trae la razón social (no es un proveedor de ECHU): el proveedor queda para elegir
  await page.waitForTimeout(800);
  await page.evaluate(() => { CT.mes.proveedores = [{nombre: 'RAZ Y CIA', cuit: '', cuits: []}, {nombre: 'DAI NIPPON', cuit: '30500000003', cuits: ['30500000003']}]; CT.form = {nuevo: true, datos: {tipo: 'factura', letra: 'A', lado: 'compra', fecha: '2026-11-19', cuit: '30661110100', nombre: 'RAZ & CIA SRL', razonSocial: 'RAZ & CIA SRL', total: 1000, neto: {21: 826.45}, iva: {21: 173.55}}}; cForm(); });
  assert.equal(await page.inputValue('#cf_razon'), 'RAZ & CIA SRL');
  assert.equal(await page.inputValue('#cf_prov'), '');
  assert.match(await page.locator('label', {hasText: 'Proveedor en ECHU'}).innerText(), /nombre de fantasía/);
  assert.match(await page.locator('#cf_provinfo').innerText(), /Elegí a qué proveedor de ECHU corresponde/);
  await page.fill('#cf_prov', 'raz y cia');
  assert.match(await page.locator('#cf_provinfo').innerText(), /RAZ Y CIA · al guardar, el CUIT 30-66111010-0 \(RAZ & CIA SRL\) queda asociado a este proveedor/);
  await page.click('#cf_guardar');
  await page.waitForTimeout(500);
  const q = echu.pedidos.filter(x => /conta_guardar/.test(x.cuerpo || '')).pop();
  const d = JSON.parse(JSON.parse(q.cuerpo).datos);
  assert.deepEqual([d.emisorNombre, d.emisorCuit, d.razonSocial, d.asociarCuit], ['RAZ Y CIA', '30-66111010-0', 'RAZ & CIA SRL', true]);
  // un CUIT ya asociado: el proveedor viene solo; si se elige otro, avisa que se pasa
  await page.waitForTimeout(800);
  await page.evaluate(() => { CT.mes.proveedores = [{nombre: 'RAZ Y CIA', cuit: '30661110100', cuits: ['30661110100']}, {nombre: 'DAI NIPPON', cuit: '30500000003', cuits: ['30500000003']}]; CT.form = {nuevo: true, datos: {tipo: 'factura', letra: 'A', lado: 'compra', fecha: '2026-11-19', cuit: '30500000003', nombre: 'DAI NIPPON SA', razonSocial: 'DAI NIPPON SA', total: 1}}; cForm(); });
  assert.equal(await page.inputValue('#cf_prov'), 'DAI NIPPON');
  assert.match(await page.locator('#cf_provinfo').innerText(), /ya está asociado a DAI NIPPON/);
  await page.fill('#cf_prov', 'RAZ Y CIA');
  assert.match(await page.locator('#cf_provinfo').innerText(), /estaba asociado a DAI NIPPON\. Al guardar pasa a RAZ Y CIA/);
  assert.deepEqual(errores, []);
  delete DATOS.conta_guardar;
  await ctx.close();
});

test('Contabilidad v140: se puede adjuntar la factura electrónica en PDF (se lee directo, sin escanear)', async () => {
  DATOS.conta_leer = p => { if (p.mime !== 'application/pdf' || !/^data:application\/pdf;base64,/.test(p.imagen)) throw new Error('no llegó el PDF'); return {ok: true, tipo: 'factura', letra: 'A', lado: 'compra', fecha: '2026-11-05', nombre: 'RAZ Y CIA', total: 1210, cae: '76451234567890', caeVto: '2026-11-15'}; };
  const {ctx, page, errores} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="iva"]');
  await page.locator('#ctiles .card').nth(3).waitFor();
  await page.setInputFiles('#cadj', {name: 'fe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ' + 'y'.repeat(300))});
  await page.locator('#cf_cae').waitFor();
  assert.equal(await page.inputValue('#cf_cae'), '76451234567890');
  assert.match(await page.locator('#cform').innerText().catch(() => page.locator('body').innerText()), /Factura electrónica \(PDF\)/);
  assert.deepEqual(errores, []);
  delete DATOS.conta_leer;
  await ctx.close();
});

test('link de cajeras v141: solapas Declarar / Buscar / Cobros; el buscador solo muestra nombre, si está pedido y precio; pedir lo manda y queda marcado', async () => {
  const hoy = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  DATOS.cajera_perfil = {person: {id: 'fernanda', name: 'Fernanda', shift: 'tarde', start: '15:30', end: '19:30'}, today: hoy, shiftOptions: ['mañana', 'tarde', 'cover'], present: true, closed: false};
  DATOS.cajera_buscar = p => ({productos: [{codigo: '101', producto: 'SHAMPOO DOVE X 200', precio: 2999, stock: 0, estado: 'no', estadoTexto: 'No está pedido'},
    {codigo: '100', producto: 'SHAMPOO DOVE RITUAL X 400', precio: 4999, stock: 3, estado: 'pedido', estadoTexto: '✓ Pedido'}].filter(x => x.producto.toLowerCase().includes(String(p.q).toLowerCase()))});
  DATOS.cajera_personas = {personas: ['Adrian', 'Fernanda', 'Vanesa'], yo: 'Fernanda'};
  DATOS.cajera_pedir = p => { const d = JSON.parse(p.datos); return {ok: true, producto: 'SHAMPOO DOVE X 200', cantidad: d.cantidad, pidio: d.pidio}; };
  DATOS.cajera_cobros = {fecha: hoy, mp: [{hora: '19:36:00', importe: 889496.9, estado: 'Aprobado', ok: true, operacion: '187', canal: 'Online / otros'}, {hora: '17:00:00', importe: 500, estado: 'Rechazado', ok: false, operacion: '112', canal: 'QR'}, {hora: '16:49:40', importe: 1506, estado: 'Aprobado', ok: true, operacion: '111', canal: 'QR'}],
    dni: [{hora: '18:06:50', importe: 10100, estado: 'Aprobado', ok: true, operacion: '510919548', pagador: 'Persona Prueba', autorizacion: 'ABC123'}, {hora: '9:15:00', importe: 777, estado: 'Aprobado', ok: true, operacion: '5001', pagador: 'Temprano'}, {hora: '19:20:00', importe: 888, estado: 'Aprobado', ok: true, operacion: '5002', pagador: 'Tarde'}].sort((a, b) => (a.hora < b.hora ? -1 : 1)), dniAviso: 'Los de Cuenta DNI aparecen cuando llega el mail de Redlink (puede tardar unos minutos).'};
  const {ctx, page, errores, echu} = await abrir({ruta: 'cajeras/?api=' + encodeURIComponent(URL_ECHU)});
  await page.fill('#username', 'fernanda'); await page.click('#loginForm button');
  await page.locator('#tabs:not([hidden])').waitFor();
  assert.ok(await page.locator('#closeForm').isVisible());
  // Buscar
  await page.click('#tabs [data-tab="buscar"]');
  assert.ok(!(await page.locator('#closeForm').isVisible()), 'la declaración se oculta');
  await page.fill('#q', 'dove'); await page.locator('.prod').first().waitFor();
  const t = await page.locator('#resultados').innerText();
  assert.match(t, /SHAMPOO DOVE RITUAL X 400\s*\$ 4\.999\s*Cód\. 100 · Stock 3\s*✓ Pedido\n/); assert.match(t, /SHAMPOO DOVE X 200\s*\$ 2\.999\s*Cód\. 101 · Sin stock\s*No está pedido\s*Pedir/);
  await page.click('.prod[data-cod="101"] [data-pedir]');
  assert.equal(await page.inputValue('.prod[data-cod="101"] [data-pidio]'), 'Fernanda', 'viene elegida la que entró');
  await page.selectOption('.prod[data-cod="101"] [data-pidio]', 'Vanesa'); await page.fill('.prod[data-cod="101"] [data-cant]', '6');
  if (process.env.CAPTURA_CAJ) await page.screenshot({path: process.env.CAPTURA_CAJ + '-pedir.png', fullPage: true});
  await page.click('.prod[data-cod="101"] [data-enviar]');
  await page.locator('#enviado:not(:empty)').waitFor();
  // v144: no desaparece: queda marcado "Pedido por cajeras" y sin el botón Pedir
  assert.match(await page.locator('.prod[data-cod="101"]').innerText(), /✓ Pedido por cajeras \(Vanesa, 6 u\.\)/);
  assert.equal(await page.locator('.prod[data-cod="101"] [data-pedir], .prod[data-cod="101"] [data-form]').count(), 0);
  assert.match(await page.locator('#enviado').innerText(), /Pedido enviado: 6 × SHAMPOO DOVE X 200 \(lo pidió Vanesa\)/);
  if (process.env.CAPTURA_CAJ) await page.screenshot({path: process.env.CAPTURA_CAJ + '-buscar.png', fullPage: true});
  const q = echu.pedidos.find(x => /cajera_pedir/.test(x.cuerpo || '')); const d = JSON.parse(JSON.parse(q.cuerpo).datos);
  assert.deepEqual([d.codigo, d.cantidad, d.pidio], ['101', 6, 'Vanesa']);
  // v145: el aviso cambia solo, sin buscar de nuevo: el dueño lo descarta -> vuelve "No está pedido" con Pedir; lo marca Pedido -> "✓ Pedido"
  DATOS.cajera_estados = {estados: {'101': {estado: 'no', estadoTexto: 'No está pedido'}, '100': {estado: 'pedido', estadoTexto: '✓ Pedido'}}};
  await page.locator('.prod[data-cod="101"] [data-pedir]').waitFor({timeout: 12000});
  assert.match(await page.locator('.prod[data-cod="101"]').innerText(), /No está pedido\s*Pedir/);
  DATOS.cajera_estados = {estados: {'101': {estado: 'pedido', estadoTexto: '✓ Pedido'}}};
  await page.locator('.prod[data-cod="101"] .chip.verde').waitFor({timeout: 12000});
  assert.equal(await page.locator('.prod[data-cod="101"] [data-pedir]').count(), 0);
  // v147: con el catálogo bajado, la búsqueda se hace en el celular (sin pedirle a ECHU) y sale al instante, también por rubro
  DATOS.cajera_catalogo = {cat: [['104', 'AXE APOLLO X 150', 4749, '7790000000005', 'axe apollo x 150 7790000000005 desodorantes', 7], ['105', 'REXONA MEN X 90', 3999, '7790000000006', 'rexona men x 90 7790000000006 desodorantes', 0],
    ['099', 'AAA DEO VIEJO X 100', 1500, '7790000000009', 'aaa deo viejo x 100 7790000000009 desodorantes', 2, 1]],
    camino: ['105'], pend: {'099': {quien: 'Vanesa', fecha: '10/11', estado: 'pedido', producto: 'AAA DEO VIEJO X 100', cant: '6'}, 'T:tintura 919': {quien: 'Adrian', fecha: '09/11', estado: 'pendiente', producto: 'Tintura 919', cant: '2'}}};
  DATOS.cajera_estados = p => (p.lista ? {estados: {}, pend: DATOS.cajera_catalogo.pend} : {estados: {}});
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await page.click('#tabs [data-tab="buscar"]');
  await page.waitForFunction(() => document.querySelector('#q') && true); await page.waitForTimeout(900);
  // v154: sin buscar nada, la lista de pedidos (lo ya pedido y lo que falta comprar)
  await page.fill('#q', ''); await page.locator('#resultados .grupo').first().waitFor({timeout: 8000});
  await page.waitForFunction(() => /AAA DEO VIEJO/.test(document.querySelector('#resultados').innerText), null, {timeout: 8000});
  const tp = await page.locator('#resultados').innerText();
  assert.match(tp, /Ya pedidos al proveedor \(1\)\s*AAA DEO VIEJO X 100\s*6 u\.\s*Cód\. 099 · lo pidió Vanesa · 10\/11/);
  assert.match(tp, /falta comprarlos \(1\)\s*Tintura 919\s*2 u\.\s*Sin código · lo pidió Adrian · 09\/11/);
  assert.doesNotMatch(tp, /\$/, 'la lista no muestra precios ni costos');
  const antes = echu.pedidos.filter(x => /cajera_buscar/.test(x.cuerpo || '')).length;
  await page.fill('#q', 'desodorante'); await page.locator('.prod[data-cod="104"]').waitFor({timeout: 3000});
  const tl = await page.locator('#resultados').innerText();
  assert.match(tl, /AXE APOLLO X 150\s*\$ 4\.749\s*Cód\. 104 · Stock 7\s*No está pedido\s*Pedir/); assert.match(tl, /REXONA MEN X 90\s*\$ 3\.999\s*Cód\. 105 · Sin stock\s*✓ Pedido/);
  // v151: los discontinuados aparecen, marcados y al final
  assert.match(tl, /REXONA MEN[\s\S]*AAA DEO VIEJO X 100\s*\$ 1\.500\s*Cód\. 099 · Stock 2 · Discontinuado/);
  assert.equal(echu.pedidos.filter(x => /cajera_buscar/.test(x.cuerpo || '')).length, antes, 'no le pidió la búsqueda a ECHU');
  await page.fill('#q', '7790000000006'); await page.waitForTimeout(400);
  assert.equal(await page.locator('.prod').count(), 1);
  // Cobros
  await page.click('#tabs [data-tab="cobros"]');
  await page.locator('#mpLista .cobro').first().waitFor();
  // v142: sin totales y sin cobros online / otros
  assert.equal(await page.locator('#mpRes').count(), 0); assert.doesNotMatch(await page.locator('#tabCobros').innerText(), /889\.496|Online/);
  const c = await page.locator('#tabCobros').innerText();
  assert.match(c, /16:49\s*\$ 1\.506\s*Aprobado\s*Op\. 111 · QR/); assert.match(c, /17:00\s*\$ 500\s*Rechazado/); assert.match(c, /18:06\s*\$ 10\.100\s*Aprobado\s*Op\. 510919548 · Persona Prueba\s*Autorización ABC123/);
  // v153: Cuenta DNI del último al primero, como Mercado Pago
  // v154: entró en el turno tarde (desde 15:30): no ve el cobro de las 9:15; y sin la explicación del mail
  assert.deepEqual(await page.locator('#dniLista .cobro .hora').allInnerTexts(), ['19:20', '18:06']);
  assert.match(c, /Turno tarde: cobros desde las 15:30/); assert.doesNotMatch(c, /mail de Redlink/);
  assert.doesNotMatch(c, /comisi|neto/i);
  if (process.env.CAPTURA_CAJ) await page.screenshot({path: process.env.CAPTURA_CAJ + '-cobros.png', fullPage: true});
  await page.click('#tabs [data-tab="declarar"]'); assert.ok(await page.locator('#closeForm').isVisible());
  assert.deepEqual(errores, []);
  for (const k of ['cajera_perfil', 'cajera_buscar', 'cajera_personas', 'cajera_pedir', 'cajera_cobros', 'cajera_estados', 'cajera_catalogo']) delete DATOS[k];
  await ctx.close();
});

test('Ficha v150: "Proveedor y costo" separa el proveedor actual de los precios en cada lista y dice el mejor costo', async () => {
  DATOS.producto = {codigo: '900', producto: 'PAÑAL PRUEBA', proveedor: 'COMPRA BEAUTY (DAI NIPPON)', codigoProveedor: '791', precio: 5999, costo: 4749.42, costoSistema: 4749.42, margen: 0.2, stock: 2,
    ventaDiaria: 0.8, ventaMensual: 24, evaluacion: {nivel: 'ok', texto: 'ACEPTABLE'}, ficha: {}, ventas: {ultimas: []}, mejorCosto: 0,
    bultos: [{proveedor: 'UPA PAÑALERA', codigo: 'U-5', costo: 4749.42, unidades: 1, actual: false, fecha: '07/09', vencida: true},
      {proveedor: 'DAI NIPPON', codigo: '791', costo: 2630, unidades: 6, actual: false, fecha: '10/11', vencida: false}]};
  const {ctx, page, errores} = await abrir();
  await page.evaluate(() => verProducto('900'));
  await page.locator('#bsim').waitFor();
  const t = await page.locator('.card', {hasText: 'Proveedor y costo'}).innerText();
  assert.match(t, /Proveedor actual\s*COMPRA BEAUTY \(DAI NIPPON\)\s*Código en COMPRA BEAUTY \(DAI NIPPON\)\s*791\s*Costo actual \(el que usa ECHU\)\s*\$ 4\.749,42 c\/u/);
  assert.match(t, /DAI NIPPON\s*cód\. 791 · lista del 10\/11 · bulto 6 u\.\s*\$ 2\.630,00 c\/u[\s\S]*UPA PAÑALERA\s*cód\. U-5 · lista del 07\/09 · vencida/);
  assert.match(t, /Mejor costo: \$ 2\.630,00 en DAI NIPPON \(cód\. 791\) · 45% menos que el actual/);
  assert.deepEqual(errores, []);
  delete DATOS.producto;
  await ctx.close();
});

test('Ficha v186: el mes en curso aparece en el historial y en la tabla por mes, aclarando que no es el número final', async () => {
  DATOS.producto = {codigo: '40224', producto: 'REXONA CREMA PRUEBA', proveedor: 'TORNADO', codigoProveedor: '4376', precio: 3199, costo: 1690, costoSistema: 1690, margen: 0.47, stock: 20,
    ventaDiaria: 1.7, ventaMensual: 48.7, evaluacion: {nivel: 'ok', texto: 'ACEPTABLE'}, mejorCosto: 0, bultos: [],
    mesActual: {mes: 'noviembre 2026', hasta: '19/11', vendidas: 38, diasConStock: 19, diasTranscurridos: 19, diasQuedan: 11, normal: 52.2, restoMes: {min: 14, max: 18}, mesQueViene: 'diciembre', comprarHastaFinMesQueViene: 54},
    ficha: {mejorMes: {mes: 'mar 2026', unidades: 84, precio: 2582}, peorMes: {mes: 'ago 2026', unidades: 44}},
    ventas: {ultimas: [], meses: [{mes: 'oct 2026', unidades: 54, precio: 3175, costo: 2071, margen: 0.348}]}};
  const {ctx, page, errores} = await abrir();
  await page.evaluate(() => verProducto('40224'));
  await page.locator('#bsim').waitFor();
  const h = await page.locator('.card', {hasText: 'Historial'}).first().innerText();
  assert.match(h, /Mejor mes\s*mar 2026 · 84 u\. a \$ 2\.582/); assert.match(h, /Peor mes\s*ago 2026 · 44 u\./);
  assert.match(h, /nov 2026 \(en curso, hasta el 19\/11\)\s*38 u\. · a este ritmo ~60 u\./);
  assert.match(h, /no es el número final/);
  const t = await page.locator('table', {hasText: 'Precio prom.'}).innerText();
  assert.match(t, /nov 2026\s*en curso\s*38\s*hasta el 19\/11 · todavía no es el número final\s*oct 2026\s*54/);
  assert.deepEqual(errores, []);
  delete DATOS.producto;
  await ctx.close();
});

// v157: al simular una compra, la oferta puede ser 2x1, 3x2 o 2da unidad al X% (equivale a un descuento por unidad llevando la promo).
test('simular compra: ofertas por cantidad (2x1, 3x2, 2da unidad al 80%)', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  const r = await page.evaluate(() => {
    const d = {c: 3000, pv: 0, q: 0, mn: 0.3, obj: 0.4, pMin: 0}, out = {};
    document.getElementById('epre').value = '5000';
    for (const t of ['2x1', '3x2', '2da', 'desc']) {
      document.getElementById('etipo').value = t; document.getElementById('e2da').value = '80'; document.getElementById('epct').value = '20'; verTipoOferta();
      const e = calcOpcion(2, d, 10, 30, 0);
      out[t] = {lista: e.lista, P: e.P, promo: e.promo, lleva: e.lleva, desc: Math.round(e.desc * 1000) / 10, html: htmlOpcion(e),
        pct: !document.getElementById('epctbox').classList.contains('oculto'), seg: !document.getElementById('e2dabox').classList.contains('oculto')};
    }
    return out;
  });
  assert.deepEqual([r['2x1'].lista, r['2x1'].P, r['2x1'].promo, r['2x1'].lleva, r['2x1'].desc], [10000, 5000, '2x1', 2, 50]);
  assert.deepEqual([r['3x2'].lista, r['3x2'].P, r['3x2'].promo, r['3x2'].lleva], [7500, 5000, '3x2', 3]);
  assert.deepEqual([r['2da'].lista, r['2da'].P, r['2da'].promo, r['2da'].desc, r['2da'].seg], [8330, 4998, '2da unidad al 80%', 40, true]);
  assert.deepEqual([r.desc.lista, r.desc.P, r.desc.promo, r.desc.pct], [6250, 5000, '', true]);
  assert.match(r['2x1'].html, /Llevando 2 paga \$ 10\.000 · queda \$ 5\.000 cada una/);
  assert.match(r['2x1'].html, /Oferta<\/span><span>2x1/);
  assert.match(r.desc.html, /Bonificación/);
  assert.deepEqual(errores, []);
  await ctx.close();
});

// v159: Más › Agentes automáticos › Civil Systems.
test('agentes automáticos v164: reportes de un día con la lista que se tilda en vivo, y horarios configurables', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  const base = {tieneClave: true, agente: {disponible: true, hace: 12, civil: true, sesion: 'desconectada'}, activa: null, ultima: null, historial: [],
    prog: {activo: true, hora: '23:00', horaAct: '00:00'}, proximo: '16/11 a las 23:00', tipos: ['STOCK', 'REPORTES'], ahora: '2026-11-16 14:00:00', ayer: '2026-11-15'};
  let pedidas = [];
  const orden = {id: 'A1', tipo: 'REPORTES', fecha: '2026-11-14', pedida: '2026-11-16 14:01:00', estado: 'PENDIENTE', detalle: 'Esperando al agente de la computadora',
    archivo: 'Reportes del 14/11/2026', error: '', origen: 'APP', fin: '',
    pasos: {pantalla: {e: 'PENDIENTE'}, civil: {e: 'PENDIENTE'}, stock: {e: 'PENDIENTE', d: 'stock 14.11.26.xlsx'}, productos: {e: 'PENDIENTE', d: 'productos 14.11.26.xlsx'}, movimientos: {e: 'PENDIENTE', d: 'movimientos 14.11.26.xlsx'}}};
  DATOS.agente_estado = () => base;
  DATOS.agente_crear_orden = p => { pedidas.push(p.tipo + ' ' + p.fecha); base.activa = orden; base.historial = [orden]; return base; };
  DATOS.agente_programar = p => { base.prog = {activo: p.activo === '1', hora: p.hora, horaAct: p.horaAct}; base.proximo = '16/11 a las ' + p.hora; return base; };
  await page.click('#bnav button[data-b="mas"]');
  await page.click('#mas [data-ir="agentes"]');
  await page.locator('#agestado', {hasText: 'Disponible'}).waitFor();
  assert.match(await page.locator('#agestado').innerText(), /Civil Systems abierto/);
  assert.equal(await page.inputValue('#agfecha'), '2026-11-15', 'por defecto, ayer');
  assert.equal(await page.getAttribute('#agfecha', 'max'), '2026-11-16', 'no deja elegir días que no pasaron');
  // ya viene programada a las 23:00 y ECHU actualiza a las 00:00
  assert.match(await page.locator('#agprogmsg').innerText(), /todos los días a las 23:00 baja stock, productos, movimientos, los PDF de cajas y las ofertas de ese mismo día, y ECHU los toma a las 00:00/);
  await page.fill('#agfecha', '2026-11-14');
  await page.click('#agrep');
  await page.locator('#agorden', {hasText: 'Reportes del 14/11/2026'}).waitFor();
  assert.deepEqual(pedidas, ['REPORTES 2026-11-14']);
  assert.equal(await page.locator('#agrep').isDisabled(), true, 'con una descarga en marcha no se puede pedir otra');
  assert.equal(await page.locator('#agcancelar').isVisible(), true, 'se puede cancelar desde que se pide');
  const lista = async () => (await page.locator('#agorden .agl').innerText()).replace(/\s+/g, ' ');
  const tildados = () => page.locator('#agorden .agp.ok').count();
  assert.equal(await tildados(), 0);
  // en vivo: pantalla lista, Civil en el menú, el stock generado y en Drive, productos generándose
  Object.assign(orden, {estado: 'EJECUTANDO', detalle: 'Civil esta generando PRODUCTOS', pasos: {
    pantalla: {e: 'OK', d: 'SASHA en la pantalla del servidor', h: '14:02:10'}, civil: {e: 'OK', d: 'Menu Principal', h: '14:02:40'},
    stock: {e: 'COPIADO', d: 'stock 14.11.26.xlsx', h: '14:05:30', drive: '14:05:52'}, productos: {e: 'EN_CURSO', d: '', h: '14:05:40'}, movimientos: {e: 'PENDIENTE', d: 'movimientos 14.11.26.xlsx'}}});
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'STOCK en su carpeta de Drive'}).waitFor();
  assert.equal(await page.locator('#agcancelar').isVisible(), true, 'también con la descarga en marcha');
  assert.equal(await tildados(), 3, 'pantalla, Civil y STOCK tildados');
  assert.match(await lista(), /Civil está generando PRODUCTOS/);
  assert.equal(await page.locator('#agorden .agp.curso').count(), 1);
  // movimientos sin datos (domingo) cuenta como listo; queda esperando la hora de ECHU
  Object.assign(orden, {estado: 'ESPERANDO_HORARIO', detalle: 'Los archivos ya están en Drive. ECHU actualiza solo a las 00:00 (o antes, si tocás Actualizar).'});
  Object.assign(orden.pasos, {productos: {e: 'COPIADO', d: 'productos 14.11.26.xlsx', h: '14:09:00', drive: '14:09:31'}, movimientos: {e: 'SIN_DATOS', d: '', h: '14:09:40'}, echu: {e: 'ESPERANDO', h: '00:00'}});
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'ECHU actualiza a las 00:00'}).waitFor();
  assert.equal(await tildados(), 5);
  assert.match(await lista(), /MOVIMIENTOS: no hubo movimientos ese día/);
  assert.doesNotMatch(await page.locator('#agorden').innerText(), /actualizado correctamente/);
  // mientras ECHU actualiza no se puede cancelar
  orden.estado = 'ACTUALIZANDO_ECHU';
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'ECHU está actualizando'}).waitFor();
  assert.equal(await page.locator('#agcancelar').count(), 0);
  Object.assign(orden, {estado: 'COMPLETADO', fin: '2026-11-17 00:21:00'}); orden.pasos.echu = {e: 'OK', h: '00:21:05'}; base.activa = null; base.ultima = orden;
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'actualizado correctamente'}).waitFor();
  assert.equal(await tildados(), 6, 'todo tildado');
  assert.equal(await page.locator('#agrep').isDisabled(), false);
  assert.match(await page.locator('#aghist').innerText(), /16\/11 14:01 · Reportes del 14\/11\s*Completado/);
  // un error se ve con su motivo y marca en rojo lo que no llegó
  Object.assign(orden, {estado: 'ERROR', error: 'Archivo Destino sigue abierto', fin: '2026-11-16 14:07:00'}); orden.pasos.productos = {e: 'ERROR', d: 'Archivo Destino sigue abierto', h: '14:07:00'}; delete orden.pasos.echu; base.ultima = null;
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'se detuvo'}).waitFor();
  assert.equal(await page.locator('#agorden .agp.mal').count(), 2, 'PRODUCTOS y ECHU en rojo');
  // cancelar una descarga en marcha: pide confirmación y la orden queda cancelada
  let canceladas = [];
  DATOS.agente_cancelar = p => { canceladas.push(p.id); orden.estado = 'CANCELADA'; orden.detalle = 'Cancelada desde la app: la computadora para en el próximo paso seguro (Civil queda en el Menú Principal)'; base.activa = null; return base; };
  Object.assign(orden, {estado: 'EJECUTANDO', error: '', fin: '2026-11-16 14:08:00'}); base.activa = orden;
  await page.evaluate(() => agCargar());
  await page.locator('#agcancelar').waitFor();
  page.once('dialog', d => d.dismiss());
  await page.click('#agcancelar');
  assert.deepEqual(canceladas, [], 'si no se confirma, no se cancela');
  page.once('dialog', d => d.accept());
  await page.click('#agcancelar');
  await page.locator('#agorden', {hasText: 'cancelada'}).waitFor();
  assert.deepEqual(canceladas, ['A1']);
  assert.match(await page.locator('#agorden').innerText(), /para en el próximo paso seguro/);
  assert.equal(await page.locator('#agrep').isDisabled(), false, 'se puede pedir otra');
  // horarios: se cambian los dos y se guardan
  await page.fill('#aghora', '22:15'); await page.fill('#aghoraact', '01:30'); await page.click('#agguardar');
  await page.locator('#agprogmsg', {hasText: 'todos los días a las 22:15'}).waitFor();
  assert.match(await page.locator('#agprogmsg').innerText(), /Guardado[\s\S]*ECHU los toma a las 01:30/);
  await page.click('#agprog');
  await page.locator('#agprogmsg', {hasText: 'Desactivada'}).waitFor();
  assert.equal(await page.locator('#agprog').innerText(), 'Activar');
  // v172 (ECHU 6.80): ECHU se actualiza apenas llegan los archivos: no hay hora para elegir
  base.prog = {activo: true, hora: '23:00', horaAct: 'YA'}; base.activa = orden;
  Object.assign(orden, {estado: 'ESPERANDO_HORARIO', fin: ''}); orden.pasos.echu = {e: 'ESPERANDO', h: 'YA'};
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'ECHU se actualiza en un minuto'}).waitFor();
  assert.equal(await page.locator('#aghoraact').isVisible(), false);
  assert.match(await page.locator('#agprogmsg').innerText(), /y ECHU se actualiza apenas están en Drive/);
  base.activa = null;
  await page.evaluate(() => agCargar());
  await page.click('#agvolver');
  assert.equal(await page.locator('#mas [data-ir="conta"]').isVisible(), true);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('v162: con Cajas abierta hay un solo scroll (el de Cajas): la página de afuera no se mueve y al salir vuelve a moverse', async () => {
  const {ctx, page} = await abrir();
  await page.click('#bnav button[data-b="caja"]');
  await page.waitForFunction(() => { const f = document.getElementById('cajframe'); return f && f.contentDocument && f.contentDocument.body && f.contentDocument.querySelector('#upload'); }, null, {timeout: 20000});
  await page.evaluate(() => { const d = document.getElementById('cajframe').contentDocument, x = d.createElement('div'); x.style.height = '3000px'; d.body.appendChild(x); });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cajfija')), true);
  const box = await page.locator('#cajframe').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(80); }
  const abajo = await page.evaluate(() => ({afuera: scrollY, adentro: document.getElementById('cajframe').contentWindow.scrollY}));
  assert.equal(abajo.afuera, 0, 'la página de afuera no se corre al llegar al final');
  assert.ok(abajo.adentro > 2000, 'Cajas llegó abajo');
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -500); await page.waitForTimeout(80); }
  assert.deepEqual(await page.evaluate(() => ({afuera: scrollY, adentro: document.getElementById('cajframe').contentWindow.scrollY})), {afuera: 0, adentro: 0}, 'se puede volver arriba');
  await page.click('#bnav button[data-b="inicio"]'); await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cajfija')), false, 'en el resto de la app la página se mueve normal');
  await ctx.close();
});

test('agentes v168: la lista muestra los PDF de cajas (y si fallan, ECHU igual actualiza)', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  const orden = {id: 'A2', tipo: 'REPORTES', fecha: '2026-11-14', pedida: '2026-11-16 23:00:00', estado: 'EJECUTANDO', detalle: '', archivo: 'Reportes del 14/11/2026', error: '', origen: 'PROGRAMADA', fin: '',
    pasos: {pantalla: {e: 'OK', h: '23:00:10'}, civil: {e: 'OK', h: '23:00:40'}, stock: {e: 'YA_ESTABA', d: 'stock 14.11.26.xlsx', drive: '23:00:00'}, productos: {e: 'YA_ESTABA', d: 'productos 14.11.26.xlsx', drive: '23:00:00'},
      movimientos: {e: 'YA_ESTABA', d: 'movimientos 14.11.26.xlsx', drive: '23:00:00'}, cajas: {e: 'EN_CURSO', d: 'Cierre caja 0001 vuelco 2515', h: '23:04:00'}}};
  const base = {tieneClave: true, agente: {disponible: true, hace: 5, civil: true, sesion: 'activa'}, activa: orden, ultima: null, historial: [orden],
    prog: {activo: true, hora: '23:00', horaAct: '00:00'}, proximo: '17/11 a las 23:00', tipos: ['STOCK', 'REPORTES'], ahora: '2026-11-16 23:05:00', ayer: '2026-11-15'};
  DATOS.agente_estado = () => base;
  await page.click('#bnav button[data-b="mas"]');
  await page.click('#mas [data-ir="agentes"]');
  await page.locator('#agorden', {hasText: 'Civil está generando PDF DE CAJAS'}).waitFor();
  assert.match(await page.locator('#agorden').innerText(), /Cierre caja 0001 vuelco 2515/);
  assert.equal(await page.locator('#agrep').innerText(), 'Descarga en marcha…');
  Object.assign(orden.pasos.cajas, {e: 'COPIADO', d: '6 PDF: tickets, ventas y 4 cierres', h: '23:09:00', drive: '23:09:40'});
  orden.estado = 'ESPERANDO_HORARIO';
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'PDF DE CAJAS en su carpeta de Drive'}).waitFor();
  assert.match(await page.locator('#agorden').innerText(), /6 PDF: tickets, ventas y 4 cierres/);
  orden.pasos.cajas = {e: 'ERROR', d: 'No aparecio el cuadro CAJAS en Civil', h: '23:06:00'};
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'ECHU actualiza igual'}).waitFor();
  delete orden.pasos.cajas;
  await page.evaluate(() => agCargar());
  await page.locator('#agorden', {hasText: 'ECHU actualiza a las 00:00'}).waitFor();
  assert.doesNotMatch(await page.locator('#agorden').innerText(), /PDF DE CAJAS/, 'las órdenes viejas no muestran la fila');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('v170: Cambiar precios en Civil: desde Inicio, en vivo con Detener, el PDF y el horario de/hasta', async () => {
  const antesAv = DATOS.inicio.avisos;
  DATOS.inicio.avisos = [{nivel: 'azul', titulo: '3 cambios de costo', detalle: 'El agente los carga en el sistema de ventas.', ir: 'costos'}].concat(antesAv);
  const antes = {e: DATOS.agente_estado, c: DATOS.agente_crear_orden, x: DATOS.agente_cancelar, p: DATOS.agente_costos_programar};
  try {
    const {ctx, page, errores} = await abrir();
    const base = {tieneClave: true, agente: {disponible: true, hace: 8, civil: true, sesion: 'desconectada'}, activa: null, ultima: null, historial: [],
      prog: {activo: true, hora: '23:00', horaAct: '00:00'}, proximo: '17/11 a las 23:00', tipos: ['STOCK', 'REPORTES', 'COSTOS'], ahora: '2026-11-17 14:00:00', ayer: '2026-11-16',
      costos: {pendientes: 3, revisar: 1, tildados: 0, prog: {activo: false, desde: '01:00', hasta: '09:00'}, ultimo: null}};
    const orden = {id: 'A9', tipo: 'COSTOS', fecha: '2026-11-17', pedida: '2026-11-17 14:01:00', estado: 'PENDIENTE', detalle: 'Esperando al agente de la computadora',
      archivo: '3 productos de CAMBIOS COSTOS', error: '', origen: 'APP', fin: '', pasos: {total: 3, hasta: '', ok: 0, salt: 0, err: 0, pantalla: {e: 'PENDIENTE'}, actual: {e: 'PENDIENTE'}}};
    const pedidos = [], canceladas = [];
    DATOS.agente_estado = () => base;
    DATOS.agente_crear_orden = p => { pedidos.push(p.tipo); base.activa = orden; base.historial = [orden]; return base; };
    DATOS.agente_cancelar = p => { canceladas.push(p.id); orden.pasos.detener = true; orden.detalle = 'Deteniendo'; return base; };
    DATOS.agente_costos_programar = p => { base.costos.prog = {activo: p.activo === '1', desde: p.desde, hasta: p.hasta}; return base; };
    // Inicio: el aviso de cambios de costo tiene el botón "Cambiar precios" y lleva a la tarjeta del agente
    await page.locator('#inicio [data-ir="costos"]').first().waitFor();
    assert.equal(await page.locator('#inicio button[data-ir="costos"]').first().innerText(), 'Cambiar precios');
    await page.locator('#inicio button[data-ir="costos"]').first().click();
    await page.locator('#agcosest', {hasText: 'Para cambiar: 3 productos'}).waitFor();
    assert.equal(await page.locator('#agpanel').isVisible(), true);
    assert.match(await page.locator('#agcosest').innerText(), /1 para revisar a mano/);
    assert.match(await page.locator('#agcosmsg').innerText(), /Desactivado: solo cambia cuando tocás "Cambiar costos ahora"/);
    // ahora mismo
    await page.click('#agcosya');
    await page.locator('#agcosorden', {hasText: 'Esperando a la computadora del local'}).waitFor();
    assert.deepEqual(pedidos, ['COSTOS']);
    assert.equal(await page.locator('#agcosya').isDisabled(), true);
    assert.equal(await page.locator('#agrep').isDisabled(), true, 'mientras cambia precios no se puede descargar');
    assert.equal(await page.locator('#agrep').innerText(), 'Ocupado cambiando precios…');
    // en vivo
    Object.assign(orden, {estado: 'EJECUTANDO', inicio: '2026-11-17 14:01:20'});
    Object.assign(orden.pasos, {ok: 1, salt: 1, pantalla: {e: 'OK'}, actual: {e: 'EN_CURSO', d: '3/3 56081 PANTENE AC KERATINA X 300'}});
    base.costos.pendientes = 1;
    await page.evaluate(() => agCargar());
    await page.locator('#agcosorden', {hasText: 'Van 2 de 3'}).waitFor();
    assert.match(await page.locator('#agcosorden').innerText(), /1 cambiado · 1 sin tocar/);
    assert.match(await page.locator('#agcosorden').innerText(), /56081 PANTENE AC/);
    assert.equal(await page.locator('#agcosorden .agbar i').getAttribute('style'), 'width:67%');
    // Detener (con confirmación)
    page.once('dialog', d => d.accept());
    await page.click('#agcosdet');
    await page.locator('#agcosorden', {hasText: 'Deteniendo: termina el producto'}).waitFor();
    assert.deepEqual(canceladas, ['A9']);
    assert.equal(await page.locator('#agcosdet').count(), 0);
    // v171: si no se mueve, "Destrabar" cierra la orden desde la app
    assert.equal(await page.locator('#agcosdes').isVisible(), true);
    const forzadas = [];
    DATOS.agente_cancelar = p => { forzadas.push(p.forzar); return base; };
    page.once('dialog', d => d.accept());
    await page.click('#agcosdes');
    await page.waitForFunction(() => true);
    await page.waitForTimeout(300);
    assert.deepEqual(forzadas, ['1']);
    // terminó: resumen y el PDF
    Object.assign(orden, {estado: 'COMPLETADO', fin: '2026-11-17 14:09:00', detalle: '2 cambiados, 1 sin tocar · Detenido desde la app · transferencia 7430'});
    base.activa = null;
    base.costos.ultimo = {id: 'A9', estado: 'COMPLETADO', fin: '2026-11-17 14:09:00', detalle: orden.detalle, pdf: 'https://drive.google.com/file/d/PDF/view', total: 3};
    await page.evaluate(() => agCargar());
    await page.locator('#agcosorden', {hasText: 'Última vez'}).waitFor();
    assert.match(await page.locator('#agcosorden').innerText(), /3 cambios de precios en el PDF/);
    await page.evaluate(() => { window.__abiertos = []; window.open = u => { window.__abiertos.push(u); return null; }; });
    await page.click('#agcospdf');
    assert.deepEqual(await page.evaluate(() => window.__abiertos), ['https://drive.google.com/file/d/PDF/view']);
    assert.match(await page.locator('#aghist').innerText(), /Cambios de precios[\s\S]*2 cambiados/);
    assert.equal(await page.locator('#agrep').isDisabled(), false);
    // horario automático de 1 a 9
    await page.fill('#agcosdesde', '01:30'); await page.fill('#agcoshasta', '08:45'); await page.click('#agcosguardar');
    await page.locator('#agcosmsg', {hasText: 'Activado: todos los días de 01:30 a 08:45'}).waitFor();
    assert.match(await page.locator('#agcosmsg').innerText(), /A las 08:45 termina el producto que está haciendo y para/);
    await page.click('#agcosprog');
    await page.locator('#agcosmsg', {hasText: 'Desactivado'}).waitFor();
    // con un ECHU viejo (sin "costos") la tarjeta no aparece
    delete base.costos;
    await page.evaluate(() => agCargar());
    await page.waitForFunction(() => document.getElementById('agcostos').classList.contains('oculto'));
    assert.deepEqual(errores, []);
    await ctx.close();
  } finally { DATOS.inicio.avisos = antesAv; Object.assign(DATOS, {agente_estado: antes.e, agente_crear_orden: antes.c, agente_cancelar: antes.x, agente_costos_programar: antes.p}); }
});

test('v173: elegir qué cambia el agente (subir, bajar, solo costo) y pedir solo algunos códigos', async () => {
  const antes = {e: DATOS.agente_estado, c: DATOS.agente_crear_orden, t: DATOS.agente_costos_tipos};
  try {
    const {ctx, page, errores} = await abrir();
    await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
    const base = {tieneClave: true, agente: {disponible: true, hace: 8, civil: true, sesion: 'ok'}, activa: null, ultima: null, historial: [],
      prog: {activo: true, hora: '23:00', horaAct: 'YA'}, proximo: '', tipos: [], ahora: '2026-11-17 22:30:00', ayer: '2026-11-16',
      costos: {pendientes: 150, revisar: 13, conStock: 40, tildados: 3, porTipo: {SUBIR: 120, BAJAR: 20, 'SOLO COSTO': 10}, tipos: ['SUBIR', 'BAJAR', 'SOLO COSTO'], prog: {activo: false, desde: '01:00', hasta: '09:00'}, ultimo: null}};
    const pedidos = [], tipos = [];
    DATOS.agente_estado = () => base;
    DATOS.agente_costos_tipos = p => { tipos.push(p.tipos); base.costos.tipos = p.tipos.split(','); base.costos.pendientes = 120; return base; };
    DATOS.agente_crear_orden = p => { pedidos.push([p.tipo, p.codigos]); return base; };
    await page.click('#bnav button[data-b="mas"]');
    await page.click('#mas [data-ir="agentes"]');
    await page.locator('#agcosest', {hasText: '40 bajas esperan: tienen stock'}).waitFor();
    assert.equal(await page.locator('#agcostipos label.on').count(), 3);
    assert.match(await page.locator('#agcostipos').innerText(), /Subir costo y precio\s*120[\s\S]*Bajar costo y precio\s*20[\s\S]*Solo costo\s*10/);
    await page.locator('#agcostipos input[data-t="BAJAR"]').uncheck();
    await page.locator('#agcosest', {hasText: 'Para cambiar: 120'}).waitFor();
    assert.deepEqual(tipos, ['SUBIR,SOLO COSTO']);
    assert.equal(await page.locator('#agcostipos label.on').count(), 2);
    await page.fill('#agcoscods', '56079, 15130');
    await page.click('#agcosya');
    await page.waitForFunction(() => true); await page.waitForTimeout(300);
    assert.deepEqual(pedidos, [['COSTOS', '56079, 15130']]);
    // con un ECHU anterior (sin porTipo) no se muestra la elección
    delete base.costos.porTipo;
    await page.evaluate(() => agCargar());
    await page.waitForFunction(() => document.getElementById('agcostipos').classList.contains('oculto'));
    assert.deepEqual(errores, []);
    await ctx.close();
  } finally { Object.assign(DATOS, {agente_estado: antes.e, agente_crear_orden: antes.c, agente_costos_tipos: antes.t}); }
});

test('v174: bajar solo algunos reportes; la lista muestra solo lo pedido', async () => {
  const antes = {e: DATOS.agente_estado, c: DATOS.agente_crear_orden};
  try {
    const {ctx, page, errores} = await abrir();
    await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
    const orden = {id: 'A5', tipo: 'REPORTES', fecha: '2026-11-17', pedida: '2026-11-17 22:50:00', estado: 'EJECUTANDO', detalle: '', archivo: 'productos del 17/11/2026', error: '', origen: 'COSTOS', fin: '',
      pasos: {pantalla: {e: 'OK', h: '22:50:10'}, civil: {e: 'OK', h: '22:50:40'}, stock: {e: 'NO_PEDIDO'}, productos: {e: 'EN_CURSO', d: '', h: '22:51:00'}, movimientos: {e: 'NO_PEDIDO'}, cajas: {e: 'NO_PEDIDO'}}};
    const base = {tieneClave: true, agente: {disponible: true, hace: 8, civil: true, sesion: 'ok'}, activa: null, ultima: null, historial: [],
      prog: {activo: true, hora: '23:00', horaAct: 'YA'}, proximo: '', tipos: [], ahora: '2026-11-17 22:45:00', ayer: '2026-11-16'};
    const pedidos = [];
    DATOS.agente_estado = () => base;
    DATOS.agente_crear_orden = p => { pedidos.push([p.fecha, p.solo]); base.activa = orden; return base; };
    await page.click('#bnav button[data-b="mas"]');
    await page.click('#mas [data-ir="agentes"]');
    await page.locator('#agestado', {hasText: 'Disponible'}).waitFor();
    await page.locator('#agque input[data-k="stock"]').uncheck();
    await page.locator('#agque input[data-k="movimientos"]').uncheck();
    await page.locator('#agque input[data-k="cajas"]').uncheck();
    await page.locator('#agque input[data-k="ofertas"]').uncheck();
    assert.equal(await page.locator('#agrep').innerText(), 'Descargar lo elegido');
    await page.fill('#agfecha', '2026-11-17');
    await page.click('#agrep');
    await page.locator('#agorden', {hasText: 'Productos del 17/11/2026'}).waitFor();
    assert.deepEqual(pedidos, [['2026-11-17', 'productos']]);
    const txt = await page.locator('#agorden .agl').innerText();
    assert.match(txt, /Civil está generando PRODUCTOS/);
    assert.doesNotMatch(txt, /STOCK|MOVIMIENTOS|PDF DE CAJAS/, 'lo no pedido no aparece');
    assert.deepEqual(errores, []);
    await ctx.close();
  } finally { Object.assign(DATOS, {agente_estado: antes.e, agente_crear_orden: antes.c}); }
});

test('v202: desde Gastos se paga un gasto con la fecha y el comprobante; las sumas muestran el aumento contra el mes anterior', async () => {
  const antes = {h: DATOS.pagos_historial, r: DATOS.pago_registrar, g: DATOS.gastos_datos};
  const enviados = [];
  DATOS.gastos_datos = Object.assign({}, antes.g, {filas: [{fila: 62, label: 'Agua - AySA', nivel: 0, valor: 45022, cat: 'srv', col: 2, pagable: true, pagado: false, dia: 10},
    {fila: 70, label: 'Seguridad', nivel: 0, valor: 154435, cat: 'srv', col: 0, total: true, formula: true, antes: 118418}, {fila: 71, label: 'Medina', nivel: 1, valor: 80000, cat: 'srv', col: 3}],
    categorias: [{k: 'srv', n: 'Servicios (luz, agua, internet)'}]});
  DATOS.pagos_historial = {gastos: [{label: 'Agua - AySA', monto: 45022, dia: 10, medio: 'MERCADO PAGO', pagado: false}], medios: ['EFECTIVO', 'MERCADO PAGO', 'TRANSFERENCIA', 'DÉBITO AUTOMÁTICO', 'OTRO'], pagos: []};
  DATOS.pago_registrar = p => { const d = JSON.parse(p.datos); enviados.push({d, mime: p.mime, archivo: p.archivo});
    return {gasto: d.gasto, monto: d.monto, antes: 45022, aumento: '', aplicado: false, tildado: true, comprobante: 'https://drive.google.com/file/d/PRUEBA/view', historial: DATOS.pagos_historial}; };
  const {ctx, page, errores} = await abrir();
  try {
    await irAGastos(page);
    await page.locator('#c-gas .cmp > .t', {hasText: 'Servicios'}).click();
    assert.match(await page.locator('#c-gas .cmp', {hasText: 'Servicios'}).innerText(), /Seguridad[\s\S]*\$ 154\.435\s*\+30,4%/);
    await page.click('#c-gas button:has-text("Pagar: fecha y comprobante")');
    await page.locator('#c-gas #pg_gasto').waitFor();
    assert.equal(await page.inputValue('#pg_gasto'), 'Agua - AySA');
    await page.fill('#pg_fecha', '2026-11-20');
    await page.setInputFiles('#pg_adj', {name: 'comprobante.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n')});
    await page.locator('#pg_arch', {hasText: 'comprobante.pdf'}).waitFor();
    await page.click('#pg_ok');
    await page.locator('#c-gas', {hasText: 'Listo: Agua - AySA $ 45.022 pagado.'}).waitFor();
    assert.equal(enviados.length, 1);
    assert.deepEqual([enviados[0].d.gasto, enviados[0].d.fecha, enviados[0].d.monto], ['Agua - AySA', '2026-11-20', 45022]);
    assert.equal(await page.locator('#c-gas [data-gpag]').isChecked(), true, 'queda tildado como pagado');
    assert.deepEqual(errores, []);
  } finally {
    await ctx.close();
    for (const [k, v] of [['pagos_historial', antes.h], ['pago_registrar', antes.r], ['gastos_datos', antes.g]]) { if (v === undefined) delete DATOS[k]; else DATOS[k] = v; }
  }
});

test('v169: pagar un gasto desde la app con el comprobante (foto o PDF) y anotar el aumento', async () => {
  const antes = {h: DATOS.pagos_historial, r: DATOS.pago_registrar};
  const enviados = [];
  DATOS.pagos_historial = {gastos: [{label: 'Alquiler', monto: 180000, dia: 4, medio: 'MERCADO PAGO', pagado: false}, {label: 'Internet', monto: 58500, dia: 7, medio: 'MIXTO', pagado: false}],
    medios: ['EFECTIVO', 'MERCADO PAGO', 'TRANSFERENCIA', 'DÉBITO AUTOMÁTICO', 'OTRO'], pagos: []};
  DATOS.pago_registrar = p => { const d = JSON.parse(p.datos); enviados.push({d, mime: p.mime, archivo: p.archivo});
    DATOS.pagos_historial.pagos.unshift({fecha: d.fecha, gasto: d.gasto, monto: d.monto, medio: d.medio, antes: 180000, aumento: '+10% (es el importe nuevo)', vencia: '', comprobante: 'https://drive.google.com/file/d/PRUEBA/view', nota: ''});
    return {gasto: d.gasto, monto: d.monto, antes: 180000, aumento: '+10%', aplicado: d.importeNuevo, tildado: true, comprobante: 'https://drive.google.com/file/d/PRUEBA/view',
      historial: {gastos: DATOS.pagos_historial.gastos, pagos: [{fecha: d.fecha, gasto: d.gasto, monto: d.monto, medio: d.medio, antes: 180000, aumento: '+10% (es el importe nuevo)', vencia: '', comprobante: 'https://drive.google.com/file/d/PRUEBA/view', nota: ''}]}}; };
  const {ctx, page, errores} = await abrir();
  try {
    await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
    await page.click('#inicio .iav button[data-ir="pagos"]');
    await page.click('#caja-plata [data-pagar="Alquiler"]');
    await page.locator('#pg_gasto').waitFor();
    assert.equal(await page.inputValue('#pg_gasto'), 'Alquiler');
    assert.equal(await page.inputValue('#pg_medio'), 'MERCADO PAGO');
    assert.match(await page.inputValue('#pg_monto'), /180\.000/);
    assert.equal(await page.locator('#pg_nuevo_lbl').isVisible(), false, 'mismo importe: no pregunta por el aumento');
    await page.fill('#pg_monto', '$ 198.000');
    await page.locator('#pg_dif', {hasText: 'aumentó 10%'}).waitFor();
    assert.equal(await page.locator('#pg_nuevo_lbl').isVisible(), true);
    await page.setInputFiles('#pg_adj', {name: 'comprobante.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n')});
    await page.locator('#pg_arch', {hasText: 'comprobante.pdf'}).waitFor();
    await page.click('#pg_ok');
    await page.locator('#pgform', {hasText: 'Listo: Alquiler $ 198.000 pagado.'}).waitFor();
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].d.gasto, 'Alquiler'); assert.equal(enviados[0].d.monto, 198000); assert.equal(enviados[0].d.medio, 'MERCADO PAGO');
    assert.equal(enviados[0].d.importeNuevo, true); assert.equal(enviados[0].mime, 'application/pdf'); assert.match(enviados[0].archivo, /^data:application\/pdf;base64,/);
    assert.match(await page.locator('#pgform').innerText(), /quedó como el importe nuevo[\s\S]*Ver el comprobante en Drive/);
    await page.click('#pg_ver');
    await page.locator('#pghist', {hasText: 'Alquiler'}).waitFor();
    assert.match(await page.locator('#pghist').innerText(), /\$ 198\.000[\s\S]*comprobante/);
    assert.deepEqual(errores, []);
  } finally {
    await ctx.close();
    for (const [k, v] of [['pagos_historial', antes.h], ['pago_registrar', antes.r]]) { if (v === undefined) delete DATOS[k]; else DATOS[k] = v; }
  }
});
