import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { PlanStore } from '../server/store.js';
import type { Snapshot } from '../shared/types.js';

const snapshot: Snapshot = JSON.parse(readFileSync(new URL('../data/portfolio.json', import.meta.url), 'utf8'));
const operations = [{ symbol: 'A01', side: 'sell', quantity: 100 }, { symbol: 'A02', side: 'buy', quantity: 100 }];
async function start(path = ':memory:', source = snapshot) {
  const store = new PlanStore(path);
  const server = createApp({ snapshot: source, store }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port');
  const base = `http://127.0.0.1:${address.port}`;
  return { store, request: async (path: string, body?: unknown) => {
    const response = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  }, base, close: async () => {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    store.close();
  } };
}

test('HTTP AC-01 to AC-04: correct calculations and errors; original remains unchanged', async () => {
  const api = await start();
  try {
    assert.equal((await api.request('/api/portfolio')).body.analysis.totalAssets, '100000.00');
    const boundary = await api.request('/api/simulate', { operations: operations.slice(0, 1) });
    assert.equal(boundary.status, 200);
    assert.equal(boundary.body.simulated.cash, '30000.00');
    assert.equal(boundary.body.simulated.alerts.length, 0);
    const sequential = await api.request('/api/simulate', { operations });
    assert.equal(sequential.body.simulated.cash, '25000.00');
    assert.equal(sequential.body.simulated.industries[0].percentage, '55.00');
    for (const op of [
      { symbol: 'A01', side: 'buy', quantity: 201 },
      { symbol: 'A01', side: 'sell', quantity: 401 },
      ...[0, -1, 1.5, '1', true, null, Number.MAX_SAFE_INTEGER].map(quantity => ({ symbol: 'A01', side: 'buy', quantity })),
    ]) {
      const rejected = await api.request('/api/simulate', { operations: [op] });
      assert.equal(rejected.status, 422);
      assert.equal(rejected.body.error.operationIndex, 0);
      assert.ok(rejected.body.error.message);
    }
    const original = (await api.request('/api/portfolio')).body.analysis;
    assert.equal(original.cash, '20000.00');
    assert.equal(original.positions[0].quantity, 400);
    assert.equal(original.positions[1].quantity, 400);
  } finally { await api.close(); }
});

test('AC-05: real SQLite survives HTTP server/database restart; persisted snapshot is independent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'portfolio-test-'));
  const db = join(dir, 'plans.sqlite');
  let api = await start(db);
  try {
    assert.deepEqual((await api.request('/api/plans')).body, []);
    const saved = await api.request('/api/plans', { name: '  验收方案  ', operations, simulated: { cash: '999999' } });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.name, '验收方案');
    assert.equal(saved.body.simulated.cash, '25000.00');
    const id = saved.body.id;
    await api.close();
    const changed = structuredClone(snapshot);
    changed.cash = '1.00';
    changed.instruments[0].price = '999.00';
    api = await start(db, changed);
    const reopened = await api.request(`/api/plans/${id}`);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.simulated.cash, '25000.00');
    assert.equal(reopened.body.simulated.totalAssets, '100000.00');
    assert.equal(reopened.body.snapshot.cash, '20000.00');
    assert.equal(reopened.body.original.positions[0].quantity, 400);
    assert.equal((await api.request('/api/plans')).body[0].operationCount, 2);
  } finally { await api.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('names, empty plans, invalid batches and missing IDs have predictable behavior', async () => {
  const api = await start();
  try {
    for (const name of ['', '   ', null, 42, '测'.repeat(61)]) {
      assert.equal((await api.request('/api/plans', { name, operations })).status, 422);
    }
    const invalid = await api.request('/api/plans', { name: 'bad', operations: [...operations, { symbol: 'A01', side: 'sell', quantity: 999 }] });
    assert.equal(invalid.status, 422);
    assert.deepEqual((await api.request('/api/plans')).body, []);
    assert.equal((await api.request('/api/plans', { name: '空方案', operations: [] })).status, 201);
    assert.equal((await api.request('/api/plans', { name: '空方案', operations: [] })).status, 201);
    assert.equal((await api.request('/api/plans')).body.length, 2);
    assert.equal((await api.request('/api/plans/missing')).status, 404);
    assert.equal((await api.request('/api/unknown')).status, 404);
    assert.equal((await api.request('/api/simulate', {})).status, 422);
    assert.equal((await api.request('/api/simulate', { operations: Array(101).fill(operations[0]) })).status, 422);
  } finally { await api.close(); }
});

test('invalid JSON and oversized requests return JSON errors rather than HTML', async () => {
  const api = await start();
  try {
    for (const [body, status] of [['{', 400], [JSON.stringify({ value: 'x'.repeat(40000) }), 413]] as const) {
      const response = await fetch(api.base + '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(response.status, status);
      assert.ok((await response.json() as any).error.message);
    }
  } finally { await api.close(); }
});

test('real SQLite write failure is reported without changing simulation or original', async () => {
  const api = await start();
  try {
    api.store.db.exec('PRAGMA query_only = ON');
    const failed = await api.request('/api/plans', { name: '无法保存', operations });
    assert.equal(failed.status, 500);
    assert.equal(failed.body.error.code, 'INTERNAL_ERROR');
    assert.deepEqual((await api.request('/api/plans')).body, []);
    assert.equal((await api.request('/api/simulate', { operations })).body.simulated.cash, '25000.00');
    assert.equal((await api.request('/api/portfolio')).body.analysis.cash, '20000.00');
  } finally { await api.close(); }
});
