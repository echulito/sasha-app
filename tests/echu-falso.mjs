// ECHU de mentira para las pruebas de la app (datos INVENTADOS: este repositorio es público).
import crypto from 'node:crypto';
export const URL_ECHU = 'https://script.google.com/macros/s/PRUEBA/exec';
export const PIN = '123456', TOKEN = 't'.repeat(64);
export const huella = t => crypto.createHash('sha256').update(String(t), 'utf8').digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const meses = [];
for (let i = 1; i <= 10; i++) meses.push({mes: '2026-' + String(i).padStart(2, '0'), etiqueta: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct'][i - 1] + ' 26', fact: 18e6 + i * 7e5, ganancia: i % 4 === 0 ? -2e5 : 9e5 + i * 1e4, estimado: i === 10});
const dias = [];
for (let d = 1; d <= 2; d++) dias.push({etiqueta: (d === 1 ? 'dom' : 'lun') + ' 0' + d + '/11', ventas: 800000 + d * 50000, tickets: 90 + d, ticketPromedio: 9000, efectivo: 300000, electronico: 550000, semanaAnterior: d === 1 ? null : 780000});
export const DATOS = {
  resumen: {datos: {completa: '02/11/2026 08:00', estado: 'OK'}, mes: {fact: 1650000, diasConVenta: 2, abiertos: 25, promedioDia: 825000, proyeccion: 20625000, objetivo: 19000000, objetivoDia: 760000, prev: {etiqueta: 'octubre', fact: 25000000}, prevMismaAltura: 1600000},
    mesActual: 'noviembre', meses, dias, anio: '2026', anioDatos: {fact: 210000000, meses: 10, ganancia: 6500000},
    porAnio: {2025: {1: 15e6, 2: 16e6, 3: 17e6, 9: 20e6, 10: 21e6, 11: 22e6}, 2026: Object.fromEntries(meses.map(m => [Number(m.mes.slice(5)), m.fact]))},
    admin: {actual: 0.42, minimo: 0.35, deseado: 0.45, fijos: 6500000, porVenta: 0.03}, contribucion: {mes: 7000000, pct: 0.37}, tareas: 321, proveedores: ['DISTRIBUIDORA UNO', 'MAYORISTA DOS']},
  indice: {formato: 2, version: '02/11/2026 08:00', provs: ['DISTRIBUIDORA UNO', 'MAYORISTA DOS'], rubros: ['SHAMPOO', 'PERFUME'], cats: ['MARCA A'],
    p: [['1001', 'SHAMPOO PRUEBA X 400', 0, '7790000000011', 'A1', 0, 5000, 3, 0, 0, ''], ['1002', 'PERFUME PRUEBA EDT X 100', 1, '7790000000028', 'B2', 0, 25000, 1, 1, 0, '']]},
  sin_estadistica: [], propuestas: [], ordenes_anuladas: [],
  estado_echu: {enCurso: false, estado: 'OK', detalle: '', pct: null, ultima: '02/11/2026 08:00', datos: '02/11/2026 08:00'},
  actualizar_echu: {lanzada: true, tipo: 'actualizar', estado: {enCurso: false, estado: 'OK', ultima: '02/11/2026 08:00'}}
};

/** Responde como ECHU. modo: 'normal' | 'viejo' (ECHU sin actualizar) | 'corrupto' (respuesta que no coincide con su huella). */
export function crearECHU(modo = 'normal') {
  const pedidos = [];
  function responder(p, via, cb) {
    let res;
    const acc = String(p.accion || '');
    if (acc === 'login') res = p.pin === PIN ? {ok: true, token: TOKEN, modo: 'completo'} : {ok: false, error: 'PIN', mensaje: 'PIN incorrecto.'};
    else if (p.token !== TOKEN) res = {ok: false, error: 'PIN', mensaje: 'Volvé a poner el PIN.'};
    else res = {ok: true, datos: acc in DATOS ? DATOS[acc] : {}};
    if (res.ok && res.datos !== undefined && modo !== 'viejo') res.h = modo === 'corrupto' && acc === 'resumen' ? 'no-coincide' : huella(JSON.stringify(res.datos));
    const json = JSON.stringify(res);
    return cb ? {status: 200, contentType: 'text/javascript', body: cb + '(' + json + ');'} : {status: 200, contentType: 'application/json', body: json};
  }
  async function manejar(route) {
    const req = route.request(), url = new URL(req.url());
    const q = Object.fromEntries(url.searchParams);
    if (req.method() === 'POST') {
      const cuerpo = req.postData() || '';
      pedidos.push({metodo: 'POST', url: req.url(), cuerpo});
      if (q.h && q.h !== huella(cuerpo)) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: false, error: 'INCOMPLETO', mensaje: 'La información no llegó completa a ECHU.'})});
      const p = JSON.parse(cuerpo);
      if (modo === 'viejo' && !/^(limpieza_|conta_leer|conta_guardar|gastos_guardar|sue_)/.test(p.accion)) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(p.token === TOKEN ? {ok: false, error: 'ACCION', mensaje: 'Acción desconocida.'} : {ok: false, error: 'PIN', mensaje: 'Volvé a poner el PIN.'})});
      return route.fulfill(responder(p, 'post'));
    }
    pedidos.push({metodo: 'GET', url: req.url()});
    return route.fulfill(responder(q, 'get', /^[A-Za-z0-9_]{1,40}$/.test(q.callback || '') ? q.callback : ''));
  }
  return {pedidos, manejar};
}
