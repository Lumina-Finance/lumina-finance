export type FxState = 'none' | 'complete' | 'incomplete' | 'unavailable';

export interface FxRateIssue {
  base: string;
  quote: string;
}

export interface FxStatus {
  state: FxState;
  missing_pairs: FxRateIssue[];
}
