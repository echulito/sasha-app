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
  if (t === 'buscar') setTimeout(() => $('q').focus(), 50);
  if (t === 'cobros') cobros();
}
$('tabs').onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) elegir(b.dataset.tab); };
// Las solapas aparecen cuando la cajera entró (el botón "Cerrar sesión" queda a la vista).
const mirar = () => { const adentro = !$('logout').hidden; $('tabs').hidden = !adentro; if (!adentro && tab !== 'declarar') elegir('declarar'); };
new MutationObserver(mirar).observe($('logout'), {attributes: true, attributeFilter: ['hidden']}); mirar();

// ---------- Buscar ----------
let personas = null, yo = '', espera = 0, ultima = '';
async function cargarPersonas() { if (personas) return; try { const r = await api('cajera_personas'); personas = r.personas || []; yo = r.yo || ''; } catch { personas = []; } }
const CHIP = {pedido: 'chip azul', pedido_cajera: 'chip amar', no: 'chip gris'};
function formPedido(id, producto) {
  const ops = (personas || []).map(p => '<option' + (p === yo ? ' selected' : '') + '>' + esc(p) + '</option>').join('');
  return '<div class="pedir" data-form="' + esc(id) + '">' + (producto === null ? '<label>¿Qué producto falta?<input data-texto maxlength="120" placeholder="Ej.: Tintura 919 7.42"></label>' : '') +
    '<div class="dos"><label>¿Quién lo pide?<select data-pidio><option value="">Elegí…</option>' + ops + '</select></label><label>Cantidad sugerida<input data-cant type="number" min="1" max="9999" inputmode="numeric" value="1"></label></div>' +
    '<button class="primary" data-enviar>Enviar pedido</button><small data-msg></small></div>';
}
function pintarResultados(r) {
  const L = r.productos || [];
  $('resultados').innerHTML = (L.length ? L.map(p => '<div class="prod" data-cod="' + esc(p.codigo) + '"><div class="fila"><b>' + esc(p.producto) + '</b><span class="precio">' + pesos(p.precio) + '</span></div>' +
      '<div class="fila"><span class="' + (CHIP[p.estado] || 'chip gris') + '">' + esc(p.estadoTexto) + '</span>' + (p.estado === 'pedido' ? '' : '<button class="mini" data-pedir>Pedir</button>') + '</div></div>').join('')
    : '<p class="vacio">No encontré nada con eso.</p>') + (r.mas ? '<small>Hay más resultados: escribí algo más preciso.</small>' : '') +
    '<button class="link" data-libre>¿No lo encontrás? Pedilo igual</button><div id="libre"></div>';
}
async function buscar(q) {
  q = q.trim(); if (q.length < 2) { $('resultados').innerHTML = ''; return; }
  ultima = q; $('buscando').textContent = 'Buscando…';
  try { const r = await api('cajera_buscar', {q}); if (q !== ultima) return; pintarResultados(r); $('buscando').textContent = ''; }
  catch (e) { if (q === ultima) $('buscando').textContent = e.message; }
}
$('q').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => buscar($('q').value), 450); });
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
      (f.closest('.prod') || f).remove();
      $('enviado').textContent = '✓ Pedido enviado: ' + r.cantidad + ' × ' + r.producto + ' (lo pidió ' + r.pidio + ').';
    } catch (err) { e.target.disabled = false; msg.textContent = err.message; }
  }
});

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
