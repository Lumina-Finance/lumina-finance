import { useMemo, useState } from 'react'
import type { InsightsRangeInputDates, InsightsRangePreset } from '../types/range'
import {
  getCustomRangeDays,
  getDefaultCustomRange,
  getRangeInputDates,
} from '../utils/range'

export type InsightsRangeState = {
  rangePreset: InsightsRangePreset
  setRangePreset: (value: InsightsRangePreset) => void
  customFrom: string
  setCustomFrom: (value: string) => void
  customTo: string
  setCustomTo: (value: string) => void
  customInvalid: boolean
  rangeInputDates: InsightsRangeInputDates
  cardTransitionKey: string
  cardQueriesEnabled: boolean
}

export function useInsightsRange(): InsightsRangeState {
  const defaultCustomRange = useMemo(() => getDefaultCustomRange(), [])
  const [rangePreset, setRangePreset] = useState<InsightsRangePreset>('THIS_MONTH')
  const [customFrom, setCustomFrom] = useState(defaultCustomRange.from)
  const [customTo, setCustomTo] = useState(defaultCustomRange.to)

  const customInvalid = rangePreset === 'CUSTOM'
    && customFrom !== ''
    && customTo !== ''
    && getCustomRangeDays(customFrom, customTo) === null
  const rangeInputDates = useMemo(
    () => getRangeInputDates(rangePreset, customFrom, customTo),
    [customFrom, customTo, rangePreset],
  )
  const cardTransitionKey = `${rangeInputDates.from}:${rangeInputDates.to}`
  const cardQueriesEnabled = !customInvalid && rangeInputDates.from !== '' && rangeInputDates.to !== ''

  return {
    rangePreset,
    setRangePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    customInvalid,
    rangeInputDates,
    cardTransitionKey,
    cardQueriesEnabled,
  }
}
