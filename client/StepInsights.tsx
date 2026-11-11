import type { Analysis, SimulationStep } from '../shared/types.js';
import { money } from './format.js';

export function TradeImpact({ step }: { step: SimulationStep }) {
  const { impact, operation } = step;
  return <section className="panel trade-impact" aria-label={`第 ${step.index} 步调仓影响`}>
    <div className="section-heading"><div><h2>第 {step.index} 步调仓影响</h2><p>{operation.side === 'buy' ? '买入' : '卖出'} {impact.position.name} {operation.quantity.toLocaleString('en-US')} 股，成交金额 ¥{money(impact.tradeValue)}。</p></div><span className="view-badge">相较上一步</span></div>
    <div className="impact-grid">
      <div><span>可用现金</span><p><small>¥{money(impact.cash.before)}</small><i>→</i><strong>¥{money(impact.cash.after)}</strong></p></div>
      <div><span>{impact.position.name}占比</span><p><small>{impact.position.percentageBefore}%</small><i>→</i><strong>{impact.position.percentageAfter}%</strong></p><small className="impact-quantity">持仓 {impact.position.quantityBefore.toLocaleString('en-US')} → {impact.position.quantityAfter.toLocaleString('en-US')} 股</small></div>
      <div><span>{impact.industry.name}行业占比</span><p><small>{impact.industry.percentageBefore}%</small><i>→</i><strong>{impact.industry.percentageAfter}%</strong></p></div>
    </div>
    <div className="impact-alerts">
      {impact.resolvedAlerts.length > 0 && <p className="impact-resolved"><strong>解除 {impact.resolvedAlerts.length} 项提醒</strong><span>{impact.resolvedAlerts.map(a => `${a.type === 'instrument' ? '标的' : '行业'} · ${a.name}`).join('；')}</span></p>}
      {impact.triggeredAlerts.length > 0 && <p className="impact-triggered"><strong>新增 {impact.triggeredAlerts.length} 项提醒</strong><span>{impact.triggeredAlerts.map(a => `${a.type === 'instrument' ? '标的' : '行业'} · ${a.name}`).join('；')}</span></p>}
      {!impact.resolvedAlerts.length && !impact.triggeredAlerts.length && <p>本步没有新增或解除集中度提醒。</p>}
    </div>
  </section>;
}

export function StepTimeline({ steps, selectedIndex, onSelect, disabled, onClear }: {
  steps: SimulationStep[]; selectedIndex: number; onSelect: (index: number) => void; disabled: boolean; onClear?: () => void;
}) {
  return <div className="operation-section"><div className="operation-heading"><h3>操作回看 <span>{steps.length}</span></h3>{onClear && steps.length > 0 && <button className="text-button" disabled={disabled} onClick={onClear}>清空</button>}</div>
    {steps.length ? <>
      <p className="timeline-hint">点击任一步，查看当时的完整结果。</p>
      <button className="timeline-origin" aria-label="查看原始组合" aria-pressed={selectedIndex === 0} disabled={disabled} onClick={() => onSelect(0)}><span>原始组合</span><small>调仓起点</small></button>
      <ol className="operation-list">{steps.map(step => <li key={step.index}><button className="timeline-step" aria-label={`查看第 ${step.index} 步：${step.operation.side === 'buy' ? '买入' : '卖出'} ${step.impact.position.name} ${step.operation.quantity} 股`} aria-pressed={selectedIndex === step.index} disabled={disabled} onClick={() => onSelect(step.index)}>
        <span className="operation-number">{String(step.index).padStart(2, '0')}</span><span className="timeline-stock"><strong>{step.impact.position.name}</strong><small>{step.operation.side === 'buy' ? '买入' : '卖出'} {step.operation.quantity.toLocaleString('en-US')} 股 · {step.analysis.alerts.length} 项超限</small></span><span className="timeline-state">{selectedIndex === step.index ? '正在查看' : step.index === steps.length ? '最新' : '查看'}</span>
      </button></li>)}</ol>
    </> : <div className="operation-empty"><span className="empty-dash">↗</span><strong>还没有添加操作</strong><p>添加第一笔买卖，查看模拟结果。</p></div>}
  </div>;
}

export function CalculationDetails({ analysis }: { analysis: Analysis }) {
  const hasAssets = analysis.totalAssets !== '0.00';
  return <details className="panel calculation-details"><summary><span>查看计算依据</span><small>市值、占比与阈值</small></summary>
    <div className="calculation-body"><p className="calculation-rule">现金计入总资产，独立于行业。当前总资产 ¥{money(analysis.totalAssets)}，其中现金 ¥{money(analysis.cash)}。</p>
      <p className="calculation-rule">标的占比严格大于 30%、行业占比严格大于 50% 时提醒。下面的比例保留两位小数，判定使用未舍入的内部数值。</p>
      <div className="basis-group"><h3>标的市值与占比</h3>{analysis.positions.map(p => <div className="basis-row" key={p.symbol}><div><strong>{p.name}</strong><span className={`status-tag ${p.exceeded ? 'amber' : ''}`}>{p.exceeded ? '超限' : '阈值内'}</span></div><p>¥{money(p.price)} × {p.quantity} 股 = ¥{money(p.marketValue)}</p><p>{hasAssets ? `${money(p.marketValue)} ÷ ${money(analysis.totalAssets)} ≈ ${p.percentage}%` : '总资产为零，占比按 0.00% 展示。'}</p></div>)}</div>
      <div className="basis-group"><h3>行业集中度</h3><p className="calculation-rule">同行业标的市值汇总后，除以组合总资产。</p>{analysis.industries.map(industry => <div className="basis-row industry-basis" key={industry.industry}><strong>{industry.industry}</strong><p>{hasAssets ? `${money(industry.marketValue)} ÷ ${money(analysis.totalAssets)} ≈ ${industry.percentage}%` : '总资产为零，占比按 0.00% 展示。'}</p><span className={`status-tag ${industry.exceeded ? 'amber' : ''}`}>{industry.exceeded ? '超限' : '阈值内'}</span></div>)}</div>
    </div>
  </details>;
}
