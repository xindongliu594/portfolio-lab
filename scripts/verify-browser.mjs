import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve('.');
await mkdir(resolve('.runtime'), { recursive: true });
const scratch = await mkdtemp(resolve('.runtime/browser-check-'));
const screenshots = resolve('docs/screenshots');
await mkdir(screenshots, { recursive: true });
const port = 3117;
const url = `http://127.0.0.1:${port}`;
let service;
let browser;
const checks = [];
const consoleErrors = [];
async function start() {
  service = spawn(process.execPath, ['dist/server/server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), PORTFOLIO_DB: join(scratch, 'plans.sqlite') },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  service.stdout.on('data', data => { output += data; });
  service.stderr.on('data', data => { output += data; });
  for (let i = 0; i < 100; i++) {
    if (service.exitCode !== null) throw new Error(`Server failed: ${output}`);
    try { if ((await fetch(url + '/api/portfolio')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Server did not start: ${output}`);
}
async function stop() {
  if (!service || service.exitCode !== null) return;
  const exited = once(service, 'exit'); service.kill(); await exited;
}
async function screenshot(page, name) { await page.screenshot({ path: join(screenshots, name), fullPage: true }); }

try {
  await start();
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '投资组合分析', exact: true })).toBeVisible();
  await expect(page.locator('.main-stat')).toContainText('100,000.00');
  await expect(page.locator('.risk-banner')).toContainText('发现 2 项');
  await expect(page.locator('.risk-banner')).toContainText('40.00%');
  await expect(page.locator('.risk-banner')).toContainText('60.00%');
  await screenshot(page, '01-initial-portfolio.png');
  checks.push('AC-01: initial 100000/20000, 40%/60%, two warnings');

  await page.getByRole('button', { name: '添加到模拟', exact: true }).click();
  await expect(page.locator('.risk-banner')).toContainText('无集中度超限');
  await expect(page.locator('.simulation-summary')).toContainText('30,000.00');
  await screenshot(page, '02-threshold-boundary.png');
  checks.push('AC-02: sell A01 100, cash 30000, equality removes both warnings');

  await page.getByLabel('交易标的', { exact: true }).selectOption('A02');
  await page.getByRole('button', { name: '＋ 买入', exact: true }).click();
  await page.getByRole('button', { name: '添加到模拟', exact: true }).click();
  await expect(page.locator('.operation-list li')).toHaveCount(2);
  await expect(page.locator('.simulation-summary')).toContainText('25,000.00');
  await expect(page.locator('.risk-banner')).toContainText('55.00%');
  await screenshot(page, '03-simulation-comparison.png');
  checks.push('AC-03: then buy A02 100, cash 25000, industry 55%, two sequential operations');

  await page.getByLabel('交易数量', { exact: true }).fill('1000');
  await page.getByRole('button', { name: '添加到模拟', exact: true }).click();
  await expect(page.locator('.trade-form [role="alert"]')).toContainText('现金不足');
  await expect(page.locator('.operation-list li')).toHaveCount(2);
  await expect(page.locator('.simulation-summary')).toContainText('25,000.00');
  await screenshot(page, '04-error-feedback.png');
  for (const value of ['0', '-1', '0.5']) {
    await page.getByLabel('交易数量', { exact: true }).fill(value);
    await page.getByRole('button', { name: '添加到模拟', exact: true }).click();
    await expect(page.locator('.trade-form [role="alert"]')).toContainText('正整数');
    await expect(page.locator('.operation-list li')).toHaveCount(2);
  }
  checks.push('AC-04 UI: insufficient cash and zero/negative/fraction rejected; last valid simulation retained');

  await page.route('**/api/simulate', route => route.abort());
  await page.getByLabel('交易数量', { exact: true }).fill('100');
  await page.getByRole('button', { name: '添加到模拟', exact: true }).click();
  await expect(page.locator('.trade-form [role="alert"]')).toContainText('无法连接');
  await expect(page.locator('.operation-list li')).toHaveCount(2);
  await expect(page.locator('.simulation-summary')).toContainText('25,000.00');
  await page.unroute('**/api/simulate');
  checks.push('Network failure: clear Chinese error, last valid operations and result retained');

  page.removeAllListeners('dialog');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '新建模拟', exact: true }).click();
  await expect(page.locator('.operation-list li')).toHaveCount(2);
  page.on('dialog', dialog => dialog.accept());
  checks.push('Unsaved draft: dismissing discard confirmation keeps operations');

  await page.route('**/api/plans', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  await page.getByLabel('保存当前方案', { exact: true }).fill('科技行业调仓 · 验收方案');
  await page.getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(page.locator('.save-form [role="alert"]')).toContainText('无法连接');
  await expect(page.locator('.operation-list li')).toHaveCount(2);
  await expect(page.locator('.readonly-box')).toHaveCount(0);
  await page.unroute('**/api/plans');
  checks.push('Failed save: draft retained and still editable, retry succeeds');

  await page.getByLabel('保存当前方案', { exact: true }).fill('科技行业调仓 · 验收方案');
  await page.getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(page.locator('.saved-banner')).toContainText('科技行业调仓');
  await expect(page.locator('.readonly-box')).toBeVisible();
  await screenshot(page, '05-saved-plan.png');
  await page.reload();
  await page.getByRole('button', { name: /已保存方案/ }).click();
  await expect(page.locator('.plan-card')).toHaveCount(1);
  await screenshot(page, '06-plan-library.png');
  await page.getByRole('button', { name: '重开方案', exact: true }).click();
  await expect(page.locator('.simulation-summary')).toContainText('25,000.00');
  await expect(page.locator('.risk-banner')).toContainText('55.00%');
  checks.push('AC-05 refresh: saved plan can be reopened with the same result');

  await stop(); await start();
  await page.reload();
  await page.getByRole('button', { name: /已保存方案/ }).click();
  await page.getByRole('button', { name: '重开方案', exact: true }).click();
  await expect(page.locator('.saved-banner')).toContainText('科技行业调仓');
  await expect(page.locator('.simulation-summary')).toContainText('25,000.00');
  await expect(page.locator('.operation-list li')).toHaveCount(2);
  const original = await (await fetch(url + '/api/portfolio')).json();
  expect(original.analysis.cash).toBe('20000.00');
  expect(original.analysis.positions[0].quantity).toBe(400);
  expect(original.analysis.positions[1].quantity).toBe(400);
  await screenshot(page, '07-reopened-after-restart.png');
  checks.push('AC-05 restart: real production server restarted, persisted plan restored, original unchanged');

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('heading', { name: '投资组合分析', exact: true })).toBeVisible();
  await screenshot(page, '08-mobile.png');
  checks.push('390px viewport: no page-level horizontal overflow; table scroll is contained');
  expect(consoleErrors).toEqual([]);
  const report = { verifiedAt: new Date().toISOString(), node: process.version, browser: await browser.version(), viewport: [1440, 1100], checks, pageErrors: consoleErrors };
  await writeFile(resolve('docs/browser-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close(); await stop();
  if (!scratch.startsWith(resolve('.runtime') + '\\') && !scratch.startsWith(resolve('.runtime') + '/')) throw new Error('Unexpected scratch path');
  await rm(scratch, { recursive: true, force: true });
}
