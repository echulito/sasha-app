// Sasha v110: lo que entró de verdad (Mercado Pago por su API, Cuenta DNI por los mails de Redlink) contra lo declarado.
// Puro (sin pantalla) para poder probarlo.
export const TOLERANCIA_EXTERNOS = 100;
/** dec: {mercadoPago, cuentaDni, pendingOrders} o null · x: respuesta de ECHU pagos_externos. */
export function compararExternos(dec, x) {
  const filas = [], notas = [], r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  let comMp = 0, comDni = 0;
  const fila = (nombre, declarado, entro, extra) => {
    const dif = r2(entro - declarado);
    filas.push({nombre, declarado: r2(declarado), entro: r2(entro), dif, ok: Math.abs(dif) <= TOLERANCIA_EXTERNOS, extra});
  };
  const mp = (x || {}).mp, dni = (x || {}).cuentaDni;
  if (mp && mp.sinClave) notas.push('Mercado Pago: falta la clave en ECHU (menú Avisos y claves › Mercado Pago).');
  else if (mp && mp.error) notas.push('Mercado Pago: ' + mp.error + '.');
  else if (mp) {
    const c = mp.porCanal || {}, presencial = r2((c.QR ? c.QR.total : 0) + (c.Point ? c.Point.total : 0));
    const otros = Object.keys(c).filter(k => k !== 'QR' && k !== 'Point').map(k => ({canal: k, total: c[k].total}));
    comMp = r2(mp.comisiones);
    if (dec) fila('Mercado Pago', dec.mercadoPago || 0, presencial, {cobros: mp.cantidad || 0, otros, pedidosOnline: dec.pendingOrders || 0});
  }
  if (dni && dni.error) notas.push('Cuenta DNI: ' + dni.error + '.');
  else if (dni) {
    comDni = r2(dni.comisiones);
    if (dec) fila('Cuenta DNI', dec.cuentaDni || 0, dni.total || 0, {cobros: dni.cantidad || 0, rechazados: dni.rechazados || 0});
  }
  if (!dec) notas.push('Todavía no hay declaraciones de este día para comparar.');
  return {filas, notas, comisiones: {mp: comMp, cuentaDni: comDni, total: r2(comMp + comDni)}};
}
