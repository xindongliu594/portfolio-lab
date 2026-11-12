import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
async function start(workdir = root) {
  service = spawn(process.execPath, ['dist/server/server/index.js'], {
    cwd: workdir, env: { ...process.env, PORT: String(port), PORTFOLIO_DB: join(scratch, 'plans.sqlite') },
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
async function screenshot(page, name) { await page.screenshot({ path: join(screenshots, name), fullPage: !/^(10|11|13)-/.test(name), animations: 'disabled' }); }

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
  await expect(page.locator('.trade-impact')).toContainText('30,000.00');
  await expect(page.locator('.trade-impact')).toContainText('25,000.00');
  await expect(page.locator('.trade-impact')).toContainText('新增 1 项提醒');
  await screenshot(page, '03-simulation-comparison.png');
  checks.push('AC-03: then buy A02 100, cash 25000, industry 55%, two sequential operations');

  await page.getByRole('button', { name: /查看第 1 步/ }).click();
  await expect(page.locator('.history-banner')).toContainText('第 1 步');
  await expect(page.locator('.simulation-summary')).toContainText('30,000.00');
  await expect(page.locator('.risk-banner')).toContainText('无集中度超限');
  await expect(page.locator('.trade-impact')).toContainText('解除 2 项提醒');
  await expect(page.locator('.operation-list li')).toHaveCount(2);
  await expect(page.locator('.trade-form')).toHaveCount(0);
  await expect(page.locator('.save-form')).toHaveCount(0);
  await page.locator('.calculation-details summary').click();
  await expect(page.locator('.calculation-body')).toBeVisible();
  await expect(page.locator('.calculation-body')).toContainText('30,000.00 ÷ 100,000.00');
  await screenshot(page, '09-step-replay-and-basis.png');
  await page.getByRole('button', { name: '查看原始组合', exact: true }).click();
  await expect(page.locator('.simulation-summary')).toContainText('20,000.00');
  await expect(page.locator('.risk-banner')).toContainText('发现 2 项');
  await expect(page.locator('.trade-impact')).toHaveCount(0);
  await page.getByRole('button', { name: '回到最新结果', exact: true }).first().click();
  await expect(page.locator('.simulation-summary')).toContainText('25,000.00');
  await expect(page.locator('.trade-form')).toBeVisible();
  await page.locator('.calculation-details summary').click();
  checks.push('Step replay: original/first/latest synchronize all results, preserve operations and guard draft writes');
  checks.push('Calculation basis: selected-step formulas and strict-threshold rules can be expanded');

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

  await page.getByRole('button', { name: /查看第 1 步/ }).click();
  await expect(page.locator('.simulation-summary')).toContainText('30,000.00');
  await expect(page.locator('.trade-impact')).toContainText('解除 2 项提醒');
  await page.getByRole('button', { name: '回到最新结果', exact: true }).first().click();
  checks.push('Persisted replay: step impacts are regenerated from saved snapshot after service restart');

  const continuation = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  continuation.on('dialog', dialog => dialog.accept());
  try {
    await continuation.goto(url);
    await continuation.getByRole('button', { name: '添加到模拟', exact: true }).click();
    await continuation.getByLabel('交易标的', { exact: true }).selectOption('A02');
    await continuation.getByRole('button', { name: '＋ 买入', exact: true }).click();
    await continuation.getByRole('button', { name: '添加到模拟', exact: true }).click();
    await continuation.getByRole('button', { name: /查看第 1 步/ }).click();
    await continuation.getByRole('button', { name: '回到最新结果', exact: true }).first().click();
    await continuation.getByLabel('交易标的', { exact: true }).selectOption('A03');
    await continuation.getByLabel('交易数量', { exact: true }).fill('10');
    await continuation.getByRole('button', { name: '添加到模拟', exact: true }).click();
    await expect(continuation.locator('.simulation-summary')).toContainText('24,000.00');
    await expect(continuation.locator('.operation-list li')).toHaveCount(3);
    await expect(continuation.locator('.trade-impact')).toContainText('25,000.00');
    checks.push('Continue after replay: third trade starts from latest state, cash 25000 to 24000');
  } finally { await continuation.close(); }

  const ai = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  ai.on('dialog', dialog => dialog.accept());
  ai.on('pageerror', error => consoleErrors.push(error.message));
  try {
    await ai.goto(url);
    await expect(ai.getByRole('button', { name: '打开 AI 助手', exact: true })).toBeVisible({ timeout: 3000 });
    const drawer = ai.getByRole('dialog', { name: 'AI 助手', exact: true });
    const launcher = ai.getByRole('button', { name: '打开 AI 助手', exact: true });
    await expect(drawer).not.toBeVisible();
    await launcher.click();
    await expect(drawer).toBeVisible();
    await drawer.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    const layouts = [];
    for (const width of [320, 360, 390, 600, 601, 640, 768, 800, 801, 980, 1024, 1440]) {
      await ai.setViewportSize({width, height: 844});
      const layout = await drawer.evaluate(el => {
        const r = el.getBoundingClientRect();
        return {width: innerWidth, left: r.left, right: r.right, height: r.height, fits: r.left >= -1 && r.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth};
      });
      expect(layout.fits).toBe(true);
      layouts.push(layout);
    }
    await writeFile(resolve('docs/assistant-layout-verification.json'), JSON.stringify({verifiedAt: new Date().toISOString(), layouts}, null, 2) + '\n');
    await ai.setViewportSize({width: 1440, height: 1050});
    expect(await ai.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await drawer.getByRole('button', { name: '关闭 AI 助手', exact: true }).focus();
    for (let i = 0; i < 14; i++) {
      await ai.keyboard.press('Tab');
      // Native modal focus may pass through browser chrome, but never a background page control.
      expect(await drawer.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
    }
    await ai.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(launcher).toBeFocused();
    expect(await ai.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    await launcher.click();
    await ai.mouse.click(20, 200);
    await expect(drawer).not.toBeVisible();
    await ai.getByRole('button', { name: /已保存方案/ }).click();
    await launcher.click();
    await expect(drawer).toBeVisible();
    await ai.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
    await ai.getByRole('button', { name: '组合分析', exact: true }).click();
    await launcher.click();
    checks.push('Floating assistant: global launcher, right dialog, modal keyboard isolation/focus restore, Escape, backdrop and scroll lock');
    await expect(ai.locator('.demo-mode-banner')).toContainText('本地规则生成');
    await expect(ai.locator('.demo-mode-banner')).toContainText('未接入真实模型');
    await ai.getByRole('button', { name: '查看辅助建议', exact: true }).click();
    await ai.getByRole('button', { name: '生成演示建议', exact: true }).click();
    await expect(ai.locator('.assistant-draft')).toContainText('30,000.00');
    await expect(ai.locator('.assistant-draft')).toContainText('100 股');
    await ai.getByRole('button', { name: '切换到对话问答', exact: true }).click();
    await ai.getByRole('button', { name: '现金和总资产怎么算？', exact: true }).click();
    await expect(ai.locator('.chat-message.assistant')).toHaveCount(1);
    await expect(ai.locator('.chat-message.assistant').last()).toContainText('20000.00');
    for (const followup of ['继续说呢', '具体点呢', '然后呢']) {
      await ai.getByLabel('输入你的问题', { exact: true }).fill(followup);
      await ai.getByRole('button', { name: '发送', exact: true }).click();
      await expect(ai.getByLabel('输入你的问题', { exact: true })).toHaveValue('');
      await expect(ai.locator('.chat-message.assistant').last()).toContainText('20000.00');
    }
    await ai.getByLabel('输入你的问题', { exact: true }).fill('为什么呢？');
    await ai.getByRole('button', { name: '发送', exact: true }).click();
    await expect(ai.locator('.chat-message.assistant')).toHaveCount(5);
    await expect(ai.locator('.chat-message.assistant').last()).toContainText('20000.00');
    await ai.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
    await ai.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
    await expect(ai.locator('.chat-message.assistant')).toHaveCount(5);
    await ai.route('**/api/assistant/chat', route => route.abort());
    await ai.getByLabel('输入你的问题', { exact: true }).fill('当前有哪些超限？');
    await ai.getByRole('button', { name: '发送', exact: true }).click();
    await expect(ai.locator('.assistant-chat [role="alert"]')).toContainText('无法连接');
    await expect(ai.locator('.chat-message.assistant')).toHaveCount(5);
    await ai.unroute('**/api/assistant/chat');
    await ai.getByRole('button', { name: '发送', exact: true }).click();
    await expect(ai.locator('.chat-message.assistant')).toHaveCount(6);
    await ai.getByLabel('输入你的问题', { exact: true }).fill('暂存的问题');
    await ai.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
    await launcher.click();
    await expect(ai.getByLabel('输入你的问题', { exact: true })).toHaveValue('暂存的问题');
    await screenshot(ai, '10-demo-ai-assistant.png');
    await ai.setViewportSize({ width: 390, height: 844 });
    expect(await ai.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(ai.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
    await expect(ai.getByRole('button', { name: '查看辅助建议', exact: true })).toBeInViewport();
    await screenshot(ai, '11-demo-ai-mobile.png');
    await ai.setViewportSize({ width: 1440, height: 1050 });
    checks.push('Demo chat: explicit local-demo label, multi-turn follow-up, navigation retention, network failure and retry');
    checks.push('Demo assistant mobile: suggestion and chat layout fits 390px');
    await ai.getByRole('button', { name: '查看辅助建议', exact: true }).click();
    await ai.getByRole('button', { name: '采用为新模拟', exact: true }).click();
    await expect(ai.locator('.operation-list li')).toHaveCount(1);
    await expect(ai.locator('.simulation-summary')).toContainText('30,000.00');
    await expect(ai.locator('.risk-banner')).toContainText('无集中度超限');
    checks.push('Demo advice: backend-validated sell draft adopted only by explicit click');
    await ai.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
    await expect(ai.locator('.chat-message')).toHaveCount(0);
    await ai.getByRole('button', { name: '查看辅助建议', exact: true }).click();
    await ai.getByRole('button', { name: '生成演示建议', exact: true }).click();
    await expect(ai.locator('.assistant-advice')).toContainText('没有集中度超限');
    await expect(ai.getByRole('button', { name: '采用为新模拟', exact: true })).toHaveCount(0);
    await ai.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
    await ai.getByLabel('交易标的', { exact: true }).selectOption('A02');
    await ai.getByRole('button', { name: '＋ 买入', exact: true }).click();
    await ai.getByRole('button', { name: '添加到模拟', exact: true }).click();
    await expect(ai.locator('.operation-list li')).toHaveCount(2);
    await ai.getByRole('button', { name: '查看原始组合', exact: true }).click();
    await ai.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
    await ai.getByRole('button', { name: '查看辅助建议', exact: true }).click();
    await ai.getByRole('button', { name: '生成演示建议', exact: true }).click();
    ai.removeAllListeners('dialog'); ai.once('dialog', dialog => dialog.dismiss());
    await ai.getByRole('button', { name: '查看辅助建议', exact: true }).click();
    await ai.getByRole('button', { name: '采用为新模拟', exact: true }).click();
    await expect(ai.getByRole('dialog', { name: 'AI 助手', exact: true })).toBeVisible();
    await ai.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
    await expect(ai.locator('.operation-list li')).toHaveCount(2);
    await ai.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
    ai.on('dialog', dialog => dialog.accept());
    await ai.getByRole('button', { name: '查看辅助建议', exact: true }).click();
    await ai.getByRole('button', { name: '采用为新模拟', exact: true }).click();
    await expect(ai.locator('.operation-list li')).toHaveCount(1);
    checks.push('Demo context: data change resets chat; no needless trades; historical adoption protects later unsaved operations');
    await ai.getByLabel('保存当前方案', { exact: true }).fill('演示助手草案');
    await ai.getByRole('button', { name: '保存方案', exact: true }).click();
    await expect(ai.locator('.saved-banner')).toContainText('演示助手草案');
    await ai.reload();
    await ai.getByRole('button', { name: /已保存方案/ }).click();
    await ai.locator('.plan-card').filter({ hasText: '演示助手草案' }).getByRole('button', { name: '重开方案', exact: true }).click();
    await expect(ai.locator('.simulation-summary')).toContainText('30,000.00');
    checks.push('Demo draft persistence: adopted draft can be named, saved and reopened normally');
  } finally { await ai.close(); }

  const comparePage = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  comparePage.on('pageerror', error => consoleErrors.push(error.message));
  try {
    const createPlan = async (name, operations) => {
      const response = await comparePage.request.post(url + '/api/plans', { data: { name, operations } });
      expect(response.status()).toBe(201); return response.json();
    };
    const reduction = await createPlan('对比·科技减仓', [
      { symbol: 'A01', side: 'sell', quantity: 100 }, { symbol: 'A01', side: 'sell', quantity: 100 },
      { symbol: 'A05', side: 'buy', quantity: 100 }, { symbol: 'A05', side: 'buy', quantity: 100 },
    ]);
    const increase = await createPlan('对比·科技加仓', [{ symbol: 'A01', side: 'buy', quantity: 100 }, { symbol: 'A01', side: 'buy', quantity: 100 }]);
    const empty = await createPlan('对比·用于切换选择的空方案', []);
    await comparePage.goto(url);
    await comparePage.getByRole('button', { name: '添加到模拟', exact: true }).click();
    await comparePage.getByRole('button', { name: /已保存方案/ }).click();
    const select = name => comparePage.getByRole('checkbox', { name: `选择${name}用于对比`, exact: true });
    const compare = comparePage.getByRole('button', { name: '对比所选方案', exact: true });
    await expect(compare).toBeDisabled();
    await select(reduction.name).check(); await expect(compare).toBeDisabled();
    await select(increase.name).check(); await expect(compare).toBeEnabled();
    await expect(select(empty.name)).toBeDisabled();
    await comparePage.route(`**/api/plans/${increase.id}`, route => route.abort());
    await compare.click();
    await expect(comparePage.locator('.plans-panel [role="alert"]')).toContainText('无法连接');
    await expect(comparePage.locator('.plan-comparison')).toHaveCount(0);
    await expect(select(reduction.name)).toBeChecked(); await expect(select(increase.name)).toBeChecked();
    await comparePage.unroute(`**/api/plans/${increase.id}`);
    await compare.click();
    const result = comparePage.locator('.plan-comparison');
    await expect(result).toBeVisible();
    await expect(result.locator('.comparison-basis')).toContainText('对比依据一致');
    const cashRow = result.getByRole('row').filter({ has: comparePage.getByRole('rowheader', { name: '可用现金', exact: true }) });
    await expect(cashRow).toContainText('20,000.00'); await expect(cashRow).toContainText('¥0.00');
    const techRow = result.locator('[data-industry="科技"]');
    await expect(techRow).toContainText('40.00%'); await expect(techRow).toContainText('80.00%');
    await expect(result.locator('.comparison-alerts')).toContainText('当前无超限提醒');
    await expect(result.locator('.comparison-alerts')).toContainText('60.00%');
    await screenshot(comparePage, '12-plan-comparison.png');
    const layouts = [];
    for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
      await comparePage.setViewportSize({ width, height: 844 });
      const fits = await comparePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      expect(fits).toBe(true); layouts.push({ width, pageFits: fits });
    }
    await writeFile(resolve('docs/comparison-layout-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), layouts }, null, 2) + '\n');
    await comparePage.setViewportSize({ width: 390, height: 844 });
    await result.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await screenshot(comparePage, '13-plan-comparison-mobile.png');
    await comparePage.setViewportSize({ width: 1440, height: 1050 });
    await comparePage.getByRole('button', { name: '返回选择', exact: true }).click();
    await select(increase.name).uncheck(); await select(empty.name).check();
    await compare.click();
    await expect(result).toContainText(empty.name); await expect(result).not.toContainText(increase.name);
    await comparePage.getByRole('button', { name: '返回选择', exact: true }).click();
    await comparePage.getByRole('button', { name: '清空选择', exact: true }).click();
    await expect(compare).toBeDisabled();
    await comparePage.getByRole('button', { name: '组合分析', exact: true }).click();
    await expect(comparePage.locator('.operation-list li')).toHaveCount(1);
    await expect(comparePage.locator('.simulation-summary')).toContainText('30,000.00');
    await comparePage.getByRole('button', { name: /已保存方案/ }).click();
    comparePage.once('dialog', dialog => dialog.dismiss());
    await comparePage.locator('.plan-card').filter({ hasText: reduction.name }).getByRole('button', { name: '重开方案', exact: true }).click();
    await expect(comparePage.getByRole('heading', { name: '已保存方案', exact: true })).toBeVisible();
    const unchanged = await (await comparePage.request.get(url + '/api/plans/' + reduction.id)).json();
    expect(unchanged.operations).toEqual(reduction.operations);
    checks.push('Plan comparison: two-plan limit, server facts, changed rows, empty alerts, network failure and retry');
    checks.push('Plan comparison state: replacing/clearing selection, original draft retained and saved records unchanged');
    checks.push('Plan comparison responsive: 320-1440px contain horizontal table scrolling');
  } finally { await comparePage.close(); }

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('heading', { name: '投资组合分析', exact: true })).toBeVisible();
  await screenshot(page, '08-mobile.png');
  checks.push('390px viewport: no page-level horizontal overflow; table scroll is contained');

  await stop();
  await cp(join(root, 'dist'), join(scratch, 'dist'), { recursive: true });
  await mkdir(join(scratch, 'data'), { recursive: true });
  const changedSnapshot = JSON.parse(await readFile(join(root, 'data/portfolio.json'), 'utf8'));
  changedSnapshot.snapshot_id = 'NEW-SNAPSHOT'; changedSnapshot.cash = '1.00'; changedSnapshot.instruments[0].price = '999.00';
  await writeFile(join(scratch, 'data/portfolio.json'), JSON.stringify(changedSnapshot));
  await start(scratch);
  const branch = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  branch.on('pageerror', error => consoleErrors.push(error.message)); branch.on('dialog', dialog => dialog.accept());
  try {
    await branch.goto(url);
    await branch.getByRole('button', { name: /已保存方案/ }).click();
    await branch.locator('.plan-card').filter({ hasText: '科技行业调仓 · 验收方案' }).getByRole('button', { name: '重开方案', exact: true }).click();
    await branch.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
    await branch.getByRole('button', { name: '查看辅助建议', exact: true }).click();
    await branch.getByRole('button', { name: '生成演示建议', exact: true }).click();
    await expect(branch.locator('.assistant-draft')).toContainText('30,000.00');
    await branch.getByRole('button', { name: '采用为新模拟', exact: true }).click();
    await expect(branch.locator('.main-stat')).toContainText('100,000.00');
    await expect(branch.locator('.saved-banner')).toContainText('SNAP-20261102');
    await branch.getByLabel('交易标的', { exact: true }).selectOption('A03');
    await branch.getByRole('button', { name: '＋ 买入', exact: true }).click();
    await branch.getByLabel('交易数量', { exact: true }).fill('10');
    await branch.getByRole('button', { name: '添加到模拟', exact: true }).click();
    await expect(branch.locator('.simulation-summary')).toContainText('29,000.00');
    await branch.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
    await branch.getByRole('button', { name: '现金和总资产怎么算？', exact: true }).click();
    await expect(branch.locator('.chat-message.assistant').last()).toContainText('29000.00');
    await expect(branch.locator('.assistant-context')).toContainText('SNAP-20261102');
    await branch.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
    await branch.getByLabel('保存当前方案', { exact: true }).fill('旧快照分支');
    await branch.getByRole('button', { name: '保存方案', exact: true }).click();
    await branch.reload();
    await branch.getByRole('button', { name: /已保存方案/ }).click();
    await branch.locator('.plan-card').filter({ hasText: '旧快照分支' }).getByRole('button', { name: '重开方案', exact: true }).click();
    await expect(branch.locator('.simulation-summary')).toContainText('29,000.00');
    await expect(branch.locator('.main-stat')).toContainText('100,000.00');
    expect((await (await fetch(url + '/api/portfolio')).json()).snapshot.snapshot_id).toBe('NEW-SNAPSHOT');
    checks.push('Saved-snapshot branch: old-plan adoption, more trades, chat, save and reopen retain old snapshot despite changed seed');
    const newPlan = await branch.request.post(url + '/api/plans', { data: { name: '对比·新快照', operations: [] } });
    expect(newPlan.status()).toBe(201);
    await branch.getByRole('button', { name: /已保存方案/ }).click();
    await branch.getByRole('button', { name: '刷新列表', exact: true }).click();
    await branch.getByRole('checkbox', { name: '选择旧快照分支用于对比', exact: true }).check();
    await branch.getByRole('checkbox', { name: '选择对比·新快照用于对比', exact: true }).check();
    await branch.getByRole('button', { name: '对比所选方案', exact: true }).click();
    await expect(branch.locator('.comparison-basis')).toContainText('快照内容不同');
    await expect(branch.locator('.comparison-sources')).toContainText('NEW-SNAPSHOT');
    await expect(branch.locator('.comparison-sources')).toContainText('SNAP-20261102');
    checks.push('Plan comparison snapshot isolation: different saved bases display explicit warning and each snapshot identity');
  } finally { await branch.close(); }
  expect(consoleErrors).toEqual([]);
  const report = { verifiedAt: new Date().toISOString(), node: process.version, browser: await browser.version(), viewport: [1440, 1100], checks, pageErrors: consoleErrors };
  await writeFile(resolve('docs/browser-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close(); await stop();
  if (!scratch.startsWith(resolve('.runtime') + '\\') && !scratch.startsWith(resolve('.runtime') + '/')) throw new Error('Unexpected scratch path');
  await rm(scratch, { recursive: true, force: true });
}
