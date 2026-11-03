// Pruebas de la app Sasha (unitarias de la conexión + regresión de pantallas).
// Correr: node --test tests/      ·  Aprobar capturas nuevas a propósito: ACTUALIZAR=1 node --test tests/
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
import {servir} from './servidor-estatico.mjs';
import {crearECHU, URL_ECHU, TOKEN, PIN, huella} from './echu-falso.mjs';

const DIR = new URL('.', import.meta.url).pathname, CAPT = DIR + 'capturas/';
const ACTUALIZAR = process.env.ACTUALIZAR === '1';
// Las capturas dependen de las letras instaladas: en GitHub (CI) se comparan solo si se pide.
const CON_CAPTURAS = !process.env.CI || process.env.CAPTURAS === '1';
let navegador, web;
test.before(async () => { navegador = await chromium.launch(); web = await servir(); });
test.after(async () => { await navegador?.close(); web?.cerrar(); });

async function abrir({modo = 'normal', logueado = true, ruta = ''} = {}) {
  const ctx = await navegador.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires'});
  const echu = crearECHU(modo);
  await ctx.route(URL_ECHU + '**', r => echu.manejar(r));
  await ctx.addInitScript(([u, t]) => { try { localStorage.setItem('echu_url', u); if (t) localStorage.setItem('echu_token', t); } catch (e) {} }, [URL_ECHU, logueado ? TOKEN : '']);
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
  await page.getByText('Este mes').first().waitFor();
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
  await page.getByText('Este mes').first().waitFor();
  const posts = echu.pedidos.filter(p => p.metodo === 'POST');
  assert.ok(posts.length > 0);
  for (const p of posts) assert.equal(new URL(p.url).searchParams.get('h'), huella(p.cuerpo));
  await ctx.close();
});

test('resumen: muestra los datos y avisa "Llegó completo" arriba (3 segundos)', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor();
  await assert.doesNotReject(page.locator('#avisoSub', {hasText: 'Llegó completo'}).waitFor({state: 'visible', timeout: 3000}));
  await page.waitForTimeout(3300);
  assert.equal(await page.locator('#avisoSub').isVisible(), false);
  assert.match(await page.locator('#sub').innerText(), /Datos del 02\/11\/2026/);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('si la respuesta no coincide con su huella, la app NO usa esos datos', async () => {
  const {ctx, page} = await abrir({modo: 'corrupto'});
  await page.locator('#resumen', {hasText: 'llegó incompleta'}).waitFor({timeout: 15000});
  assert.equal(await page.getByText('Este mes · noviembre').count(), 0);
  await ctx.close();
});

test('con ECHU sin actualizar (versión anterior) la app sigue andando', async () => {
  const {ctx, page, errores} = await abrir({modo: 'viejo'});
  await page.getByText('Este mes · noviembre').waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('con ECHU sin actualizar también se puede entrar con el PIN', async () => {
  const {ctx, page, errores} = await abrir({modo: 'viejo', logueado: false});
  await page.fill('#lpin', PIN); await page.click('#lbtn');
  await page.getByText('Este mes · noviembre').waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('guardar: el botón se pone verde "✓ … en ECHU · Llegó completo" y vuelve solo (modelo C)', async () => {
  const {ctx, page, errores} = await abrir();
  await page.getByText('Este mes · noviembre').waitFor();
  await page.click('nav button[data-tab="ajustes"]');
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
  await page.getByText('Este mes · noviembre').waitFor();
  await page.click('nav button[data-tab="admin"]'); await page.click('#admsec button[data-s="conta"]'); await page.click('#csub button[data-s="gas"]');
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
  await page.getByText('Este mes · noviembre').waitFor();
  for (const t of ['productos', 'simulador', 'admin', 'ajustes', 'resumen']) { await page.click('nav button[data-tab="' + t + '"]'); await page.waitForTimeout(400); }
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
  await page.getByText('Este mes · noviembre').waitFor();
  await page.waitForTimeout(3300); // que se vaya el aviso
  const cambios = [];
  for (const t of ['resumen', 'productos', 'simulador', 'admin', 'ajustes']) {
    await page.click('nav button[data-tab="' + t + '"]'); await page.waitForTimeout(600);
    await page.locator('#avisoSub').waitFor({state: 'hidden', timeout: 6000}); // el aviso lleva la hora: se espera a que se vaya
    const png = await page.screenshot({fullPage: true, mask: [page.locator('#verapp')], animations: 'disabled'});
    const ruta = CAPT + t + '.png';
    if (ACTUALIZAR || !fs.existsSync(ruta)) { fs.writeFileSync(ruta, png); continue; }
    const d = await diferencia(page, fs.readFileSync(ruta), png);
    if (d > 0.002) { fs.writeFileSync(CAPT + t + '.NUEVA.png', png); cambios.push(t + ' (' + (d * 100).toFixed(2) + '% distinto)'); }
  }
  // Administración › Contabilidad › Gastos (con la inflación)
  await page.click('nav button[data-tab="admin"]'); await page.click('#admsec button[data-s="conta"]'); await page.click('#csub button[data-s="gas"]');
  await page.locator('#c-gas .cmp').first().waitFor(); await page.locator('#avisoSub').waitFor({state: 'hidden', timeout: 6000});
  {
    const png = await page.screenshot({fullPage: true, mask: [page.locator('#verapp')], animations: 'disabled'}), ruta = CAPT + 'gastos.png';
    if (ACTUALIZAR || !fs.existsSync(ruta)) fs.writeFileSync(ruta, png);
    else { const d = await diferencia(page, fs.readFileSync(ruta), png); if (d > 0.002) { fs.writeFileSync(CAPT + 'gastos.NUEVA.png', png); cambios.push('gastos (' + (d * 100).toFixed(2) + '% distinto)'); } }
  }
  await ctx.close();
  assert.deepEqual(cambios, [], 'Cambió cómo se ve: ' + cambios.join(', ') + '. Mirá tests/capturas/*.NUEVA.png');
});
