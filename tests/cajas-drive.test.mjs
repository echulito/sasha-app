// v167: los PDF que el agente dejó en Drive (CAJAS PDF / dd.mm.aa) se importan solos al abrir Cajeras (datos inventados).
import test from 'node:test'; import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const {PDFDocument, StandardFonts} = require('../pdf-lib.min.js');
import {servir} from './servidor-estatico.mjs';
import {crearECHU, URL_ECHU, TOKEN, DATOS} from './echu-falso.mjs';

async function pdfDeLineas(lineas) {
  const doc = await PDFDocument.create(), page = doc.addPage([800, 600]), font = await doc.embedFont(StandardFonts.Helvetica);
  lineas.forEach((l, i) => page.drawText(l, {x: 30, y: 560 - i * 20, size: 10, font}));
  return Buffer.from(await doc.save()).toString('base64');
}

test('al abrir Cajeras se importan solos los PDF nuevos de Drive; el que no se puede leer avisa y no se vuelve a ofrecer', async () => {
  const planilla = await pdfDeLineas([
    'Planilla de Caja', 'Fecha: 16/10/2026 Sucursal: 01', 'Concepto Caja 0001 Caja 0003 Total',
    'INICIO Efectivo $ 1.000,00 0,00 1.000,00', 'TOTAL VENTA (Pesificado) 5.000,00 0,00 5.000,00',
    'TOTAL SALIDAS Efectivo $ 0,00 0,00 0,00', 'DECLARADO Efectivo $ 3.000,00 0,00 3.000,00', 'DECLARADO Cupones 3.000,00 0,00 3.000,00']);
  const otro = await pdfDeLineas(['Un PDF que no es de Civil']);
  const hechos = [], antes = {e: DATOS.cajas_estado, n: DATOS.cajas_pdf_nuevos, b: DATOS.cajas_pdf_bajar, h: DATOS.cajas_pdf_hechos};
  DATOS.cajas_estado = {state: {reports: [], manual: []}, revision: 1, sheetUrl: ''};
  DATOS.cajas_pdf_nuevos = {archivos: [{id: 'PDF_PLANILLA_1', nombre: 'planilla de caja.pdf', fecha: '2026-10-16', tam: 9000}, {id: 'PDF_OTRO_0002', nombre: 'otro.pdf', fecha: '2026-10-16', tam: 9000}]};
  DATOS.cajas_pdf_bajar = p => ({id: p.id, nombre: 'x.pdf', data: p.id === 'PDF_PLANILLA_1' ? planilla : otro});
  DATOS.cajas_pdf_hechos = p => { hechos.push(...JSON.parse(p.datos)); return {hechos: 2}; };
  const b = await chromium.launch(), web = await servir();
  try {
    const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires'});
    const echu = crearECHU(); await ctx.route(URL_ECHU + '**', r => echu.manejar(r));
    await ctx.addInitScript(([u, t]) => { localStorage.setItem('echu_url', u); localStorage.setItem('echu_token', t); }, [URL_ECHU, TOKEN]);
    const page = await ctx.newPage(); const errores = []; page.on('pageerror', e => errores.push(e.message));
    await page.goto(web.url + 'cajas/index.html');
    await page.waitForFunction(() => /otro\.pdf/.test(document.getElementById('message')?.textContent || ''), null, {timeout: 20000});
    const guardados = echu.pedidos.filter(p => /"accion":"cajas_guardar"/.test(p.cuerpo || '')).map(p => JSON.parse(JSON.parse(p.cuerpo).datos));
    assert.ok(guardados.some(g => g.state.reports.some(r => r.type === 'close' && r.date === '2026-10-16' && r.filename === 'planilla de caja.pdf' && r.rows[0].sales === 500000)), 'la planilla quedó importada y guardada');
    assert.deepEqual(hechos.sort(), ['PDF_OTRO_0002', 'PDF_PLANILLA_1'], 'los dos quedan tomados (el que no se pudo leer no se reintenta)');
    assert.match(await page.locator('#message').innerText(), /otro\.pdf: /);
    assert.deepEqual(errores, []);
  } finally {
    await b.close(); web.cerrar();
    DATOS.cajas_estado = antes.e; for (const [k, v] of [['cajas_pdf_nuevos', antes.n], ['cajas_pdf_bajar', antes.b], ['cajas_pdf_hechos', antes.h]]) { if (v === undefined) delete DATOS[k]; else DATOS[k] = v; }
  }
});

