// v180: un cierre en el que se retiró todo el efectivo no trae "Resto en Caja Efectivo" (es 0) y se tiene que leer igual.
import test from 'node:test'; import assert from 'node:assert/strict';
import {parseReport} from '../cajas/parser.mjs';
const TXT = `=======================================
***   C   I   E   R   R   E   D E   C A J A   ***
Vuelco:   2522   -   Jueves
Sucursal:   GON-1970   Caja: 0001
Cajero/a:   VANESA
Fecha   Cierre:   19/11/2026   15:30
Apertura:   19/11/2026   09:41
Tickets:   00122718 al 00122732
Cantidad   de   Operaciones:   15
---------------------------------------
Saldo   Inicial   Efectivo $   58840.00
Saldo   Inicial   [TC=1.00]   58840.00
Ing.   x   Venta   Efectivo $   0.01
Ing.   x   Venta   M   PAGO OFFLI   148762.50
Ing.   x   Venta   CUPONES   21220.00
Ing.   x   Venta   [TC=1.00]   169982.51
Movimientos   Efectivo $   0.00
Saldo   Final   Efectivo $   58840.01
Saldo   Final   M   PAGO OFFLI   148762.50
Saldo   Final   CUPONES   21220.00
Saldo   Final   [TC=1.00]   228822.51
TOTAL   Declarado   Efectivo $   58840.00
TOTAL   Declarado   M PAGO OFF   148762.50
T0TAL   Declarado   CUPONES   21160.00
T0TAL   Declarado   [TC=1.00]   228762.50
Diferencia   Efectivo $   0.01
Diferencia   M   PAGO OFFLINE   0.00
Diferencia   CUPONES   60.00
Diferencia   [TC=1.00]   60.01
----------------------------------------
RETIRO   EFECTIVO   X CIERRE   -58840.00
---------------------------------------`;
test('cierre sin "Resto en Caja": se retiró todo el efectivo, el resto es 0', () => {
  const r = parseReport(TXT).rows[0];
  assert.deepEqual([r.box, r.batch, r.cashier, r.remainder, r.closingWithdrawal, r.cash], ['0001', '2522', 'VANESA', 0, 5884000, 5884000]);
});
test('si falta "Resto en Caja" pero quedó efectivo, sigue avisando', () => {
  assert.throws(() => parseReport(TXT.replace('X CIERRE   -58840.00', 'X CIERRE   -50000.00')), /resto en caja/i);
});
