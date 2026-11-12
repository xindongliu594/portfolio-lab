import { useEffect, useRef, useState } from 'react';
import type { PlanDetail, PlanSummary } from '../shared/types.js';
import { money, time } from './format.js';
import { request } from './api.js';

export function ComparisonResult({ plans, onClose }: { plans: [PlanDetail, PlanDetail]; onClose: () => void }) {
  const [left, right] = plans;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start' }); }, []);
  const sameSnapshot = JSON.stringify(left.snapshot) === JSON.stringify(right.snapshot);
  const leftPositions = new Map(left.simulated.positions.map(p => [p.symbol, p]));
  const rightPositions = new Map(right.simulated.positions.map(p => [p.symbol, p]));
  const symbols = [...new Set([...leftPositions.keys(), ...rightPositions.keys()])];
  const leftIndustries = new Map(left.simulated.industries.map(p => [p.industry, p]));
  const rightIndustries = new Map(right.simulated.industries.map(p => [p.industry, p]));
  const industries = [...new Set([...leftIndustries.keys(), ...rightIndustries.keys()])];
  const metrics = [
    ['组合总资产', `¥${money(left.simulated.totalAssets)}`, `¥${money(right.simulated.totalAssets)}`],
    ['可用现金', `¥${money(left.simulated.cash)}`, `¥${money(right.simulated.cash)}`],
    ['现金占比', `${left.simulated.cashPercentage}%`, `${right.simulated.cashPercentage}%`],
    ['持仓标的', `${left.simulated.positionCount} 只`, `${right.simulated.positionCount} 只`],
    ['集中度超限', `${left.simulated.alerts.length} 项`, `${right.simulated.alerts.length} 项`],
    ['模拟操作', `${left.operationCount} 笔`, `${right.operationCount} 笔`],
  ];
  const head = (label: string) => <thead><tr><th scope="col">{label}</th>{plans.map((plan, i) => <th scope="col" key={plan.id}><small>方案 {i === 0 ? 'A' : 'B'}</small>{plan.name}</th>)}</tr></thead>;

  return <section className="plan-comparison" aria-labelledby="comparison-title">
    <div className="section-heading"><div><h2 id="comparison-title" tabIndex={-1} ref={heading}>方案并排对比</h2><p>展示各方案最终结果；浅蓝色标记数值或状态不同的项目。</p></div><button className="text-button" onClick={onClose}>返回选择</button></div>
    <div className={`comparison-basis ${sameSnapshot ? '' : 'different'}`} role="status"><strong>{sameSnapshot ? '对比依据一致' : '快照内容不同'}</strong><p>{sameSnapshot ? '两份方案使用相同的初始持仓、行情快照及计算规则，可核对不同操作带来的变化。' : '两份方案按各自保存快照计算。初始数据或规则存在差异，不能将差异全部归因于调仓操作。'}</p></div>
    <div className="comparison-sources">{plans.map((plan, i) => <article key={plan.id}><span>方案 {i === 0 ? 'A' : 'B'}</span><h3>{plan.name}</h3><p>快照 {plan.snapshot.snapshot_id}</p><small>行情时间 {time(plan.snapshot.snapshot_at)}</small></article>)}</div>
    <p className="comparison-scroll-hint">左右滑动表格，查看两份方案</p>
    <div className="comparison-section"><h3>资产与操作概览</h3><div className="table-scroll" role="region" aria-label="资产对比表，可横向滚动" tabIndex={0}><table className="comparison-table"><caption className="sr-only">资产与操作对比</caption>{head('指标')}<tbody>{metrics.map(([label, a, b]) => <tr key={label} className={a !== b ? 'comparison-changed' : ''}><th scope="row">{label}</th><td>{a}</td><td>{b}</td></tr>)}</tbody></table></div></div>
    <div className="comparison-section"><h3>标的持仓</h3><div className="table-scroll" role="region" aria-label="持仓对比表，可横向滚动" tabIndex={0}><table className="comparison-table"><caption className="sr-only">标的持仓对比</caption>{head('标的 / 数量、市值、占比')}<tbody>{symbols.map(symbol => {
      const a = leftPositions.get(symbol), b = rightPositions.get(symbol);
      const changed = !a || !b || a.quantity !== b.quantity || a.marketValue !== b.marketValue || a.percentage !== b.percentage || a.exceeded !== b.exceeded;
      return <tr key={symbol} className={changed ? 'comparison-changed' : ''}><th scope="row"><strong>{a?.name ?? b?.name}</strong><small>{symbol}{a && b && a.name !== b.name && ` · 方案B：${b.name}`}</small></th>{[a, b].map((p, i) => <td key={i}>{p ? <><strong>{p.quantity.toLocaleString('en-US')} 股</strong><small>¥{money(p.marketValue)} <span>·</span> {p.percentage}%</small><span className={`status-tag ${p.exceeded ? 'amber' : ''}`}>{p.exceeded ? '超限' : '阈值内'}</span></> : <small>未包含该标的</small>}</td>)}</tr>;
    })}</tbody></table></div></div>
    <div className="comparison-section"><h3>行业分布</h3><div className="table-scroll" role="region" aria-label="行业对比表，可横向滚动" tabIndex={0}><table className="comparison-table"><caption className="sr-only">行业分布对比</caption>{head('行业 / 市值、占比')}<tbody>{industries.map(industry => {
      const a = leftIndustries.get(industry), b = rightIndustries.get(industry);
      const changed = !a || !b || a.marketValue !== b.marketValue || a.percentage !== b.percentage || a.exceeded !== b.exceeded;
      return <tr key={industry} data-industry={industry} className={changed ? 'comparison-changed' : ''}><th scope="row">{industry}</th>{[a, b].map((p, i) => <td key={i}>{p ? <><strong>¥{money(p.marketValue)}</strong><small>{p.percentage}% <span className={p.exceeded ? 'amber-text' : ''}>{p.exceeded ? '超限' : '阈值内'}</span></small></> : <small>未包含该行业</small>}</td>)}</tr>;
    })}</tbody></table></div></div>
    <div className="comparison-section"><h3>具体超限提醒</h3><div className="comparison-alerts">{plans.map((plan, i) => <article key={plan.id}><h4>方案 {i === 0 ? 'A' : 'B'} · {plan.name}</h4>{plan.simulated.alerts.length ? <ul>{plan.simulated.alerts.map(alert => <li key={`${alert.type}:${alert.key}`}><strong>{alert.name}<small>{alert.type === 'instrument' ? '标的' : '行业'}</small></strong><p>{alert.percentage}% <span>（阈值 {alert.threshold}%）</span></p></li>)}</ul> : <p className="comparison-no-alerts">当前无超限提醒</p>}</article>)}</div></div>
    <p className="comparison-note">金额、占比和提醒均来自后端按保存快照重新计算；对比不修改原始组合、当前草稿或已保存方案。</p>
  </section>;
}

