import { useEffect, useState, type FormEvent } from 'react';
import type { Analysis, ApiError, Operation, PlanDetail, PlanSummary, PortfolioResponse, Simulation } from '../shared/types.js';

const money = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));
const colors = ['#3262d6', '#6387cd', '#8da8d5', '#acbedc', '#c5d2e8'];

function Icon({ name }: { name: 'chart' | 'folder' | 'plus' | 'arrow' | 'save' | 'reset' | 'check' | 'alert' }) {
  const paths = {
    chart: 'M4 19h16M7 15v-4m5 4V5m5 10V8', folder: 'M3 7h7l2 2h9v10H3V7zm0 0V4h7l2 3',
    plus: 'M12 5v14M5 12h14', arrow: 'M5 12h14m-5-5 5 5-5 5', save: 'M5 3h12l3 3v15H4V3h1zm3 0v6h8V3M8 21v-8h8v8',
    reset: 'M4 10a8 8 0 1 1 1 8M4 4v6h6', check: 'm5 12 4 4L19 6', alert: 'M12 8v5m0 4h.01M12 3 2 21h20L12 3z',
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => { throw new Error('无法连接本地服务，请确认服务已启动后重试；当前模拟结果已保留。'); });
  const data = await response.json().catch(() => { throw new Error('服务返回了无法识别的数据，请稍后重试；当前模拟结果已保留。'); });
  if (!response.ok) {
    const detail = (data as ApiError).error;
    const prefix = detail.operationIndex === undefined ? '' : `第 ${detail.operationIndex + 1} 笔操作：`;
    throw new Error(prefix + (detail.message || '请求失败，请稍后重试。'));
  }
  return data as T;
}

function ErrorBox({ message }: { message: string }) {
  return message ? <div className="error-box" role="alert"><Icon name="alert" /><span>{message}</span></div> : null;
}

function Alerts({ analysis }: { analysis: Analysis }) {
  return <div className={`risk-banner ${analysis.alerts.length ? 'warning' : 'clear'}`}>
    <span className="risk-symbol"><Icon name={analysis.alerts.length ? 'alert' : 'check'} /></span>
    <div><strong>{analysis.alerts.length ? `发现 ${analysis.alerts.length} 项集中度超限` : '当前组合无集中度超限'}</strong>
      <p>{analysis.alerts.length ? analysis.alerts.map(a => `${a.name} ${a.percentage}%（阈值 ${a.threshold}%）`).join('；') : '所有标的与行业占比均在阈值内；等于阈值不触发提醒。'}</p>
    </div><span className="risk-note">集中度检查</span>
  </div>;
}