test('v180: un PDF ya tomado que no quedó cargado (el lector no podía) se vuelve a probar una vez con el lector nuevo', async () => {
  const cierre = await pdfDeLineas(['*** C I E R R E D E C A J A ***', 'Vuelco: 2522 - Jueves', 'Sucursal: GON-1970 Caja: 0001', 'Cajero/a: VANESA',
    'Fecha Cierre: 19/11/2026 15:30', 'Apertura: 19/11/2026 09:41', 'Tickets: 00122718 al 00122732', 'Cantidad de Operaciones: 15',
    'Saldo Inicial Efectivo $ 58840.00', 'Saldo Inicial [TC=1.00] 58840.00', 'Ing. x Venta Efectivo $ 0.01', 'Ing. x Venta M PAGO OFFLI 148762.50',
    'Ing. x Venta CUPONES 21220.00', 'Ing. x Venta [TC=1.00] 169982.51', 'Movimientos Efectivo $ 0.00', 'Saldo Final Efectivo $ 58840.01',
    'Saldo Final M PAGO OFFLI 148762.50', 'Saldo Final CUPONES 21220.00', 'Saldo Final [TC=1.00] 228822.51', 'TOTAL Declarado Efectivo $ 58840.00',
    'TOTAL Declarado M PAGO OFF 148762.50', 'T0TAL Declarado CUPONES 21160.00', 'T0TAL Declarado [TC=1.00] 228762.50', 'Diferencia Efectivo $ 0.01',
    'Diferencia M PAGO OFFLINE 0.00', 'Diferencia CUPONES 60.00', 'Diferencia [TC=1.00] 60.01', 'RETIRO EFECTIVO X CIERRE -58840.00']);
  const bajados = [], hechos = [], antes = {e: DATOS.cajas_estado, n: DATOS.cajas_pdf_nuevos, b: DATOS.cajas_pdf_bajar, h: DATOS.cajas_pdf_hechos};
  DATOS.cajas_estado = {state: {reports: [], manual: []}, revision: 1, sheetUrl: ''};
  DATOS.cajas_pdf_nuevos = {archivos: [{id: 'PDF_CIERRE_2522', nombre: 'cierre caja 0001 vuelco 2522 19.11.26.pdf', fecha: '2026-11-19', tam: 3409, hecho: 1}]};
  DATOS.cajas_pdf_bajar = p => { bajados.push(p.id); return {id: p.id, nombre: 'x.pdf', data: cierre}; };
  DATOS.cajas_pdf_hechos = p => { hechos.push(...JSON.parse(p.datos)); return {hechos: 1}; };
  const b = await chromium.launch(), web = await servir();
  try {
    const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires'});
    const echu = crearECHU(); await ctx.route(URL_ECHU + '**', r => echu.manejar(r));
    await ctx.addInitScript(([u, t]) => { localStorage.setItem('echu_url', u); localStorage.setItem('echu_token', t); }, [URL_ECHU, TOKEN]);
    const page = await ctx.newPage(); const errores = []; page.on('pageerror', e => errores.push(e.message));
    await page.goto(web.url + 'cajas/index.html');
    await page.waitForFunction(() => /importado de Drive/.test(document.getElementById('message')?.textContent || ''), null, {timeout: 20000});
    assert.ok(echu.pedidos.some(p => /cajas_pdf_nuevos/.test(p.url + (p.cuerpo || '')) && /todos/.test(p.url + (p.cuerpo || ''))), 'pide también los ya tomados');
    // El aviso puede salir antes de que llegue el guardado a ECHU: se espera hasta 10 s.
    const cargado = () => echu.pedidos.filter(p => /"accion":"cajas_guardar"/.test(p.cuerpo || '')).map(p => JSON.parse(JSON.parse(p.cuerpo).datos))
      .some(g => g.state.reports.some(r => r.type === 'turnClose' && r.rows[0].batch === '2522' && r.rows[0].remainder === 0));
    for (let i = 0; i < 100 && !cargado(); i++) await page.waitForTimeout(100);
    assert.ok(cargado(), 'el cierre sin "Resto en Caja" quedó cargado');
    assert.deepEqual(hechos, [], 'ya estaba tomado: no se vuelve a marcar');
    assert.deepEqual(bajados, ['PDF_CIERRE_2522']);
    assert.deepEqual(errores, []);
  } finally {
    await b.close(); web.cerrar();
    DATOS.cajas_estado = antes.e; for (const [k, v] of [['cajas_pdf_nuevos', antes.n], ['cajas_pdf_bajar', antes.b], ['cajas_pdf_hechos', antes.h]]) { if (v === undefined) delete DATOS[k]; else DATOS[k] = v; }
  }
});