export default function PlanLibrary({ plans, busy, error, onRefresh, onOpen, onStart }: {
  plans: PlanSummary[]; busy: boolean; error: string; onRefresh: () => Promise<void>; onOpen: (id: string) => Promise<void>; onStart: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<[PlanDetail, PlanDetail] | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const compareButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setSelected(current => current.filter(id => plans.some(plan => plan.id === id)));
    setComparison(null);
  }, [plans]);
  function toggle(id: string) {
    setComparison(null); setComparisonError('');
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 2 ? [...current, id] : current);
  }
  async function compare() {
    if (selected.length !== 2 || loading) return;
    setLoading(true); setComparisonError(''); setComparison(null);
    try {
      const [a, b] = await Promise.all(selected.map(id => request<PlanDetail>(`/plans/${encodeURIComponent(id)}`)));
      setComparison([a!, b!]);
    } catch (err) { setComparisonError(err instanceof Error ? err.message : '方案对比加载失败，请重试。'); }
    finally { setLoading(false); }
  }
  return <section className="panel plans-panel">
    <div className="section-heading"><div><h2>方案档案 <span className="subtle-count">{plans.length}</span></h2><p>保存在本机，可在刷新页面和重启服务后重新打开。</p></div><button className="text-button" onClick={onRefresh} disabled={busy || loading}>刷新列表</button></div>
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="comparison-toolbar"><div><strong>比较不同调仓思路</strong><p aria-live="polite">已选择 {selected.length}/2 份方案，按勾选顺序标记为 A、B。</p></div><div><button className="text-button" disabled={!selected.length || loading || busy} onClick={() => { setSelected([]); setComparison(null); setComparisonError(''); }}>清空选择</button><button className="primary" ref={compareButton} disabled={selected.length !== 2 || loading || busy} onClick={compare}>{loading ? '正在读取方案…' : '对比所选方案'}</button></div></div>
    {loading && <p className="comparison-loading" role="status"><span className="spinner" />正在按保存快照读取两份方案…</p>}
    {comparisonError && <div className="error-box" role="alert">{comparisonError}</div>}
    {!plans.length ? <div className="empty-state"><h3>还没有保存的方案</h3><p>完成模拟后，为方案命名并保存；保存两份后即可并排对比。</p><button className="secondary" onClick={onStart}>开始模拟<span aria-hidden="true">→</span></button></div> : <div className="plan-grid">{plans.map(plan => {
      const index = selected.indexOf(plan.id);
      return <article className={`plan-card ${index >= 0 ? 'plan-selected' : ''}`} key={plan.id}>
        <div className="plan-card-top"><label className="plan-select"><input type="checkbox" checked={index >= 0} disabled={busy || loading || (selected.length === 2 && index < 0)} onChange={() => toggle(plan.id)} aria-label={`选择${plan.name}用于对比`} /><span>{index < 0 ? '加入对比' : `对比 ${index === 0 ? 'A' : 'B'}`}</span></label><span className="status-tag">已保存</span></div>
        <h3>{plan.name}</h3><p>{plan.operationCount} 笔操作 <span>·</span> {plan.snapshotId}</p><div className="plan-card-bottom"><small>{time(plan.createdAt)}</small><button className="text-button" disabled={busy || loading} onClick={() => onOpen(plan.id)}>重开方案<span aria-hidden="true">→</span></button></div>
      </article>;
    })}</div>}
    {comparison && <ComparisonResult plans={comparison} onClose={() => { setComparison(null); compareButton.current?.focus(); }} />}
  </section>;
}
