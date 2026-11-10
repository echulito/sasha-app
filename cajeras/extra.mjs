// Sasha v141: además de declarar, las cajeras tienen "Buscar" (productos: nombre, si está pedido y precio; pueden pedir)
// y "Cobros" (Mercado Pago y Cuenta DNI del día: importe, estado y número de operación; sin comisiones).
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const pesos = n => '$ ' + new Intl.NumberFormat('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 2}).format(Number(n) || 0);
const hoyAR = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

async function huella(t) { try { const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); } catch { return ''; } }
async function api(accion, extra) {
  let url = ''; try { url = localStorage.getItem('sashaCajerasEchu') || ''; } catch {}
  const token = sessionStorage.getItem('sashaTeamSession');
  if (!url || !token) throw Error('Ingresá con tu usuario.');
  const cuerpo = JSON.stringify(Object.assign({accion, sesion: token}, extra || {})), h = await huella(cuerpo);
  let r; try { r = await fetch(url + (h ? (url.includes('?') ? '&' : '?') + 'h=' + h : ''), {method: 'POST', redirect: 'follow', cache: 'no-store', body: cuerpo}); } catch { throw Error('Sin conexión. Probá de nuevo.'); }
  let d; try { d = await r.json(); } catch { throw Error('El servidor no respondió. Probá de nuevo.'); }
  if (!d.ok) throw Error(d.mensaje || 'No se pudo.');
  return d.datos;
}

// ---------- solapas ----------
let tab = 'declarar';
function elegir(t) {
  tab = t; document.body.dataset.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('tabBuscar').hidden = t !== 'buscar'; $('tabCobros').hidden = t !== 'cobros';
  if (t === 'buscar') { setTimeout(() => $('q').focus(), 50); bajarCatalogo(); }
  if (t === 'cobros') cobros();
}
$('tabs').onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) elegir(b.dataset.tab); };
// Las solapas aparecen cuando la cajera entró (el botón "Cerrar sesión" queda a la vista).
const mirar = () => { const adentro = !$('logout').hidden; $('tabs').hidden = !adentro; if (adentro) setTimeout(() => bajarCatalogo(), 300); if (!adentro && tab !== 'declarar') elegir('declarar'); };
new MutationObserver(mirar).observe($('logout'), {attributes: true, attributeFilter: ['hidden']}); mirar();

