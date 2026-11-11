import type { Analysis, Alert, Operation, Simulation, Snapshot } from '../shared/types.js';

export class DomainError extends Error {
  constructor(public code: string, message: string, public operationIndex?: number) { super(message); }
}

function safe(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError('AMOUNT_OVERFLOW', '交易金额或持仓超出安全计算范围，请减小数量。');
  }
  return value;
}

function cents(value: string): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new DomainError('INVALID_PRICE', '金额必须是非负且最多两位小数的十进制字符串。');
  }
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return safe(Number(result));
}

function decimal(value: number | bigint): string {
  const n = BigInt(value);
  return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}

function percentage(value: number, total: number): string {
  if (total === 0) return '0.00';
  return decimal((BigInt(value) * 10000n + BigInt(total) / 2n) / BigInt(total));
}

function exceeds(value: number, total: number, threshold: number): boolean {
  return BigInt(value) * 100n > BigInt(total) * BigInt(threshold);
}

export function analyze(snapshot: Snapshot): Analysis {
  const cash = cents(snapshot.cash);
  const values = snapshot.instruments.map(p => safe(cents(p.price) * safe(p.quantity)));
  const total = values.reduce((sum, value) => safe(sum + value), cash);
  const singleLimit = cents(snapshot.rules.single_instrument_threshold);
  const industryLimit = cents(snapshot.rules.industry_threshold);
  const alerts: Alert[] = [];
  const positions = snapshot.instruments.map((p, index) => {
    const value = values[index]!;
    const ratio = percentage(value, total);
    const exceeded = exceeds(value, total, singleLimit);
    if (exceeded) alerts.push({ type: 'instrument', key: p.symbol, name: p.name, percentage: ratio, threshold: `${singleLimit}.00` });
    return { ...p, marketValue: decimal(value), percentage: ratio, exceeded };
  });
  const industryValues = new Map<string, number>();
  snapshot.instruments.forEach((p, i) => industryValues.set(p.industry, safe((industryValues.get(p.industry) ?? 0) + values[i]!)));
  const industries = [...industryValues].map(([industry, value]) => {
    const ratio = percentage(value, total);
    const exceeded = exceeds(value, total, industryLimit);
    if (exceeded) alerts.push({ type: 'industry', key: industry, name: industry, percentage: ratio, threshold: `${industryLimit}.00` });
    return { industry, marketValue: decimal(value), percentage: ratio, exceeded };
  });
  return { totalAssets: decimal(total), cash: decimal(cash), cashPercentage: percentage(cash, total),
    positionCount: positions.filter(p => p.quantity > 0).length, positions, industries, alerts };
}

export function simulate(snapshot: Snapshot, input: unknown): Simulation {
  if (!Array.isArray(input) || input.length > 100) {
    throw new DomainError('INVALID_OPERATIONS', '操作必须为数组，每个方案最多包含 100 笔操作。');
  }
  const working = structuredClone(snapshot);
  const operations: Operation[] = [];
  let cash = cents(working.cash);
  for (const [index, raw] of input.entries()) {
    try {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new DomainError('INVALID_OPERATION', '请提供标的、交易方向和数量。');
      }
      const { symbol, side, quantity } = raw;
      if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new DomainError('INVALID_QUANTITY', '交易数量必须为正整数。');
      }
      const position = working.instruments.find(p => p.symbol === symbol);
      if (!position) throw new DomainError('UNKNOWN_SYMBOL', '仅支持给定行情快照中的标的。');
      if (side !== 'buy' && side !== 'sell') throw new DomainError('INVALID_SIDE', '交易方向必须为买入或卖出。');
      const amount = safe(cents(position.price) * quantity);
      if (side === 'buy') {
        if (amount > cash) throw new DomainError('INSUFFICIENT_CASH', `现金不足：需要 ¥${decimal(amount)}，当前可用 ¥${decimal(cash)}。`);
        position.quantity = safe(position.quantity + quantity);
        cash -= amount;
      } else {
        if (quantity > position.quantity) throw new DomainError('INSUFFICIENT_POSITION', `持仓不足：当前仅持有 ${position.quantity} 股，无法卖出 ${quantity} 股。`);
        position.quantity -= quantity;
        cash = safe(cash + amount);
      }
      operations.push({ symbol, side, quantity });
    } catch (error) {
      if (error instanceof DomainError) error.operationIndex = index;
      throw error;
    }
  }
  working.cash = decimal(cash);
  return { original: analyze(snapshot), simulated: analyze(working), operations };
}
