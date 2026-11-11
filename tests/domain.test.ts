import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, simulate } from '../server/domain.js';
import type { Snapshot } from '../shared/types.js';

const source: Snapshot = JSON.parse(readFileSync(new URL('../data/portfolio.json', import.meta.url), 'utf8'));
const sell = { symbol: 'A01', side: 'sell', quantity: 100 };
const buy = { symbol: 'A02', side: 'buy', quantity: 100 };

test('AC-01: cash is included in assets but not in industry; exactly two warnings', () => {
  const result = analyze(source);
  assert.equal(result.totalAssets, '100000.00');
  assert.equal(result.cash, '20000.00');
  assert.equal(result.positionCount, 6);
  assert.equal(result.positions[0].percentage, '40.00');
  assert.equal(result.industries.find(x => x.industry === '科技')?.percentage, '60.00');
  assert.deepEqual(result.alerts.map(x => x.key), ['A01', '科技']);
  assert.equal(result.industries.length, 5);
});

test('AC-02: equality with 30% and 50% removes both warnings', () => {
  const { original, simulated } = simulate(source, [sell]);
  assert.equal(original.cash, '20000.00');
  assert.equal(simulated.cash, '30000.00');
  assert.equal(simulated.totalAssets, '100000.00');
  assert.equal(simulated.positions[0].marketValue, '30000.00');
  assert.equal(simulated.positions[0].percentage, '30.00');
  assert.equal(simulated.industries.find(x => x.industry === '科技')?.percentage, '50.00');
  assert.equal(simulated.alerts.length, 0);
});

test('AC-03: sequential trades use previous cash and positions', () => {
  const { simulated } = simulate(source, [sell, buy]);
  assert.equal(simulated.cash, '25000.00');
  assert.equal(simulated.totalAssets, '100000.00');
  assert.equal(simulated.positions[1].quantity, 500);
  assert.equal(simulated.positions[1].marketValue, '25000.00');
  assert.equal(simulated.industries[0].percentage, '55.00');
  assert.deepEqual(simulated.alerts.map(x => x.key), ['科技']);
});

