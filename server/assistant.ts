import type { Analysis, AssistantContextSummary, ChatMessage, DemoAdvice, DemoReply, Operation, SimulationStep, Snapshot } from '../shared/types.js';
import { cents, DomainError, simulate } from './domain.js';
import type { PlanStore } from './store.js';
import { resolveSourceSnapshot } from './source.js';

interface AssistantContext {
  snapshot: Snapshot; operations: Operation[]; analysis: Analysis;
  stepIndex: number; operationCount: number; step?: SimulationStep;
}

export function resolveAssistantContext(base: Snapshot, store: PlanStore, input: unknown): AssistantContext {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_CONTEXT', '请提供组合操作和回看步骤。');
  const raw = input as Record<string, unknown>;
  if (raw.planId !== undefined && raw.sourcePlanId !== undefined) throw new DomainError('INVALID_CONTEXT', '保存方案与草稿来源不能同时指定。');
  let snapshot = resolveSourceSnapshot(base, store, raw.sourcePlanId);
  let operations: unknown = raw.operations;
  if (raw.planId !== undefined) {
    if (typeof raw.planId !== 'string' || !raw.planId.trim()) throw new DomainError('INVALID_CONTEXT', '方案 ID 不正确。');
    const plan = store.get(raw.planId);
    if (!plan) throw new DomainError('PLAN_NOT_FOUND', '没有找到此方案，请重新选择上下文。');
    snapshot = plan.snapshot; operations = plan.operations;
  }
  const result = simulate(snapshot, operations);
  const index = raw.stepIndex === undefined ? result.steps.length : raw.stepIndex;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > result.steps.length) {
    throw new DomainError('INVALID_CONTEXT', '回看步骤超出当前操作范围。');
  }
  const step = index > 0 ? result.steps[index - 1] : undefined;
  return { snapshot, operations: result.operations.slice(0, index), analysis: step?.analysis ?? result.original,
    stepIndex: index, operationCount: result.operations.length, step };
}

function summary(context: AssistantContext): AssistantContextSummary {
  return { snapshotId: context.snapshot.snapshot_id, snapshotAt: context.snapshot.snapshot_at,
    stepIndex: context.stepIndex, operationCount: context.operationCount, analysis: context.analysis };
}

export function createDemoAdvice(context: AssistantContext): DemoAdvice {
  const { analysis, snapshot } = context;
  const response: DemoAdvice = {
    mode: 'demo', context: summary(context),
    summary: analysis.alerts.length ? `当前有 ${analysis.alerts.length} 项集中度超限，可先比较降低超限敞口的模拟结果。` : '当前没有集中度超限，无需为满足这两项规则额外调仓。',
    observations: analysis.alerts.map(a => `${a.type === 'instrument' ? '标的' : '行业'} ${a.name} 占比 ${a.percentage}%，超过 ${a.threshold}% 阈值。`),
    suggestion: '可按固定行情将超限部分转为现金，先查看后端验算结果，再决定是否采用为模拟草案。', draft: null,
  };
  if (!analysis.alerts.length) { response.suggestion = '保持当前模拟，并检查每笔交易的变化依据。'; return response; }
  const total = BigInt(cents(analysis.totalAssets));
  const singleLimit = total * BigInt(cents(snapshot.rules.single_instrument_threshold)) / 100n;
  const industryLimit = total * BigInt(cents(snapshot.rules.industry_threshold)) / 100n;
  const positions = analysis.positions.map(p => ({ ...p, units: BigInt(p.quantity), priceCents: BigInt(cents(p.price)) }));
  const added: Operation[] = [];
  function reduce(position: typeof positions[number], excess: bigint) {
    if (excess <= 0n || position.priceCents === 0n) return 0n;
    const needed = (excess + position.priceCents - 1n) / position.priceCents;
    const quantity = needed < position.units ? needed : position.units;
    if (quantity === 0n) return 0n;
    position.units -= quantity;
    added.push({ symbol: position.symbol, side: 'sell', quantity: Number(quantity) });
    return quantity * position.priceCents;
  }
  for (const p of positions) reduce(p, p.units * p.priceCents - singleLimit);
  for (const industry of analysis.industries) {
    const members = positions.filter(p => p.industry === industry.industry).sort((a, b) => {
      const av = a.units * a.priceCents, bv = b.units * b.priceCents;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });
    let excess = members.reduce((sum, p) => sum + p.units * p.priceCents, 0n) - industryLimit;
    for (const p of members) excess -= reduce(p, excess);
  }
  if (context.operations.length + added.length > 100) {
    response.suggestion = '每个方案最多 100 笔操作，当前没有足够额度追加完整草案；请从原始组合新建模拟。';
    return response;
  }
  const simulation = simulate(snapshot, [...context.operations, ...added]);
  response.draft = { title: '演示草案：将超限部分转为现金', addedOperations: added, simulation };
  return response;
}

