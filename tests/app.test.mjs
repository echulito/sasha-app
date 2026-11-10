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
  DATOS.gastos_factura_leer = () => ({ok: true, sugerido: 'Luz', comprobante: {tipo: 'factura', letra: 'B', nombre: 'EDENOR SA', cuit: '30655116202', total: 207000, vencimiento: '2026-11-18', periodoFacturado: 'Octubre 2026'},
    gastos: [{label: 'Alquiler', valor: 1500000}, {label: 'Luz', valor: 180000}]});
  DATOS.gastos_factura_guardar = p => { const d = JSON.parse(p.datos); return {gasto: d.gasto, antes: 180000, monto: d.monto, vence: d.vence, comprobante: d.iva ? {id: 'C1'} : null, gastos: DATOS.gastos_datos}; };
  const {ctx, page, errores, echu} = await abrir();
  await page.click('#bnav button[data-b="mas"]'); await page.click('#mas [data-ir="conta"]'); await page.click('#csub button[data-s="gas"]');
  await page.locator('#c-gas .cmp').first().waitFor();
  await page.setInputFiles('#gfadj', {name: 'factura.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ' + 'x'.repeat(300))});
  await page.locator('#gf_gasto').waitFor();
  assert.equal(await page.inputValue('#gf_gasto'), 'Luz'); assert.equal(await page.inputValue('#gf_vence'), '2026-11-18');
  assert.match(await page.locator('#gf_dif').innerText(), /Tenías \$ 180\.000 → pasa a \$ 207\.000 \(\+15,0%\)\. Se aplica en el mes\./);
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
    dni: [{hora: '18:06:50', importe: 10100, estado: 'Aprobado', ok: true, operacion: '510919548', pagador: 'Persona Prueba', autorizacion: 'ABC123'}], dniAviso: 'Los de Cuenta DNI aparecen cuando llega el mail de Redlink (puede tardar unos minutos).'};
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
    camino: ['105'], pend: {}};
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await page.click('#tabs [data-tab="buscar"]');
  await page.waitForFunction(() => document.querySelector('#q') && true); await page.waitForTimeout(900);
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
