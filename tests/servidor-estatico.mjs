// Sirve la app desde la carpeta del repositorio (para las pruebas).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const TIPOS = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'};
export function servir() {
  return new Promise(ok => {
    const srv = http.createServer((q, s) => {
      let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(RAIZ, p);
      if (!f.startsWith(RAIZ)) { s.statusCode = 403; return s.end(); }
      fs.readFile(f, (e, d) => { if (e) { s.statusCode = 404; return s.end('no'); } s.setHeader('content-type', TIPOS[path.extname(f)] || 'application/octet-stream'); s.end(d); });
    }).listen(0, '127.0.0.1', () => ok({url: 'http://127.0.0.1:' + srv.address().port + '/', cerrar: () => srv.close()}));
  });
}
