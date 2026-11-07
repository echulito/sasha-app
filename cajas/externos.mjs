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
/** Todo en centavos. v124: vale lo que entró de verdad. Si coincide con la cajera o con el PDF se dice cuál; si no coincide
 *  con ninguno, igual se toma lo que entró (coincide: 'ninguno'). Las dos cosas las carga la cajera: si no coinciden, es error de ella. */
export function respuestaAutomatica(declarado, pdf, real) {
  if (!Number.isFinite(real)) return null;
  const cerca = (a, b) => Math.abs(a - b) <= 100;
  if (cerca(real, declarado)) return {monto: declarado, errorCajera: true, coincide: 'cajera'};
  if (cerca(real, pdf)) return {monto: pdf, errorCajera: true, coincide: 'pdf'};
  return {monto: real, errorCajera: true, coincide: 'ninguno'};
}

// v120/v124: cupones del turno (Mercado Pago QR/Point + Cuenta DNI) contra lo que entró de verdad en el horario del turno.
// Todo en centavos. pdf y cajera son solo la parte de MP + Cuenta DNI. Si lo que entró da lo del PDF, está bien (null).
// Si no, vale lo que entró: coincide 'cajera' (el PDF quedó mal cargado) o 'ninguno' (las dos cargas de la cajera están mal).
export function correccionCupones(pdf, cajera, real) {
  if (!Number.isFinite(pdf) || !Number.isFinite(real)) return null;
  const cerca = (a, b) => Math.abs(a - b) <= 100;
  if (cerca(real, pdf)) return null;
  return Number.isFinite(cajera) && cerca(real, cajera) ? {monto: cajera, coincide: 'cajera'} : {monto: real, coincide: 'ninguno'};
}

