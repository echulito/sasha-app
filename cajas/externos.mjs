// Sasha v110: lo que entró de verdad (Mercado Pago por su API, Cuenta DNI por los mails de Redlink) contra lo declarado.
// Puro (sin pantalla) para poder probarlo.
export const TOLERANCIA_EXTERNOS = 100;
/** dec: {mercadoPago, cuentaDni, pendingOrders} en centavos (como todo en Cajas) o null.
 *  x: respuesta de ECHU pagos_externos, con los importes en PESOS. v122: se pasan a centavos antes de comparar
 *  (antes se comparaban pesos contra centavos y "Entró" salía 100 veces más chico). */
export function compararExternos(dec, x) {
  const filas = [], notas = [], c = n => Math.round((Number(n) || 0) * 100);
  let comMp = 0, comDni = 0;
  const fila = (nombre, declarado, entro, extra) => {
    const dif = entro - declarado;
    filas.push({nombre, declarado, entro, dif, ok: Math.abs(dif) <= TOLERANCIA_EXTERNOS * 100, extra});
  };
  const mp = (x || {}).mp, dni = (x || {}).cuentaDni;
  if (mp && mp.sinClave) notas.push('Mercado Pago: falta la clave en ECHU (menú Avisos y claves › Mercado Pago).');
  else if (mp && mp.error) notas.push('Mercado Pago: ' + mp.error + '.');
  else if (mp) {
    const k = mp.porCanal || {}, presencial = c((k.QR ? k.QR.total : 0) + (k.Point ? k.Point.total : 0));
    const otros = Object.keys(k).filter(n => n !== 'QR' && n !== 'Point').map(n => ({canal: n, total: c(k[n].total)}));
    comMp = c(mp.comisiones);
    if (dec) fila('Mercado Pago', dec.mercadoPago || 0, presencial, {cobros: (k.QR ? k.QR.cantidad : 0) + (k.Point ? k.Point.cantidad : 0), otros, pedidosOnline: dec.pendingOrders || 0});
  }
  if (dni && dni.error) notas.push('Cuenta DNI: ' + dni.error + '.');
  else if (dni) {
    comDni = c(dni.comisiones);
    if (dec) fila('Cuenta DNI', dec.cuentaDni || 0, c(dni.total), {cobros: dni.cantidad || 0, rechazados: dni.rechazados || 0, rechazadosLista: dni.rechazadosLista || []});
  }
  if (!dec) notas.push('Todavía no hay declaraciones de este día para comparar.');
  return {filas, notas, comisiones: {mp: comMp, cuentaDni: comDni, total: comMp + comDni}};
}

// v111: respuesta automática de "¿Cuánto recibió X por Mercado Pago / Cuenta DNI?" con lo que entró de verdad en el horario del turno.
const minuto = h => { const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** Cobros (hora 'HH:MM:SS', importe en pesos) entre la apertura y el cierre del turno ('HH:MM'). canales: solo esos (si vienen). */
export function cobrosEnTurno(cobros, apertura, cierre, canales) {
  const a = minuto(apertura), c = minuto(cierre);
  if (a === null || c === null || c < a) return null;
  const dentro = (cobros || []).filter(x => { const m = minuto(x.hora); return m !== null && m >= a && m <= c && (!canales || canales.includes(x.canal)); });
  const total = Math.round(dentro.reduce((n, x) => n + Math.round((Number(x.importe) || 0) * 100), 0));
  const horas = dentro.map(x => String(x.hora).slice(0, 5)).sort();
  return {total, cantidad: dentro.length, desde: horas[0] || '', hasta: horas[horas.length - 1] || ''};
}
/** Todo en centavos. Si lo que entró coincide con el informe PDF o con la cajera (±$1), esa es la respuesta. Si no, null (la contesta el encargado).
 *  Las dos cosas las carga la cajera (la declaración y el sistema del que sale el PDF): si no coinciden, siempre es error de carga de ella. */
export function respuestaAutomatica(declarado, pdf, real) {
  if (!Number.isFinite(real)) return null;
  const cerca = (a, b) => Math.abs(a - b) <= 100;
  if (cerca(real, declarado)) return {monto: declarado, errorCajera: true, coincide: 'cajera'};
  if (cerca(real, pdf)) return {monto: pdf, errorCajera: true, coincide: 'pdf'};
  return null;
}

// v120: cupones del turno (total) con lo que entró de verdad (Mercado Pago QR/Point + Cuenta DNI en el horario del turno).
// Todo en centavos. Si lo que entró coincide con lo que declaró la cajera y no con el PDF, el PDF quedó mal cargado: se corrige.
// Si coincide con el PDF (o con ninguno), no se toca nada.
export function correccionCupones(pdf, cajera, real) {
  if (![pdf, cajera, real].every(Number.isFinite)) return null;
  const cerca = (a, b) => Math.abs(a - b) <= 100;
  if (cerca(cajera, pdf) || cerca(real, pdf) || !cerca(real, cajera)) return null;
  return {monto: cajera, coincide: 'cajera'};
}
