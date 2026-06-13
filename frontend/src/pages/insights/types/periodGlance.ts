import type { FxStatus } from '@/api/shared/fx'

export type PeriodGlanceTone = 'positive' | 'neutral' | 'negative'

export type PeriodGlancePrimaryMetric = {
  label: string
  value: string
  detail: string
  calculation?: string
  tone: PeriodGlanceTone
}

export type PeriodGlanceSupportItem = {
  label: string
  value: string
  detail: string
  calculation?: string
  tone: PeriodGlanceTone
  fxStatus?: FxStatus
  getFxStatusMessage?: (fxStatus: FxStatus) => string
}