// ---------- Buscar ----------
let personas = null, yo = '', espera = 0, ultima = '';
async function cargarPersonas() { if (personas) return; try { const r = await api('cajera_personas'); personas = r.personas || []; yo = r.yo || ''; } catch { personas = []; } }
const CHIP = {pedido: 'chip verde', pedido_cajera: 'chip azul', no: 'chip gris'};
function formPedido(id, producto) {
  const ops = (personas || []).map(p => '<option' + (p === yo ? ' selected' : '') + '>' + esc(p) + '</option>').join('');
  return '<div class="pedir" data-form="' + esc(id) + '">' + (producto === null ? '<label>¿Qué producto falta?<input data-texto maxlength="120" placeholder="Ej.: Tintura 919 7.42"></label>' : '') +
    '<div class="dos"><label>¿Quién lo pide?<select data-pidio><option value="">Elegí…</option>' + ops + '</select></label><label>Cantidad sugerida<input data-cant type="number" min="1" max="9999" inputmode="numeric" value="1"></label></div>' +
    '<button class="primary" data-enviar>Enviar pedido</button><small data-msg></small></div>';
}
function pintarResultados(r) {
  const L = r.productos || [];
  // v143: con código interno y stock actual
  const stock = p => p.stock == null ? '' : ' · ' + (p.stock > 0 ? 'Stock ' + new Intl.NumberFormat('es-AR').format(p.stock) : '<b class="sin">Sin stock</b>');
  $('resultados').innerHTML = (L.length ? L.map(p => '<div class="prod" data-cod="' + esc(p.codigo) + '"><div class="fila"><b>' + esc(p.producto) + '</b><span class="precio">' + pesos(p.precio) + '</span></div>' +
      '<div class="cod">Cód. ' + esc(p.codigo) + stock(p) + '</div>' +
      '<div class="fila"><span class="' + (CHIP[p.estado] || 'chip gris') + '" data-chip>' + esc(p.estadoTexto) + '</span>' + (p.estado === 'no' ? '<button class="mini" data-pedir>Pedir</button>' : '') + '</div></div>').join('')
    : '<p class="vacio">No encontré nada con eso.</p>') + (r.mas ? '<small>Hay más resultados: escribí algo más preciso.</small>' : '') +
    '<button class="link" data-libre>¿No lo encontrás? Pedilo igual</button><div id="libre"></div>';
}
// v147: el catálogo se baja una vez (y se renueva cada 5 minutos) y la búsqueda se hace en el celular: sale al instante.
let CAT = null, CAMINO = new Set(), PEND = {}, catCuando = 0, bajando = false;
const norm = t => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normCod = t => String(t == null ? '' : t).trim().replace(/\s+/g, '');
async function bajarCatalogo() {
  if (bajando || (CAT && Date.now() - catCuando < 300000)) return;
  bajando = true;
  try { const r = await api('cajera_catalogo'); if (r && Array.isArray(r.cat) && r.cat.length) { CAT = r.cat; CAMINO = new Set((r.camino || []).map(normCod)); PEND = r.pend || {}; catCuando = Date.now();
      if (tab === 'buscar' && $('q').value.trim().length >= 2 && !document.querySelector('#resultados [data-form]')) buscar($('q').value); } }
  catch { /* ECHU viejo o sin conexión: se busca en ECHU como antes */ }
  finally { bajando = false; }
}
function estadoLocal(cod) {
  const k = normCod(cod), p = PEND[k] || PEND[cod], comprado = CAMINO.has(k) || (p && p.estado === 'pedido');
  return {estado: comprado ? 'pedido' : p ? 'pedido_cajera' : 'no', estadoTexto: comprado ? '✓ Pedido' : p ? '✓ Pedido por cajeras (' + p.quien + ', ' + p.fecha + ')' : 'No está pedido'};
}
function buscarLocal(q) {
  const n = norm(q), palabras = n.split(' ').filter(Boolean), qd = n.replace(/\s/g, ''), exactos = [], res = [];
  for (const r of CAT) {
    if (norm(r[0]) === qd || (r[3] && r[3] === qd)) exactos.push(r);
    else if (palabras.every(w => r[4].indexOf(w) >= 0)) res.push(r);
  }
  res.sort((a, b) => a[1].localeCompare(b[1]));
  return {productos: exactos.concat(res).slice(0, 40).map(r => Object.assign({codigo: r[0], producto: r[1], precio: r[2], stock: r[5]}, estadoLocal(r[0]))), mas: exactos.length + res.length > 40};
}
async function buscar(q) {
  q = q.trim(); if (q.length < 2) { $('resultados').innerHTML = ''; return; }
  if (CAT) { ultima = q; pintarResultados(buscarLocal(q)); $('buscando').textContent = ''; refrescarEstados(); bajarCatalogo(); return; }
  bajarCatalogo();
  ultima = q; $('buscando').textContent = 'Buscando…';
  try { const r = await api('cajera_buscar', {q}); if (q !== ultima) return; pintarResultados(r); $('buscando').textContent = ''; }
  catch (e) { if (q === ultima) $('buscando').textContent = e.message; }
}
$('q').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => buscar($('q').value), CAT ? 80 : 450); });
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(espera); buscar($('q').value); } });
$('resultados').addEventListener('click', async e => {
  const card = e.target.closest('.prod');
  if (e.target.matches('[data-pedir]') && card) { await cargarPersonas(); if (!card.querySelector('[data-form]')) card.insertAdjacentHTML('beforeend', formPedido(card.dataset.cod, '')); e.target.remove(); return; }
  if (e.target.matches('[data-libre]')) { await cargarPersonas(); $('libre').innerHTML = '<div class="prod">' + formPedido('', null) + '</div>'; $('libre').querySelector('[data-texto]').focus(); return; }
  if (e.target.matches('[data-enviar]')) {
    const f = e.target.closest('[data-form]'), msg = f.querySelector('[data-msg]'), pidio = f.querySelector('[data-pidio]').value, cant = Number(f.querySelector('[data-cant]').value);
    const texto = f.querySelector('[data-texto]') ? f.querySelector('[data-texto]').value.trim() : '';
    if (!pidio) { msg.textContent = 'Elegí quién lo pide.'; return; }
    if (!(cant > 0)) { msg.textContent = 'Poné la cantidad.'; return; }
    if (f.querySelector('[data-texto]') && !texto) { msg.textContent = 'Escribí qué producto falta.'; return; }
    e.target.disabled = true; msg.textContent = 'Enviando…';
    try {
      const r = await api('cajera_pedir', {datos: JSON.stringify({codigo: f.dataset.form, producto: texto, cantidad: cant, pidio})});
      // v144: el producto no desaparece: queda marcado "Pedido por cajeras".
      const card = f.closest('.prod'), chip = card && card.querySelector('[data-chip]');
      if (card && card.dataset.cod) PEND[normCod(card.dataset.cod)] = {estado: 'pendiente', quien: r.pidio, fecha: 'recién'};
      if (chip) { chip.className = CHIP.pedido_cajera; chip.textContent = '✓ Pedido por cajeras (' + r.pidio + ', ' + r.cantidad + ' u.)'; f.remove(); }
      else (card || f).remove();
      $('enviado').textContent = '✓ Pedido enviado: ' + r.cantidad + ' × ' + r.producto + ' (lo pidió ' + r.pidio + ').';
    } catch (err) { e.target.disabled = false; msg.textContent = err.message; }
  }
});

