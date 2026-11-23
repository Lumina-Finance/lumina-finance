export type FxState = 'none' | 'complete' | 'incomplete' | 'unavailable'

export interface FxRateIssue {
  base: string
  quote: string
}

export interface FxStatus {
  state: FxState
  missing_pairs: FxRateIssue[]
  // The sentence the server gives when amounts in another currency were left out of the total, not
  // converted. Absent while none were
  withheld_reason?: string | null
}
