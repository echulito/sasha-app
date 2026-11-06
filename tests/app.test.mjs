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
test('gastos › inflación: muestra qué pasó en el mes, los meses anteriores y se guarda la inflación', async () => {
  const {ctx, page, echu, errores} = await abrir();
  await irAGastos(page);
  await page.getByText('Inflación de octubre').waitFor();
  assert.match(await page.locator('#c-gas').innerText(), /Tus precios de venta\s*\+3,1%\s*▲ 0,4 sobre la inflación/);
  assert.match(await page.locator('#c-gas').innerText(), /Ventas sin inflación\s*−2,0%/);
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

test('versión de consulta: es la misma app (Resumen, Productos y Simular) sin Administración ni Ajustes', async () => {
  const {ctx, page, echu, errores} = await abrir({consulta: true, ruta: '?consulta'});
  await page.getByText('Este mes · noviembre').waitFor({state: 'attached'});
  assert.equal(await page.evaluate(() => document.body.classList.contains('consulta')), true);
  const visibles = await page.$$eval('#bnav button', bs => bs.filter(b => b.offsetParent).map(b => b.dataset.b));
  assert.deepEqual(visibles, ['resumen', 'productos']);
  for (const t of visibles) { await page.click('#bnav button[data-b="' + t + '"]'); await page.waitForTimeout(300); }
  await page.click('#productos .bcomp button[data-t="simulador"]'); await page.waitForTimeout(300);
  // Con el PIN de consulta no se pide el Inicio (muestra plata y cajas).
  assert.ok(!echu.pedidos.some(p => /"accion":"inicio"|accion=inicio/.test((p.cuerpo || '') + p.url)));
  assert.ok(echu.pedidos.every(p => p.metodo !== 'POST' || /[?&]h=/.test(p.url)));
  assert.deepEqual(errores, []);
  await ctx.close();
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
  assert.match(await page.locator('#caja-plata').innerText(), /Libre para mercadería\s*\$ 412\.000[\s\S]*Alquiler · 04\/11\s*\$ 180\.000/);
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
  assert.match(await page.locator('#slista .cmp').nth(1).innerText(), /sin liquidar/); assert.match(t, /Dueño Uno \(dueño\)\s*\$ 1\.000\.000/); assert.match(t, /Total sueldos\s*\$ 2\.850\.000/);
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
  await page.locator('#sp_msg .pos').waitFor();
  assert.match(await page.locator('#sp_msg').innerText(), /1 recibo\/factura y 2 recibos de efectivo/);
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
  await page.selectOption('#se_ptipo', 'monotributo'); await page.selectOption('#se_pmed', 'efectivo'); await page.fill('#se_pneto', '1.200.000');
  await page.click('#se_ok'); await page.waitForTimeout(400);
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
    const png = await page.screenshot({fullPage: true, mask: [page.locator('#verapp')], animations: 'disabled'});
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