let refrescando = false;
// v145: el aviso de cada producto en pantalla cambia solo (cuando en la planilla se marca Pedido o Descartado, o lo pide otra cajera).
async function refrescarEstados() {
  if (tab !== 'buscar' || document.hidden || refrescando) return;
  refrescando = true; try { await refrescarYa(); } finally { refrescando = false; }
}
async function refrescarYa() {
  const cards = [...document.querySelectorAll('#resultados .prod[data-cod]')]; if (!cards.length) return;
  let r; try { r = await api('cajera_estados', {codigos: JSON.stringify(cards.map(c => c.dataset.cod))}); } catch { return; }
  const E = (r && r.estados) || {};
  for (const card of cards) {
    const e = E[card.dataset.cod] || E[String(card.dataset.cod).toUpperCase()], chip = card.querySelector('[data-chip]'); if (!e || !chip) continue;
    const kc = normCod(card.dataset.cod); if (e.estado === 'no') { delete PEND[kc]; CAMINO.delete(kc); } else if (e.estado === 'pedido') PEND[kc] = {estado: 'pedido'}; else if (!PEND[kc] || PEND[kc].estado !== 'pendiente') { const m = /\((.*), (.*)\)/.exec(e.estadoTexto) || []; PEND[kc] = {estado: 'pendiente', quien: m[1] || '', fecha: m[2] || ''}; }
    if (chip.textContent !== e.estadoTexto && !(e.estado === 'pedido_cajera' && /^✓ Pedido por cajeras/.test(chip.textContent))) { chip.className = CHIP[e.estado] || 'chip gris'; chip.textContent = e.estadoTexto; }
    const boton = card.querySelector('[data-pedir]'), form = card.querySelector('[data-form]');
    if (e.estado !== 'no') { if (boton) boton.remove(); if (form) form.remove(); }
    else if (!boton && !form) chip.insertAdjacentHTML('afterend', '<button class="mini" data-pedir>Pedir</button>');
  }
}
// v148: una consulta atrás de la otra (1 segundo de descanso): el cambio se ve apenas ECHU lo tiene.
(async function ciclo() { for (;;) { await refrescarEstados(); await new Promise(r => setTimeout(r, 1000)); } })();
document.addEventListener("visibilitychange", refrescarEstados);

// ---------- Cobros ----------
let reloj = 0;
function lista(L, tipo) {
  if (!L) return '';
  if (!L.length) return '<p class="vacio">Todavía no hay cobros.</p>';
  return L.map(c => '<div class="cobro' + (c.ok ? '' : ' malo') + '"><span class="hora">' + esc(String(c.hora || '').slice(0, 5)) + '</span><b>' + pesos(c.importe) + '</b><span class="' + (c.ok ? 'chip verde' : 'chip rojo') + '">' + esc(c.estado) + '</span>' +
    '<small>Op. ' + esc(c.operacion) + (tipo === 'mp' ? (c.canal ? ' · ' + esc(c.canal) : '') + (c.devuelto > 0 ? ' · devuelto ' + pesos(c.devuelto) : '') : (c.pagador ? ' · ' + esc(c.pagador) : '')) + '</small></div>').join('');
}
async function cobros() {
  clearInterval(reloj);
  if (!$('fechaCobros').value) { $('fechaCobros').value = hoyAR(); $('fechaCobros').max = hoyAR(); $('fechaCobros').min = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); }
  $('cobrosMsg').textContent = 'Cargando…';
  try {
    const r = await api('cajera_cobros', {fecha: $('fechaCobros').value});
    // v142: solo los cobros del local (QR y Point): ni ventas online ni otros movimientos; y sin totales.
    const mp = r.mp ? r.mp.filter(c => c.canal === 'QR' || c.canal === 'Point') : r.mp;
    $('mpLista').innerHTML = (r.mpAviso ? '<p class="vacio">' + esc(r.mpAviso) + '</p>' : '') + lista(mp, 'mp');
    $('dniLista').innerHTML = (r.dniAviso ? '<small>' + esc(r.dniAviso) + '</small>' : '') + lista(r.dni, 'dni');
    $('cobrosMsg').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR', {hour: '2-digit', minute: '2-digit'});
  } catch (e) { $('cobrosMsg').textContent = e.message; }
  if (tab === 'cobros' && $('fechaCobros').value === hoyAR()) reloj = setInterval(() => { if (tab === 'cobros' && !document.hidden) cobros(); }, 60000);
}
$('fechaCobros').onchange = cobros; $('recargarCobros').onclick = cobros;