for (const [name, operation, code] of [
  ['insufficient cash', { symbol: 'A01', side: 'buy', quantity: 201 }, 'INSUFFICIENT_CASH'],
  ['insufficient position', { symbol: 'A01', side: 'sell', quantity: 401 }, 'INSUFFICIENT_POSITION'],
  ...[0, -1, 0.5, '100', true, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(quantity =>
    [`invalid quantity ${String(quantity)}`, { symbol: 'A01', side: 'buy', quantity }, 'INVALID_QUANTITY']),
  ['unknown symbol', { symbol: 'OTHER', side: 'buy', quantity: 1 }, 'UNKNOWN_SYMBOL'],
  ['unknown side', { symbol: 'A01', side: 'hold', quantity: 1 }, 'INVALID_SIDE'],
  ['overflow', { symbol: 'A01', side: 'buy', quantity: Number.MAX_SAFE_INTEGER }, 'AMOUNT_OVERFLOW'],
] as const) {
  test(`AC-04: ${name} is rejected without changing source`, () => {
    const before = JSON.stringify(source);
    assert.throws(() => simulate(source, [operation]), (e: any) => e.code === code && e.operationIndex === 0);
    assert.equal(JSON.stringify(source), before);
  });
}

test('a later invalid trade leaves original and previous valid result untouched', () => {
  const previous = simulate(source, [sell]);
  const before = JSON.stringify(previous);
  assert.throws(() => simulate(source, [sell, { symbol: 'A01', side: 'sell', quantity: 301 }]),
    (e: any) => e.code === 'INSUFFICIENT_POSITION' && e.operationIndex === 1);
  assert.equal(JSON.stringify(previous), before);
  assert.equal(source.instruments[0].quantity, 400);
});

test('a buy after selling all holdings uses released cash; zero position remains visible', () => {
  const result = simulate(source, [{ ...sell, quantity: 400 }, { ...buy, quantity: 1000 }]);
  assert.equal(result.simulated.cash, '10000.00');
  assert.equal(result.simulated.positions[0].quantity, 0);
  assert.equal(result.simulated.positionCount, 5);
  assert.equal(result.simulated.totalAssets, '100000.00');
});

test('threshold uses unrounded ratio: 30.004% is warned even when displayed 30.00%', () => {
  const fixture = structuredClone(source);
  fixture.cash = '699.96';
  fixture.instruments = [{ symbol: 'A', name: 'Test', industry: '行业', price: '0.01', quantity: 30004 }];
  const result = analyze(fixture);
  assert.equal(result.positions[0].percentage, '30.00');
  assert.equal(result.positions[0].exceeded, true);
});

test('amounts sum in cents and round percentage deterministically', () => {
  const fixture = structuredClone(source);
  fixture.cash = '0.20';
  fixture.instruments = [{ symbol: 'A', name: 'Test', industry: '行业', price: '0.10', quantity: 1 }];
  const result = analyze(fixture);
  assert.equal(result.totalAssets, '0.30');
  assert.equal(result.positions[0].percentage, '33.33');
});

test('malformed operations and more than 100 operations are rejected', () => {
  for (const value of [null, {}, 'bad', [null], Array(101).fill(sell)]) {
    assert.throws(() => simulate(source, value));
  }
  assert.equal(simulate(source, []).simulated.cash, '20000.00');
});

test('steps explain each trade against its immediate predecessor, including alert transitions', () => {
  const result = simulate(source, [sell, buy]);
  const steps = result.steps;
  assert.ok(Array.isArray(steps), 'simulation must return ordered steps');
  assert.equal(steps.length, 2);
  assert.equal(steps[0].index, 1);
  assert.deepEqual(steps[0].operation, sell);
  assert.equal(steps[0].analysis.cash, '30000.00');
  assert.equal(steps[0].impact.tradeValue, '10000.00');
  assert.deepEqual(steps[0].impact.cash, { before: '20000.00', after: '30000.00' });
  assert.equal(steps[0].impact.position.quantityBefore, 400);
  assert.equal(steps[0].impact.position.quantityAfter, 300);
  assert.equal(steps[0].impact.position.percentageBefore, '40.00');
  assert.equal(steps[0].impact.position.percentageAfter, '30.00');
  assert.equal(steps[0].impact.industry.percentageBefore, '60.00');
  assert.equal(steps[0].impact.industry.percentageAfter, '50.00');
  assert.deepEqual(steps[0].impact.resolvedAlerts.map(a => a.key), ['A01', '科技']);
  assert.deepEqual(steps[0].impact.triggeredAlerts, []);
  assert.deepEqual(steps[1].impact.cash, { before: '30000.00', after: '25000.00' });
  assert.equal(steps[1].impact.position.quantityBefore, 400);
  assert.equal(steps[1].impact.position.quantityAfter, 500);
  assert.equal(steps[1].impact.industry.percentageBefore, '50.00');
  assert.equal(steps[1].impact.industry.percentageAfter, '55.00');
  assert.deepEqual(steps[1].impact.triggeredAlerts.map(a => a.key), ['科技']);
  assert.deepEqual(steps[1].impact.resolvedAlerts, []);
  assert.deepEqual(steps[1].analysis, result.simulated);
});

test('empty simulation has no steps; adding a later operation does not mutate previous steps', () => {
  assert.deepEqual(simulate(source, []).steps, []);
  const previous = simulate(source, [sell, buy]);
  const serialized = JSON.stringify(previous.steps);
  const next = simulate(source, [sell, buy, { symbol: 'A03', side: 'buy', quantity: 10 }]);
  assert.equal(next.steps[2].analysis.cash, '24000.00');
  assert.equal(next.steps[0].analysis.positions[1].quantity, 400);
  assert.equal(next.steps[1].analysis.positions[2].quantity, 100);
  assert.equal(JSON.stringify(previous.steps), serialized);
  assert.throws(() => simulate(source, [sell, buy, { symbol: 'A01', side: 'sell', quantity: 301 }]));
  assert.equal(JSON.stringify(previous.steps), serialized);
});

test('unchanged alert membership does not produce a newly triggered warning', () => {
  const result = simulate(source, [{ symbol: 'A01', side: 'sell', quantity: 1 }]);
  assert.ok(Array.isArray(result.steps));
  assert.deepEqual(result.steps[0].impact.triggeredAlerts, []);
  assert.deepEqual(result.steps[0].impact.resolvedAlerts, []);
  assert.equal(result.steps[0].analysis.alerts.length, 2);
});

test('alert identity distinguishes a stock and industry with the same key', () => {
  const fixture = structuredClone(source);
  fixture.cash = '15000.00';
  fixture.instruments[0].symbol = '科技';
  fixture.instruments[1].quantity = 500;
  const result = simulate(fixture, [{ symbol: '科技', side: 'sell', quantity: 100 }]);
  assert.deepEqual(result.steps[0]!.impact.resolvedAlerts.map(a => a.type), ['instrument']);
  assert.deepEqual(result.steps[0]!.impact.triggeredAlerts, []);
  assert.deepEqual(result.steps[0]!.analysis.alerts.map(a => a.type), ['industry']);
});
