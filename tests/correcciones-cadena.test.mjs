// v192: cada corrección sigue a la anterior del mismo campo (como lo valida Google); las que quedaron mal se arreglan solas.
import test from 'node:test'; import assert from 'node:assert/strict';
import {normalizeState, addClosingCorrection, repairCorrectionChains, effectiveTurn, allTurns} from '../cajas/domain.mjs';
const fila = o => Object.assign({expenses: [], date: '2026-11-19', branch: '01', scope: 'Turno PDF', credits: 0, withdrawals: 0, extraDigitalDeclared: 0, systemDifference: 0, operations: 1, remainder: 0, closingWithdrawal: 0}, o);
const estado = () => normalizeState({manual: [], reports: [{type: 'turnClose', date: '2026-11-19', branch: '01', filename: 'c.pdf',
  rows: [fila({box: '0003', batch: '900', openTime: '15:30', closeTime: '19:30', opening: 0, sales: 160000, grossSales: 160000, cash: 3000, digital: 157000, sourceCouponDeclared: 0, extraDigitalDeclared: 157000, cashier: 'FERNANDA'})]}]});

test('caja 0003 con la regla de cupones: la corrección sigue la cadena (antes = lo del PDF), y queda el importe corregido', () => {
  const s = estado();
  const t = allTurns(s, '2026-11-19')[0];
  assert.equal(effectiveTurn(s, t).digital, 0, 'la regla muestra 0');
  const c = addClosingCorrection(s, {date: '2026-11-19', branch: '01', box: '0003', batch: '900', field: 'digital', after: 155851, note: 'cupones corroborados'});
  assert.deepEqual([c.sourceValue, c.before, c.after], [157000, 157000, 155851], 'antes = el valor del PDF (lo que espera Google), no el 0 de la regla');
  assert.equal(effectiveTurn(s, allTurns(s, '2026-11-19')[0]).digital, 155851);
  const c2 = addClosingCorrection(s, {date: '2026-11-19', branch: '01', box: '0003', batch: '900', field: 'digital', after: 150000, note: 'otra vez'});
  assert.equal(c2.before, 155851, 'la segunda sigue a la primera');
  assert.equal(effectiveTurn(s, allTurns(s, '2026-11-19')[0]).digital, 150000);
});

test('las correcciones guardadas con otro "antes" se arreglan al abrir (y si no cambian nada, se descartan)', () => {
  const s = {closingCorrections: [
    {date: '2026-11-19', branch: '01', box: '0003', batch: '900', field: 'digital', sourceValue: 157000, before: 0, after: 155851},
    {date: '2026-11-19', branch: '01', box: '0003', batch: '900', field: 'digital', sourceValue: 157000, before: 155851, after: 150000},
    {date: '2026-11-19', branch: '01', box: '0001', batch: '901', field: 'cash', sourceValue: 5000, before: 0, after: 5000},
    {date: '2026-11-19', branch: '01', box: '0001', batch: '902', field: 'cash', sourceValue: 100, before: 100, after: 90}]};
  assert.equal(repairCorrectionChains(s), 2);
  assert.deepEqual(s.closingCorrections.map(c => [c.batch, c.before, c.after]), [['900', 157000, 155851], ['900', 155851, 150000], ['902', 100, 90]]);
  assert.equal(repairCorrectionChains(s), 0, 'ya quedaron bien');
});
