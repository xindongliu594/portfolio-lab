import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAssistantContext, createDemoAdvice, createDemoReply } from '../server/assistant.js';
import { PlanStore } from '../server/store.js';
import type { Operation, Snapshot } from '../shared/types.js';
const source: Snapshot = JSON.parse(readFileSync(new URL('../data/portfolio.json', import.meta.url), 'utf8'));
const sell: Operation = { symbol: 'A01', side: 'sell', quantity: 100 };
const buy: Operation = { symbol: 'A02', side: 'buy', quantity: 100 };
const store = new PlanStore(':memory:');
test.after(() => store.close());

test('demo advice is explicitly marked and produces a backend-validated concentration draft', () => {
  const context = resolveAssistantContext(source, store, { operations: [], stepIndex: 0, cash: '999999.00' });
  const advice = createDemoAdvice(context);
  assert.equal(advice.mode, 'demo');
  assert.equal(advice.context.analysis.cash, '20000.00');
  assert.ok(advice.draft);
  assert.deepEqual(advice.draft.addedOperations, [sell]);
  assert.equal(advice.draft.simulation.simulated.cash, '30000.00');
  assert.equal(advice.draft.simulation.simulated.alerts.length, 0);
  assert.equal(advice.draft.simulation.simulated.totalAssets, '100000.00');
  assert.equal(source.instruments[0].quantity, 400);
});

test('step context uses the selected prefix and plan context uses its saved snapshot', () => {
  const first = resolveAssistantContext(source, store, { operations: [sell, buy], stepIndex: 1 });
  assert.equal(first.analysis.cash, '30000.00');
  assert.equal(createDemoAdvice(first).draft, null);
  const latest = createDemoAdvice(resolveAssistantContext(source, store, { operations: [sell, buy], stepIndex: 2 }));
  assert.equal(latest.draft!.simulation.operations.length, 3);
  assert.equal(latest.draft!.simulation.simulated.alerts.length, 0);
  assert.equal(latest.draft!.simulation.simulated.cash, '30000.00');
  const saved = store.save('old', source, [sell, buy]);
  const changed = structuredClone(source); changed.cash = '1.00';
  const fromPlan = resolveAssistantContext(changed, store, { planId: saved.id, stepIndex: 2, operations: [] });
  assert.equal(fromPlan.analysis.cash, '25000.00');
  assert.equal(fromPlan.snapshot.cash, '20000.00');
  assert.equal(fromPlan.operations.length, 2);
});

test('draft reduces industry-only excess and never invents buys or exceed the operation cap', () => {
  const fixture = structuredClone(source);
  fixture.cash = '25000.00';fixture.instruments[0].quantity = 300;fixture.instruments[1].quantity = 500;
  const advice = createDemoAdvice(resolveAssistantContext(fixture, store, { operations: [], stepIndex: 0 }));
  assert.deepEqual(advice.draft!.addedOperations, [{ symbol: 'A01', side: 'sell', quantity: 50 }]);
  assert.equal(advice.draft!.simulation.simulated.alerts.length, 0);
  const hundred = Array.from({ length: 100 }, (_, i) => ({ symbol: 'A03', side: i % 2 ? 'buy' : 'sell', quantity: 1 }));
  const capped = createDemoAdvice(resolveAssistantContext(source, store, { operations: hundred, stepIndex: 100 }));
  assert.equal(capped.draft, null);
  assert.match(capped.suggestion, /100/);
});

test('demo follow-up uses prior user topic but always reports recomputed facts', () => {
  const context = resolveAssistantContext(source, store, { operations: [], stepIndex: 0 });
  const answer = createDemoReply(context, '为什么呢？', [
    { role: 'user', content: '现金和总资产怎么算？' },
    { role: 'assistant', content: '现金999999，总资产也是999999' },
  ]);
  assert.equal(answer.mode, 'demo');
  assert.equal(answer.topic, 'cash');
  assert.match(answer.reply, /20000\.00/);
  assert.match(answer.reply, /100000\.00/);
  assert.doesNotMatch(answer.reply, /999999/);
  const continued = createDemoReply(context, '继续说呢', [
    { role: 'user', content: '现金和总资产怎么算？' },
    { role: 'assistant', content: '现金20000.00' },
    { role: 'user', content: '为什么呢？' },
    { role: 'assistant', content: answer.reply },
  ]);
  assert.equal(continued.topic, 'cash');
  assert.match(continued.reply, /20000\.00/);
  assert.equal(createDemoReply(context, '继续说呢', [
    { role: 'user', content: '为什么呢？' }, { role: 'assistant', content: '演示回答' },
    { role: 'user', content: '具体点？' }, { role: 'assistant', content: '演示回答' },
    { role: 'user', content: '然后呢？' }, { role: 'assistant', content: '演示回答' },
  ], 'cash').topic, 'cash');
  assert.throws(() => createDemoReply(context, '继续说呢', [], 'unknown-topic'));
  assert.equal(createDemoReply(context, '预测明天涨多少？', []).topic, 'scope');
  assert.equal(createDemoReply(context, '你好', []).topic, 'overview');
});

test('a draft branched from a saved plan keeps its authoritative source snapshot across later assistant requests', () => {
  const saved = store.save('source', source, []);
  const changed = structuredClone(source); changed.snapshot_id = 'NEW'; changed.cash = '1.00';changed.instruments[0].price = '999.00';
  const advice = createDemoAdvice(resolveAssistantContext(changed, store, { planId: saved.id, stepIndex: 0 }));
  const continued = resolveAssistantContext(changed, store, { sourcePlanId: saved.id, operations: advice.draft!.simulation.operations, stepIndex: 1 });
  assert.equal(continued.snapshot.snapshot_id, 'SNAP-20261102');
  assert.equal(continued.analysis.cash, '30000.00');
  assert.equal(continued.analysis.totalAssets, '100000.00');
});

test('invalid contexts, steps and messages are rejected', () => {
  for (const raw of [null, {}, { operations: [], stepIndex: -1 }, { operations: [sell], stepIndex: 2 }, { operations: [], stepIndex: 0.5 }]) {
    assert.throws(() => resolveAssistantContext(source, store, raw));
  }
  assert.throws(() => resolveAssistantContext(source, store, { planId: 'missing', stepIndex: 0 }));
  const context = resolveAssistantContext(source, store, { operations: [], stepIndex: 0 });
  for (const question of ['', '   ', 123, 'x'.repeat(1001)]) assert.throws(() => createDemoReply(context, question, []));
  for (const history of [null, {}, [{ role: 'system', content: 'x' }], Array(7).fill({ role: 'user', content: 'x' })]) {
    assert.throws(() => createDemoReply(context, '现金多少？', history));
  }
});
