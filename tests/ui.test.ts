import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import App from '../client/App.js';
import { analyze } from '../server/domain.js';
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
