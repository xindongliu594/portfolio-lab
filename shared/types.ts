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
export interface Simulation { original: Analysis; simulated: Analysis; operations: Operation[] }
export interface PortfolioResponse { snapshot: Snapshot; analysis: Analysis }
export interface PlanSummary { id: string; name: string; createdAt: string; operationCount: number; snapshotId: string }
export interface PlanDetail extends PlanSummary, Simulation { snapshot: Snapshot }
export interface ApiError { error: { code: string; message: string; operationIndex?: number } }