// v125: cruce de cada cobro real (Mercado Pago y Cuenta DNI del horario del turno) con los cobros de los tickets del turno.
// Lo que entró y no tiene ticket explica sobrantes; lo que el sistema dice cobrado y no entró explica faltantes.
// pagos: filas del "Detalle de Ventas por Forma de Pago" del turno {method, amount (centavos), ticket, time 'HH:MM'}.
export const medioDeTicket = m => /BANELCO|DNI/i.test(m) ? 'Cuenta DNI' : /EFECTIVO/i.test(m) ? 'Efectivo' : 'Mercado Pago';
export function cruzarCobros(realMp, realDni, pagos, apertura, cierre, anulados) {
  const a = minuto(apertura), c = minuto(cierre);
  if (a === null || c === null) return null;
  const dentro = (lista, medio) => (lista || []).filter(x => { const m = minuto(x.hora); return m !== null && m >= a && m <= c; })
    .map(x => ({medio, hora: String(x.hora).slice(0, 5), importe: Math.round((Number(x.importe) || 0) * 100)}));
  const reales = dentro(realMp, 'Mercado Pago').concat(dentro(realDni, 'Cuenta DNI')).sort((x, y) => minuto(x.hora) - minuto(y.hora));
  const tickets = (pagos || []).map(p => ({medio: medioDeTicket(p.method), metodo: p.method, ticket: p.ticket, hora: p.time || '', importe: p.amount, usado: false}));
  const dist = (r, t) => (minuto(t.hora) === null ? 9999 : Math.abs(minuto(t.hora) - minuto(r.hora)));
  const buscar = (r, mismoMedio) => tickets.filter(t => !t.usado && Math.abs(t.importe - r.importe) <= 100 && (mismoMedio ? t.medio === r.medio : t.medio !== r.medio))
    .sort((x, y) => dist(r, x) - dist(r, y))[0];
  const sinTicket = [], diferencias = [];
  // 1) mismo medio e importe exacto (±$1).
  let pendientes = reales.filter(r => { const t = buscar(r, true); if (t) { t.usado = true; return false; } return true; });
  // 2) v131: tickets que están en el detalle de tickets pero no en el cierre ni en los cobros del sistema (anulados en el sistema).
  //    Si entró un cobro por ese importe cerca de esa hora, se cobró un ticket que después se anuló.
  const anul = (anulados || []).map(t => ({ticket: t.ticket, hora: t.hora || '', importe: t.importe, usado: false}));
  pendientes = pendientes.filter(r => { const t = anul.filter(t => !t.usado && Math.abs(t.importe - r.importe) <= 100 && dist(r, t) <= 30).sort((x, y) => dist(r, x) - dist(r, y))[0];
    if (!t) return true; t.usado = true; sinTicket.push({...r, anulado: {ticket: t.ticket, hora: t.hora, importe: t.importe}}); return false; });
  // 3) v133: dos cobros que juntos dan un ticket (cada uno en el mismo minuto del ticket o con 1 minuto de diferencia).
  //    Sirve para tickets cobrados en dos partes (por ejemplo $ 1.506 + $ 13.540 = ticket de $ 15.046), aunque el sistema diga otro medio.
  const combinados = [];
  const candidatos = tickets.filter(t => !t.usado).map(t => ({t, anulado: false})).concat(anul.filter(t => !t.usado).map(t => ({t, anulado: true})))
    .filter(x => minuto(x.t.hora) !== null).sort((x, y) => minuto(x.t.hora) - minuto(y.t.hora));
  for (const {t, anulado} of candidatos) {
    const cerca = pendientes.filter(r => dist(r, t) <= 1);
    let mejor = null;
    for (let i = 0; i < cerca.length; i++) for (let j = i + 1; j < cerca.length; j++) {
      const d = cerca[i].importe + cerca[j].importe - t.importe;
      if (Math.abs(d) <= Math.min(200000, Math.round(t.importe * 0.05)) && (!mejor || Math.abs(d) < Math.abs(mejor.d))) mejor = {a: cerca[i], b: cerca[j], d};
    }
    if (!mejor) continue;
    t.usado = true; pendientes = pendientes.filter(r => r !== mejor.a && r !== mejor.b);
    const movimientos = [mejor.a, mejor.b].sort((x, y) => minuto(x.hora) - minuto(y.hora));
    combinados.push({movimientos, medio: movimientos[0].medio === movimientos[1].medio ? movimientos[0].medio : 'Mercado Pago y Cuenta DNI', hora: movimientos[0].hora,
      importe: mejor.a.importe + mejor.b.importe, ticket: t.ticket, metodo: anulado ? '' : t.metodo, horaTicket: t.hora, importeTicket: t.importe, dif: Math.abs(mejor.d) <= 100 ? 0 : mejor.d, anulado});
  }
  // 4) v126: mismo medio, importe parecido (hasta 5% y $ 2.000) y hora cercana (20 min): es ese ticket, cobrado con diferencia
  //    (por ejemplo, el ticket era de $ 10.107 y le cobró $ 10.100).
  const parecido = r => tickets.filter(t => !t.usado && t.medio === r.medio && t.medio !== 'Efectivo' && dist(r, t) <= 20 &&
    Math.abs(t.importe - r.importe) <= Math.min(200000, Math.round(t.importe * 0.05))).sort((x, y) => dist(r, x) - dist(r, y) || Math.abs(x.importe - r.importe) - Math.abs(y.importe - r.importe))[0];
  pendientes = pendientes.filter(r => { const t = parecido(r); if (!t) return true; t.usado = true;
    diferencias.push({...r, ticket: t.ticket, metodo: t.metodo, importeTicket: t.importe, dif: r.importe - t.importe}); return false; });
  // 5) lo que queda, mismo importe con otro medio y hora cercana (por ejemplo, cobrado por QR y registrado en efectivo).
  pendientes.forEach(r => { let t = buscar(r, false); if (t && dist(r, t) > 30) t = null; if (t) t.usado = true; sinTicket.push(t ? {...r, registrado: {ticket: t.ticket, medio: t.metodo}} : r); });
  const sinEntrar = tickets.filter(t => !t.usado && t.medio !== 'Efectivo').map(t => ({medio: t.medio, metodo: t.metodo, ticket: t.ticket, hora: t.hora, importe: t.importe}));
  const suma = l => l.reduce((n, x) => n + x.importe, 0);
  return {sinTicket, sinEntrar, diferencias, combinados, totalCombinadoOtroMedio: suma(combinados.filter(x => x.anulado || x.metodo && medioDeTicket(x.metodo) !== x.medio)), totalSinTicket: suma(sinTicket.filter(x => !x.registrado && !x.anulado)), totalOtroMedio: suma(sinTicket.filter(x => x.registrado)), totalAnulado: suma(sinTicket.filter(x => x.anulado)),
    totalSinEntrar: suma(sinEntrar), totalDiferencia: diferencias.reduce((n, x) => n + x.dif, 0), reales: reales.length};
}
