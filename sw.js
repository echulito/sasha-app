// Sasha · Mi negocio - guarda solo la "cáscara" de la app (los datos siempre se piden en vivo a ECHU).
const CACHE = 'sasha-v124';
// v118: archivos que llegan con "Compartir › Sasha" (WhatsApp, Gmail, Archivos). Quedan acá hasta que la app los sube.
const COMPARTIDOS = 'sasha-compartidos';
const ARCHIVOS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './pdf-lib.min.js', './camara.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== COMPARTIDOS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // ECHU (datos): siempre en vivo
  if (e.request.method === 'POST' && url.searchParams.has('compartir')) { e.respondWith(recibirCompartidos(e.request)); return; }
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copia = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});

async function recibirCompartidos(req) {
  try {
    const fd = await req.formData();
    const c = await caches.open(COMPARTIDOS);
    const archivos = fd.getAll('archivos').filter(f => f && typeof f !== 'string');
    await Promise.all(archivos.map((f, i) => c.put(new Request('./compartido/' + Date.now() + '-' + i),
      new Response(f, {headers: {'Content-Type': f.type || 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name || 'archivo')}}))));
  } catch (err) { /* si no se pudo leer, la app abre igual */ }
  return Response.redirect(new URL('./?compartido=1', self.registration.scope).href, 303);
}
