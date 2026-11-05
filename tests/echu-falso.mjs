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
  gastos_datos: {mes: '2026-11', mesAnterior: '2026-10', proximo: '2026-12', total: 6480000, totalPct: 0.045,
    filas: [{fila: 10, label: 'Sueldos', col: 0, valor: 3200000, total: true},
      {fila: 11, label: 'Empleados', col: 3, valor: 2600000, grupo: 'Sueldos', auto: {valor: 2600000, fuente: 'Sueldos', detalle: 'Bruto de 2 liquidaciones de oct 2026'}, autoOn: true, antes: null},
      {fila: 13, label: 'Alquiler', col: 2, valor: 1500000, grupo: '', antes: 1428571}, {fila: 14, label: 'Luz', col: 2, valor: 180000, grupo: '', antes: 180000},
      {fila: 15, label: 'Internet y teléfono', col: 2, valor: 60000, grupo: '', antes: null}, {fila: 16, label: 'Ingresos brutos', col: 2, valor: 420000, grupo: '', antes: 400000}],
    pct: [{fila: 30, label: 'Tarjetas y Mercado Pago (comisión)', pct: 0.035}],
    resultado: {ventasMes: 25e6, fijosPct: 0.26, minimo: 0.30, deseado: 0.45, actual: 0.42, ventasMinimas: 21600000, porDia: 830000, proyectado: 1e6, estado: ''},
    ultimo: {mes: '2026-10', fact: 25289737, ganancia: 1850000, margen: 0.418}, meses: [], dist: {fact: 24e6, repo: 14e6, porVenta: 1.08e6, ganancia: 1.8e6},
    inflacion: [
      {mes: '2026-11', inflacion: null, precios: 0.012, costos: 0.009, gastos: 0.021, ventasReales: null, enCurso: true, texto: 'Tus precios subieron más que tus costos: el margen mejoró.'},
      {mes: '2026-10', inflacion: 0.027, precios: 0.031, costos: 0.04, gastos: 0.015, ventasReales: -0.02, enCurso: false, texto: 'Subiste los precios más que la inflación (0,4% más), pero tus costos subieron más que tus precios: el margen se achicó. Los gastos fijos subieron menos que la inflación. Descontando la inflación vendiste 2,0% menos que el mes anterior.'},
      {mes: '2026-09', inflacion: 0.021, precios: 0.024, costos: 0.018, gastos: 0.03, ventasReales: 0.011, enCurso: false, texto: 'Subiste los precios más que la inflación (0,3% más), y más que tus costos: el margen mejoró.'},
      {mes: '2026-08', inflacion: null, precios: 0.012, costos: 0.016, gastos: 0.02, ventasReales: null, enCurso: false, texto: 'Tus costos subieron más que tus precios: el margen se achicó. Cargá la inflación de ago 2026 para compararla.'}]},
  // v107: Inicio (modelo A). Inventado.
  inicio: {generado: '02/11/2026 09:00', errores: [], tareasUrl: 'https://docs.google.com/spreadsheets/d/PRUEBA/edit#gid=1',
    plata: {efectivo: 250000, mp: 480000, total: 730000, reservado: 318000, libre: 412000, fechaSaldo: '01/11/2026', cajasHasta: '02/11'},
    pagos: {total: 238500, items: [{nombre: 'Alquiler', monto: 180000, vence: '04/11', dias: 2, medio: 'MERCADO PAGO', vencido: false},
      {nombre: 'Internet', monto: 58500, vence: '07/11', dias: 5, medio: 'CUALQUIERA', vencido: false}]},
    tareas: {'CAMBIAR COSTO': 12, 'PEDIR ANTES (SE AGOTA)': 6},
    avisos: [{nivel: 'rojo', titulo: 'Caja 0003 · Cajera Uno · 01/11', detalle: 'Faltan $ 160.114. Revisá la diferencia.', ir: 'caja'},
      {nivel: 'amarillo', titulo: 'Vence Alquiler · 04/11', detalle: '$ 180.000 · Mercado Pago', ir: 'pagos'},
      {nivel: 'amarillo', titulo: '6 productos se agotan', detalle: 'Pedilos antes de quedarte sin stock.', ir: 'pedido'},
      {nivel: 'azul', titulo: '12 cambios de costo', detalle: 'Cargalos en el sistema de ventas.', ir: 'tareas'}]},
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
