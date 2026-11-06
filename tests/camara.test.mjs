// v121: "Sacar foto" abre la cámara adentro de la app (sin abrir la app de cámara del celular, que con poca memoria cierra Sasha).
import test from 'node:test'; import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
import {servir} from './servidor-estatico.mjs';
import {crearECHU, URL_ECHU, TOKEN} from './echu-falso.mjs';
let b, web;
test.before(async () => { b = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']}); web = await servir(); });
test.after(async () => { await b?.close(); web?.cerrar(); });
async function abrir(permiso = true) {
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block', permissions: permiso ? ['camera'] : []});
  const echu = crearECHU(); await ctx.route(URL_ECHU + '**', r => echu.manejar(r));
  await ctx.addInitScript(([u, t]) => { localStorage.setItem('echu_url', u); localStorage.setItem('echu_token', t); }, [URL_ECHU, TOKEN]);
  const page = await ctx.newPage(); const errores = []; page.on('pageerror', e => errores.push(e.message));
  await page.goto(web.url);
  await page.evaluate(() => { const l = document.createElement('label'); l.id = 'lab'; l.textContent = 'Sacar foto'; l.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff;padding:20px';
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'environment'); i.hidden = true; l.appendChild(i); document.body.appendChild(l);
    window.__llego = null; i.addEventListener('change', () => { const f = i.files[0]; window.__llego = f ? {nombre: f.name, tipo: f.type, bytes: f.size} : 'vacio'; }); });
  return {ctx, page, errores};
}
test('Sacar foto: la cámara se abre en la app y la foto llega al mismo campo (JPG)', async () => {
  const {ctx, page, errores} = await abrir();
  await page.click('#lab');
  await page.locator('[data-camara-sasha]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-camara-sasha] button[aria-label="Sacar foto"]').disabled, null, {timeout: 8000});
  await page.click('[data-camara-sasha] button[aria-label="Sacar foto"]');
  await page.waitForFunction(() => window.__llego);
  const f = await page.evaluate(() => window.__llego);
  assert.equal(f.tipo, 'image/jpeg'); assert.match(f.nombre, /^foto-\d+\.jpg$/); assert.ok(f.bytes > 1000);
  assert.equal(await page.locator('[data-camara-sasha]').count(), 0, 'se cierra sola');
  assert.deepEqual(errores, []);
  await ctx.close();
});
test('Sacar foto: Cancelar cierra sin mandar nada; "Cámara del celular" abre la de siempre', async () => {
  const {ctx, page} = await abrir();
  await page.click('#lab'); await page.locator('[data-camara-sasha]').waitFor();
  await page.click('[data-camara-sasha] button:has-text("Cancelar")');
  assert.equal(await page.locator('[data-camara-sasha]').count(), 0); assert.equal(await page.evaluate(() => window.__llego), null);
  await page.click('#lab'); await page.locator('[data-camara-sasha]').waitFor();
  const [fc] = await Promise.all([page.waitForEvent('filechooser', {timeout: 5000}), page.click('[data-camara-sasha] button:has-text("Cámara del celular")')]);
  assert.ok(fc);
  await ctx.close();
});
test('Sin permiso de cámara: avisa y deja usar la cámara del celular', async () => {
  const ctx = await b.newContext({serviceWorkers: 'block'});
  const page = await ctx.newPage();
  await page.goto(web.url);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('NotAllowedError'));
    const i = document.createElement('input'); i.id = 'cam'; i.style.cssText = 'position:fixed;top:0;left:0;z-index:99999'; i.type = 'file'; i.setAttribute('capture', 'environment'); document.body.appendChild(i); });
  await page.click('#cam');
  await page.waitForFunction(() => /No se pudo abrir la cámara/.test((document.querySelector('[data-camara-sasha]') || {}).textContent || ''));
  const [fc] = await Promise.all([page.waitForEvent('filechooser', {timeout: 5000}), page.click('[data-camara-sasha] button:has-text("Cámara del celular")')]);
  assert.ok(fc);
  await ctx.close();
});
