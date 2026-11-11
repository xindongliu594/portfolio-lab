export interface Snapshot {
  portfolio_id: string;
  name: string;
  currency: 'CNY';
  snapshot_id: string;
  snapshot_at: string;
  cash: string;
  instruments: { symbol: string; name: string; industry: string; price: string; quantity: number }[];
  rules: {
    single_instrument_threshold: string; industry_threshold: string;
    comparison: string; cash_in_denominator: boolean; cash_in_industry: boolean;
    quantity: string; fees: string;
  };
}
export interface Operation { symbol: string; side: 'buy' | 'sell'; quantity: number }
export interface Position {
  symbol: string; name: string; industry: string; price: string;
  quantity: number; marketValue: string; percentage: string; exceeded: boolean;
}
export interface Industry { industry: string; marketValue: string; percentage: string; exceeded: boolean }
export interface Alert { type: 'instrument' | 'industry'; key: string; name: string; percentage: string; threshold: string }
export interface Analysis {
  totalAssets: string; cash: string; cashPercentage: string; positionCount: number;
  positions: Position[]; industries: Industry[]; alerts: Alert[];
}
export interface StepImpact {
  tradeValue: string;
  cash: { before: string; after: string };
  position: { symbol: string; name: string; quantityBefore: number; quantityAfter: number; percentageBefore: string; percentageAfter: string };
  industry: { name: string; percentageBefore: string; percentageAfter: string };
  resolvedAlerts: Alert[];
  triggeredAlerts: Alert[];
}
export interface SimulationStep { index: number; operation: Operation; analysis: Analysis; impact: StepImpact }
export interface Simulation { original: Analysis; simulated: Analysis; operations: Operation[]; steps: SimulationStep[] }
export interface PortfolioResponse { snapshot: Snapshot; analysis: Analysis }
export interface PlanSummary { id: string; name: string; createdAt: string; operationCount: number; snapshotId: string }
export interface PlanDetail extends PlanSummary, Simulation { snapshot: Snapshot }
export interface ApiError { error: { code: string; message: string; operationIndex?: number } }
export interface AssistantContextInput { operations: Operation[]; stepIndex: number; planId?: string; sourcePlanId?: string }
export interface AssistantContextSummary { snapshotId: string; snapshotAt: string; stepIndex: number; operationCount: number; analysis: Analysis }
export interface DemoAdvice {
  mode: 'demo'; context: AssistantContextSummary; summary: string; observations: string[]; suggestion: string;
  draft: { title: string; addedOperations: Operation[]; simulation: Simulation } | null;
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface DemoReply { mode: 'demo'; context: AssistantContextSummary; topic: 'cash' | 'alerts' | 'rule' | 'step' | 'draft' | 'scope' | 'overview'; reply: string }