function Comparison({ original, current, enabled }: { original: Analysis; current: Analysis; enabled: boolean }) {
  return <div className="table-scroll"><table className={`positions ${enabled ? 'comparing' : ''}`}>
    <caption className="sr-only">{enabled ? '原始与模拟持仓对比' : '原始组合持仓明细'}</caption>
    <thead><tr><th>标的 / 行业</th><th>快照价格</th><th>持仓数量{enabled && <small>原始 → 模拟</small>}</th><th>市值（元）{enabled && <small>原始 → 模拟</small>}</th><th>资产占比{enabled && <small>原始 → 模拟</small>}</th><th>集中度</th></tr></thead>
    <tbody>{current.positions.map((p, i) => {
      const before = original.positions[i]!;
      return <tr key={p.symbol} className={enabled && before.quantity !== p.quantity ? 'position-changed' : ''}><td><div className="stock-cell"><span className="stock-avatar">{p.symbol.slice(1)}</span><span><strong>{p.name}</strong><small>{p.symbol}<span className="dot-separator">·</span>{p.industry}</small></span></div></td>
        <td className="num">{money(p.price)}</td>
        <td className="num">{enabled && <small className={before.quantity !== p.quantity ? 'changed-before' : ''}>{before.quantity.toLocaleString('en-US')} →</small>}<span className={before.quantity !== p.quantity ? 'changed' : ''}>{p.quantity.toLocaleString('en-US')}</span></td>
        <td className="num">{enabled && <small>{money(before.marketValue)} →</small>}{money(p.marketValue)}</td>
        <td className="num"><div>{enabled && <small>{before.percentage}% →</small>}{p.percentage}%</div><div className="mini-bar"><span style={{ width: `${p.percentage}%`, background: p.exceeded ? '#b57924' : '#3262d6' }} /></div></td>
        <td><span className={`status-tag ${p.exceeded ? 'amber' : ''}`}>{p.exceeded ? '超过 30%' : '阈值内'}</span></td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export default function App({ initial }: { initial?: PortfolioResponse }) {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(initial ?? null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [activePlan, setActivePlan] = useState<PlanDetail | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [tab, setTab] = useState<'workspace' | 'plans'>('workspace');
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [plansError, setPlansError] = useState('');
  const [tradeError, setTradeError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [symbol, setSymbol] = useState('A01');
  const [side, setSide] = useState<Operation['side']>('sell');
  const [quantity, setQuantity] = useState('100');
  const [name, setName] = useState('');
  const operations = simulation?.operations ?? [];
  const dirty = !activePlan && operations.length > 0;

  useEffect(() => {
    let cancelled = false;
    if (!initial) request<PortfolioResponse>('/portfolio').then(data => { if (!cancelled) setPortfolio(data); })
      .catch(() => { if (!cancelled) setLoadError('暂时无法连接本地服务，请确认后端已启动后重试。'); });
    request<PlanSummary[]>('/plans').then(data => { if (!cancelled) setPlans(data); })
      .catch(() => { if (!cancelled) setPlansError('方案列表加载失败，请重试。'); });
    return () => { cancelled = true; };
  }, [initial]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function canLeave() { return !dirty || window.confirm('当前模拟尚未保存，继续将放弃这些操作。是否继续？'); }
  function newDraft() {
    if (!canLeave()) return;
    setSimulation(null); setActivePlan(null); setName(''); setTradeError(''); setSaveError(''); setNotice(''); setTab('workspace');
  }
  async function refreshPlans() {
    setPlansError('');
    try { setPlans(await request<PlanSummary[]>('/plans')); } catch { setPlansError('方案列表加载失败，请重试。'); }
  }
  async function addTrade(event: FormEvent) {
    event.preventDefault(); setTradeError(''); setNotice('');
    if (!/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) {
      setTradeError('交易数量必须为正整数，不支持零、负数、小数或超大数值。'); return;
    }
    setBusy('simulate');
    try {
      const result = await request<Simulation>('/simulate', { operations: [...operations, { symbol, side, quantity: Number(quantity) }] });
      setSimulation(result); setNotice(`第 ${result.operations.length} 笔操作已加入，模拟结果已更新。`);
    } catch (error) { setTradeError(error instanceof Error ? error.message : '操作失败，请重试。'); }
    finally { setBusy(''); }
  }
  async function savePlan(event: FormEvent) {
    event.preventDefault(); setSaveError(''); setNotice('');
    if (!name.trim() || [...name.trim()].length > 60) { setSaveError('请输入 1～60 个字符的方案名称。'); return; }
    setBusy('save');
    try {
      const saved = await request<PlanDetail>('/plans', { name, operations });
      setActivePlan(saved); setSimulation(saved); setName(saved.name); setNotice(`“${saved.name}”已保存，刷新或重启后仍可重开。`);
      await refreshPlans();
    } catch (error) { setSaveError(error instanceof Error ? error.message : '保存失败，请重试。'); }
    finally { setBusy(''); }
  }
  async function openPlan(id: string) {
    if (!canLeave()) return;
    setBusy('open'); setPlansError('');
    try {
      const plan = await request<PlanDetail>(`/plans/${encodeURIComponent(id)}`);
      setActivePlan(plan); setSimulation(plan); setName(plan.name); setTradeError(''); setSaveError(''); setNotice('已按保存时的行情快照重新计算此方案。'); setTab('workspace');
    } catch (error) { setPlansError(error instanceof Error ? error.message : '重开失败，请重试。'); }
    finally { setBusy(''); }
  }

  const current = simulation?.simulated ?? portfolio?.analysis;
  const original = simulation?.original ?? portfolio?.analysis;
  const snapshot = activePlan?.snapshot ?? portfolio?.snapshot;
  const selected = current?.positions.find(p => p.symbol === symbol);
  const compared = operations.length > 0;

  return <div className="app-shell">
    <header className="app-header"><div className="header-inner">
      <a href="/" className="brand" onClick={e => { e.preventDefault(); setTab('workspace'); }}><span className="brand-icon"><Icon name="chart" /></span><span>持仓研究室<small>PORTFOLIO LAB</small></span></a>
      <nav aria-label="主导航"><button disabled={!!busy} className={tab === 'workspace' ? 'nav-active' : ''} onClick={() => setTab('workspace')}><Icon name="chart" />组合分析</button><button disabled={!!busy} className={tab === 'plans' ? 'nav-active' : ''} onClick={() => setTab('plans')}><Icon name="folder" />已保存方案<span className="nav-count">{plans.length}</span></button></nav>
      <div className="local-status"><span />本地工作台</div>
    </div></header>

    <main className="page-main">
      {!portfolio || !current || !original || !snapshot ? <section className="panel loading-panel" role="status">
        {loadError ? <><ErrorBox message={loadError} /><button className="primary" onClick={() => window.location.reload()}>重新连接</button></> : <><span className="spinner" />正在载入投资组合…</>}
      </section> : <>
        <div className="breadcrumb">研究工作台<span>/</span>{tab === 'workspace' ? '组合分析' : '方案管理'}</div>
        <div className="page-heading"><div><h1>{tab === 'workspace' ? '投资组合分析' : '已保存方案'}</h1><p>{tab === 'workspace' ? '基于固定行情，查看集中度并对比调仓前后的变化。' : '查看保存在本机的调仓方案，重开并复核模拟结果。'}</p></div><button className="secondary" disabled={!!busy} onClick={newDraft}><Icon name="plus" />新建模拟</button></div>

        {tab === 'plans' ? <section className="panel plans-panel">
          <div className="section-heading"><div><h2>方案档案 <span className="subtle-count">{plans.length}</span></h2><p>保存在本机，可在刷新页面和重启服务后重新打开。</p></div><button className="text-button" onClick={refreshPlans} disabled={!!busy}>刷新列表</button></div>
          <ErrorBox message={plansError} />
          {!plans.length ? <div className="empty-state"><span className="empty-icon"><Icon name="folder" /></span><h3>还没有保存的方案</h3><p>完成模拟后，为方案命名并保存，就能在这里重新打开。</p><button className="secondary" onClick={() => setTab('workspace')}>开始模拟<Icon name="arrow" /></button></div> : <div className="plan-grid">{plans.map(plan => <article className="plan-card" key={plan.id}><div className="plan-card-top"><span className="file-icon"><Icon name="folder" /></span><span className="status-tag">已保存</span></div><h3>{plan.name}</h3><p>{plan.operationCount} 笔操作 <span>·</span> {plan.snapshotId}</p><div className="plan-card-bottom"><small>{time(plan.createdAt)}</small><button className="text-button" disabled={!!busy} onClick={() => openPlan(plan.id)}>重开方案<Icon name="arrow" /></button></div></article>)}</div>}
        </section> : <>
          <div className="snapshot-line"><span className="snapshot-name">{snapshot.name}<span className="portfolio-id">{snapshot.portfolio_id}</span></span><span><span className="snapshot-dot" />固定行情快照 <time>{time(snapshot.snapshot_at)}（北京时间）</time></span><span className="currency-label">CNY / 人民币</span></div>
          <section className="stats-grid" aria-label="资产摘要">
            <article className="stat-card main-stat"><div className="stat-label">组合总资产 <span>人民币</span></div><div className="stat-value"><small>¥</small>{money(current.totalAssets)}</div><p>{compared ? '模拟前后总资产不变' : '股票市值 + 现金余额'}<span className="tiny-dot" />固定价格 / 无费用</p></article>
            <article className="stat-card"><div className="stat-label">可用现金<span className="stat-glyph">¥</span></div><div className="stat-value"><small>¥</small>{money(current.cash)}</div><p>{compared ? `原始 ¥${money(original.cash)}` : `总资产占比 ${current.cashPercentage}%`}</p></article>
            <article className="stat-card"><div className="stat-label">持仓标的<Icon name="chart" /></div><div className="stat-value">{current.positionCount}<small className="unit">只</small></div><p>覆盖 {current.industries.filter(x => x.marketValue !== '0.00').length} 个行业</p></article>
            <article className="stat-card"><div className="stat-label">集中度超限<Icon name="alert" /></div><div className={`stat-value ${current.alerts.length ? 'amber-text' : 'green-text'}`}>{current.alerts.length}<small className="unit">项</small></div><p>单标的 &gt;30% / 行业 &gt;50%</p></article>
          </section>

          {activePlan && <div className="saved-banner"><Icon name="check" /><span>正在查看已保存方案：<strong>{activePlan.name}</strong> · {time(activePlan.createdAt)}</span><span className="status-tag">只读</span></div>}
          <div className="notice-slot" role="status" aria-live="polite">{notice && <span><Icon name="check" />{notice}</span>}</div>

          <div className="workspace-grid"><div className="analysis-column">
            <section className="panel holdings-panel"><div className="section-heading"><div><h2>{compared ? '调仓前后对比' : '组合持仓'}<span className="subtle-count">{snapshot.instruments.length}</span></h2><p>{compared ? '每项数据依次展示原始值与模拟值。' : '基于同一行情快照计算，现金计入总资产。'}</p></div><span className={`view-badge ${compared ? 'blue' : ''}`}>{compared ? '模拟结果' : '原始组合'}</span></div>
              <div className="alerts-wrap"><Alerts analysis={current} /></div>
              <Comparison original={original} current={current} enabled={compared} />
              <div className="holdings-footer"><span className="legend-dot" />{compared ? '浅蓝色标记本次发生变化的持仓' : '占比以总资产为分母，包含现金'}<span>金额单位：人民币元</span></div>
            </section>

            <section className="panel industry-panel"><div className="section-heading"><div><h2>行业分布</h2><p>行业集中度阈值为 50%，现金不归入任何行业。</p></div><span className="view-badge">{current.industries.length} 个行业</span></div>
              <div className="industry-content"><div className="allocation-strip" aria-hidden="true">{current.industries.map((x, i) => <span key={x.industry} style={{ width: `${x.percentage}%`, background: colors[i % colors.length] }} />)}<span style={{ width: `${current.cashPercentage}%`, background: '#eceef1' }} /></div>
                <div className="industry-list">{current.industries.map((x, i) => <div className="industry-row" key={x.industry}><span className="industry-label"><i style={{ background: colors[i % colors.length] }} />{x.industry}</span><div className="industry-track"><span style={{ width: `${x.percentage}%`, background: colors[i % colors.length] }} /><span className="threshold-mark" /></div><div className="industry-ratio">{compared && <small>{original.industries.find(y => y.industry === x.industry)?.percentage}% → </small>}<strong className={x.exceeded ? 'amber-text' : ''}>{x.percentage}%</strong></div><span className={`industry-state ${x.exceeded ? 'amber-text' : ''}`}>{x.exceeded ? '超限' : '正常'}</span></div>)}
                  <div className="cash-row"><span><i />现金</span><strong>{current.cashPercentage}%</strong><small>计入总资产，独立于行业</small></div>
                </div>
              </div>
            </section>
            <div className="method-note"><Icon name="check" /><p>计算口径：现金计入总资产；占比严格大于阈值时提醒。此处仅检查集中度，所有数据均为虚构测评数据。</p></div>
          </div>

          <aside className="simulation-column"><section className="panel trade-panel"><div className="section-heading"><div><h2><span className="section-icon"><Icon name="chart" /></span>调仓模拟</h2><p>{activePlan ? '此方案已保存，结果为只读。' : '按顺序添加买卖，预览组合变化。'}</p></div><span className="status-tag blue">{activePlan ? '已保存' : '草稿'}</span></div>
            {activePlan ? <div className="readonly-box"><Icon name="check" /><strong>方案已持久保存</strong><p>原始组合与行情快照独立保留。需要尝试其他交易时，可从原始组合新建模拟。</p><button className="secondary full-width" disabled={!!busy} onClick={newDraft}><Icon name="plus" />新建模拟</button></div> : <form className="trade-form" onSubmit={addTrade} noValidate>
              <label htmlFor="symbol">交易标的</label><select id="symbol" value={symbol} disabled={!!busy} onChange={e => setSymbol(e.target.value)}>{snapshot.instruments.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol} · {p.name}</option>)}</select>
              <div className="selected-info"><span>快照价 <strong>¥{selected?.price}</strong></span><span>当前持仓 <strong>{selected?.quantity} 股</strong></span></div>
              <span className="field-label" id="side-label">交易方向</span><div className="direction-control" role="group" aria-labelledby="side-label"><button type="button" aria-pressed={side === 'buy'} className={side === 'buy' ? 'selected buy' : ''} disabled={!!busy} onClick={() => setSide('buy')}>＋ 买入</button><button type="button" aria-pressed={side === 'sell'} className={side === 'sell' ? 'selected sell' : ''} disabled={!!busy} onClick={() => setSide('sell')}>－ 卖出</button></div>
              <label htmlFor="quantity">交易数量</label><div className="input-unit"><input id="quantity" type="text" inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={!!busy} aria-describedby="quantity-hint" aria-invalid={!!tradeError} /><span>股</span></div><small id="quantity-hint" className="field-hint">仅支持正整数，所有操作使用快照价格。</small>
              <ErrorBox message={tradeError} /><button className="primary full-width" type="submit" disabled={!!busy || operations.length >= 100}><Icon name="plus" />{busy === 'simulate' ? '正在计算…' : '添加到模拟'}</button>
            </form>}
            <div className="operation-section"><div className="operation-heading"><h3>操作序列 <span>{operations.length}</span></h3>{!activePlan && operations.length > 0 && <button className="text-button" disabled={!!busy} onClick={newDraft}><Icon name="reset" />清空</button>}</div>
              {operations.length ? <ol className="operation-list">{operations.map((op, index) => <li key={index}><span className="operation-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{snapshot.instruments.find(p => p.symbol === op.symbol)?.name}</strong><small>{op.symbol} · 快照价 ¥{snapshot.instruments.find(p => p.symbol === op.symbol)?.price}</small></div><span className={`operation-side ${op.side}`}>{op.side === 'buy' ? '买入' : '卖出'}<strong>{op.quantity.toLocaleString('en-US')} 股</strong></span></li>)}</ol> : <div className="operation-empty"><span className="empty-dash">↗</span><strong>还没有添加操作</strong><p>添加第一笔买卖，查看模拟结果。</p></div>}
            </div>
            <div className="simulation-summary"><div><span>模拟现金</span><strong>¥{money(current.cash)}</strong></div>{compared && <small>原始 ¥{money(original.cash)}</small>}<div><span>总资产</span><strong>¥{money(current.totalAssets)}</strong><span className="unchanged">保持不变</span></div></div>
            {!activePlan && <form className="save-form" onSubmit={savePlan} noValidate><label htmlFor="plan-name">保存当前方案</label><input id="plan-name" placeholder="为这次调仓起个名字" value={name} disabled={!!busy} onChange={e => setName(e.target.value)} aria-invalid={!!saveError} /><ErrorBox message={saveError} /><button className="secondary full-width" type="submit" disabled={!!busy}><Icon name="save" />{busy === 'save' ? '正在保存…' : '保存方案'}</button><small className="field-hint">保存后可重开查看，原始持仓不会改变。</small></form>}
          </section><div className="simulation-tip"><span>i</span><p>买卖仅用于模拟，不会产生真实交易。未保存的草稿不会在刷新后保留。</p></div></aside>
          </div>
        </>}
        <footer className="app-footer"><span>PORTFOLIO LAB <span>·</span> 投资组合分析与调仓模拟</span><span>固定行情 · 本地保存 · 单用户</span></footer>
      </>}
    </main>
  </div>;
}
