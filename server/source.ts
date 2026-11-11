import type { Snapshot } from '../shared/types.js';
import type { PlanStore } from './store.js';
import { DomainError } from './domain.js';

export function resolveSourceSnapshot(base: Snapshot, store: PlanStore, sourcePlanId: unknown): Snapshot {
  if (sourcePlanId === undefined) return base;
  if (typeof sourcePlanId !== 'string' || !sourcePlanId.trim()) throw new DomainError('INVALID_CONTEXT', '来源方案 ID 不正确。');
  const source = store.get(sourcePlanId);
  if (!source) throw new DomainError('PLAN_NOT_FOUND', '没有找到来源方案，请重新选择上下文。');
  return source.snapshot;
}
