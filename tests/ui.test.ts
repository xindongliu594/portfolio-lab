import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import App from '../client/App.js';
import { analyze, simulate } from '../server/domain.js';
import { TradeImpact, StepTimeline, CalculationDetails } from '../client/StepInsights.js';
import AiAssistant from '../client/AiAssistant.js';
import type { Snapshot } from '../shared/types.js';

test('workspace presents the supplied portfolio, trading form and initial empty state', () => {
  const snapshot: Snapshot = JSON.parse(readFileSync(new URL('../data/portfolio.json', import.meta.url), 'utf8'));
  const html = renderToStaticMarkup(createElement(App, { initial: { snapshot, analysis: analyze(snapshot) } }));
  assert.match(html, /100,000\.00/);
  assert.match(html, /星河科技/);
  assert.match(html, /调仓模拟/);
  assert.match(html, /交易数量/);
  assert.match(html, /还没有添加操作/);
  assert.match(html, /40\.00%/);
  assert.match(html, /60\.00%/);
});

test('initial loading exposes an accessible status', () => {
  assert.match(renderToStaticMarkup(createElement(App)), /role="status"/);
});

const snapshot: Snapshot = JSON.parse(readFileSync(new URL('../data/portfolio.json', import.meta.url), 'utf8'));
const replay = simulate(snapshot, [{ symbol: 'A01', side: 'sell', quantity: 100 }, { symbol: 'A02', side: 'buy', quantity: 100 }]);

test('trade impact presents server cash, position and industry transitions and resolved alerts', () => {
  const html = renderToStaticMarkup(createElement(TradeImpact, { step: replay.steps[0]! }));
  const text = html.replace(/<[^>]+>/g, '');
  assert.match(text, /20,000\.00.*30,000\.00/);
  assert.match(text, /星河科技/);
  assert.match(text, /40\.00%.*30\.00%/);
  assert.match(text, /60\.00%.*50\.00%/);
  assert.match(text, /解除 2 项提醒/);
});

test('timeline exposes original and every step as selectable controls without dropping later steps', () => {
  const html = renderToStaticMarkup(createElement(StepTimeline, { steps: replay.steps, selectedIndex: 1, onSelect: () => {}, disabled: false }));
  assert.match(html, /查看原始组合/);
  assert.match(html, /查看第 1 步/);
  assert.match(html, /查看第 2 步/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(html, /0 项超限/);
  assert.match(html, /1 项超限/);
});

test('calculation disclosure shows selected analysis values with cash denominator and strict threshold', () => {
  const html = renderToStaticMarkup(createElement(CalculationDetails, { analysis: replay.steps[0]!.analysis }));
  const text = html.replace(/<[^>]+>/g, '');
  assert.match(html, /<details/);
  assert.match(text, /100\.00 × 300.*30,000\.00/);
  assert.match(text, /30,000\.00 ÷ 100,000\.00/);
  assert.match(text, /现金计入总资产/);
  assert.match(text, /严格大于/);
});

test('assistant UI clearly labels demo mode and provides suggestion and conversation controls', () => {
  const html = renderToStaticMarkup(createElement(AiAssistant, { context: { operations: [], stepIndex: 0 }, analysis: analyze(snapshot), sourceName: '演示组合', snapshotId: snapshot.snapshot_id, onAdopt: () => {} }));
  const text = html.replace(/<[^>]+>/g, '');
  assert.match(text, /演示模式/);
  assert.match(text, /本地规则生成/);
  assert.match(text, /未接入真实模型/);
  assert.match(text, /辅助建议/);
  assert.match(text, /对话问答/);
  assert.match(text, /100,000\.00/);
  assert.match(html, /textarea/);
  assert.match(text, /生成演示建议/);
});