export function createDemoReply(context: AssistantContext, question: unknown, history: unknown, topicHint?: unknown): DemoReply {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000) throw new DomainError('INVALID_QUESTION', '问题须为 1～1000 个字符。');
  if (!Array.isArray(history) || history.length > 6 || history.some(m => !m || typeof m !== 'object' ||
    (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 1000)) {
    throw new DomainError('INVALID_HISTORY', '最多提供 6 条对话历史，每条为 user/assistant 消息且不超过 1000 字符。');
  }
  const messages = history as ChatMessage[];
  const topicSeeds = { cash: '现金', alerts: '超限', rule: '规则', step: '这一步', draft: '调仓', scope: '预测', overview: '' };
  if (topicHint !== undefined && (typeof topicHint !== 'string' || !Object.hasOwn(topicSeeds, topicHint))) {
    throw new DomainError('INVALID_TOPIC', '对话话题不正确。');
  }
  const current = question.trim();
  const meaningful = /现金|总资产|分母|超限|集中|科技|行业|风险|阈值|等于|30%|50%|规则|舍入|精度|上一步|这一步|步骤|变化|刚才|建议|调仓|降低|方案|草案|预测|明天|涨停|稳赚|收益率|真实下单|实时行情/;
  const previous = [...messages].reverse().find(m => m.role === 'user' && meaningful.test(m.content))?.content ??
    (topicHint === undefined ? '' : topicSeeds[topicHint as DemoReply['topic']]);
  const followUp = current.length <= 18 && /^(那|为什么|怎么|具体|继续|然后|还有)/.test(current) && !/现金|资产|超限|行业|科技|阈值|规则|步骤|上一步|建议|调仓/.test(current);
  const text = followUp ? previous + ' ' + current : current;
  const a = context.analysis;
  let topic: DemoReply['topic'] = 'overview';
  let reply = `当前查看第 ${context.stepIndex} 步，总资产 ${a.totalAssets} 元，现金 ${a.cash} 元，有 ${a.alerts.length} 项集中度超限。演示问答支持集中度、现金、阈值、步骤变化和调仓草案。`;
  if (/预测|明天|涨停|稳赚|收益率|真实下单|实时行情/.test(text)) {
    topic = 'scope'; reply = '这是使用固定虚构行情的本地演示，可解释组合和校验模拟草案；不具备行情预测、收益预测或真实交易能力。';
  } else if (/上一步|这一步|步骤|变化|刚才/.test(text)) {
    topic = 'step';
    reply = context.step ? `第 ${context.stepIndex} 步${context.step.operation.side === 'buy' ? '买入' : '卖出'}${context.step.impact.position.name} ${context.step.operation.quantity} 股，现金从 ${context.step.impact.cash.before} 元变为 ${context.step.impact.cash.after} 元；${context.step.impact.industry.name}行业占比从 ${context.step.impact.industry.percentageBefore}% 变为 ${context.step.impact.industry.percentageAfter}%。新增 ${context.step.impact.triggeredAlerts.length} 项、解除 ${context.step.impact.resolvedAlerts.length} 项提醒。` : '当前查看原始组合，还没有已执行的步骤。添加模拟操作后，可以逐步回看变化。';
  } else if (/现金|总资产|分母/.test(text)) {
    topic = 'cash'; reply = `当前现金 ${a.cash} 元，总资产 ${a.totalAssets} 元。总资产为全部标的市值加现金；现金计入占比分母，但不属于任何行业。固定价格且无费用时，买卖只在现金与持仓之间转换，总资产保持不变。`;
  } else if (/阈值|等于|30%|50%|规则|舍入|精度/.test(text)) {
    topic = 'rule'; reply = '单一标的严格大于 30%、行业严格大于 50% 才提醒，等于阈值不提醒。后端按整数分计算金额，并用未舍入的数值比较阈值；页面百分比保留两位小数。';
  } else if (/建议|调仓|降低|怎么做|方案|草案/.test(text)) {
    topic = 'draft'; const advice = createDemoAdvice(context);
    reply = advice.draft ? `${advice.suggestion} 本地规则草案为：${advice.draft.addedOperations.map(op => `卖出 ${op.symbol} ${op.quantity} 股`).join('；')}。后端验算后现金 ${advice.draft.simulation.simulated.cash} 元，剩余 ${advice.draft.simulation.simulated.alerts.length} 项超限。请在辅助建议中预览并选择是否采用。` : advice.summary + ' ' + advice.suggestion;
  } else if (/超限|集中|科技|行业|风险/.test(text)) {
    topic = 'alerts'; reply = a.alerts.length ? `当前有 ${a.alerts.length} 项超限：${a.alerts.map(x => `${x.name} ${x.percentage}%（阈值 ${x.threshold}%）`).join('；')}。超限代表集中度超过本项目规则，可以用模拟比较调整后的占比。` : '当前没有标的或行业集中度超限。所有占比均未严格超过相应阈值；这只说明满足当前集中度规则。';
  }
  return { mode: 'demo', context: summary(context), topic, reply };
}
