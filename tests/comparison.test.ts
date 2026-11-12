import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { ComparisonResult } from '../client/PlanLibrary.js';
import { simulate } from '../server/domain.js';
import type { Operation, PlanDetail, Snapshot } from '../shared/types.js';

const snapshot: Snapshot = JSON.parse(readFileSync(new URL('../data/portfolio.json', import.meta.url), 'utf8'));
function plan(id: string, name: string, operations: Operation[], source = snapshot): PlanDetail {
  return { id, name, createdAt: '2026-11-12T10:00:00.000Z', snapshotId: source.snapshot_id,
    operationCount: operations.length, snapshot: source, ...simulate(source, operations) };
}
const reduced = plan('a', '科技减仓', [
  { symbol: 'A01', side: 'sell', quantity: 200 }, { symbol: 'A05', side: 'buy', quantity: 200 },
]);
const increased = plan('b', '科技加仓', [{ symbol: 'A01', side: 'buy', quantity: 200 }]);
function render(left = reduced, right = increased) {
  return renderToStaticMarkup(createElement(ComparisonResult, { plans: [left, right], onClose: () => {} }));
}
function row(html: string, label: string) {
  const result = html.match(/<tr[\s\S]*?<\/tr>/g)?.find(text => text.includes('scope="row"') && text.includes(label));
  assert.ok(result, `missing row ${label}`);
  return result.replace(/<[^>]+>/g, '');
}

test('comparison displays saved-plan facts side by side with clear identities and no ranking', () => {
  const html = render();
  assert.match(html, /科技减仓/); assert.match(html, /科技加仓/);
  assert.match(html, /对比依据一致/);
  assert.match(row(html, '可用现金'), /20,000\.00.*0\.00/);
  assert.match(row(html, '组合总资产'), /100,000\.00.*100,000\.00/);
  assert.match(row(html, '集中度超限'), /0 项.*2 项/);
  assert.match(html, /60\.00%.*30\.00%/);
  assert.match(html, /80\.00%.*50\.00%/);
  assert.match(html, /当前无超限提醒/);
});

test('position and industry arrays align by symbol and industry rather than array index', () => {
  const shuffled = structuredClone(increased);
  shuffled.simulated.positions.reverse(); shuffled.simulated.industries.reverse();
  const html = render(reduced, shuffled);
  assert.match(row(html, 'A01'), /200 股.*20,000\.00.*20\.00%.*600 股.*60,000\.00.*60\.00%/);
  assert.match(row(html, 'data-industry="科技"'), /40,000\.00.*40\.00%.*80,000\.00.*80\.00%/);
});

test('same snapshot ID with changed cash or rules is identified as a different comparison basis', () => {
  const changed = structuredClone(snapshot); changed.cash = '1.00';
  const html = render(reduced, plan('c', '不同输入', [], changed));
  assert.match(html, /快照内容不同/);
  assert.match(html, /不能将差异全部归因于调仓操作/);
  assert.doesNotMatch(html, /对比依据一致/);
  const rules = structuredClone(snapshot); rules.rules.single_instrument_threshold = '0.50';
  assert.match(render(reduced, plan('d', '不同规则', [], rules)), /快照内容不同/);
});

test('missing instruments or industries differ from a fully sold zero position', () => {
  const sold = plan('sold', '清仓A01', [{ symbol: 'A01', side: 'sell', quantity: 400 }]);
  const other = structuredClone(snapshot);
  other.instruments = other.instruments.filter(p => p.symbol !== 'A01' && p.industry !== '能源');
  const html = render(sold, plan('other', '缺少标的', [], other));
  assert.match(row(html, 'A01'), /0 股.*0\.00.*未包含该标的/);
  assert.match(row(html, 'data-industry="能源"'), /3,000\.00.*未包含该行业/);
});

test('duplicate plan names retain A/B identity and names are escaped safely', () => {
  const left = { ...reduced, name: '<script>重复方案</script>' };
  const right = { ...increased, name: left.name };
  const html = render(left, right);
  assert.match(html, /方案 A/); assert.match(html, /方案 B/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
