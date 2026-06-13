import { useMemo, useState } from 'react'
import type { InsightsComparisonPeriod, InsightsRangeInputDates, InsightsRangePreset } from '../types/range'
import {
  getCustomRangeDays,
  getDefaultCustomRange,
  getRangeComparisonPeriod,
  getRangeDisplayDates,
  getRangeInputDates,
} from '../utils/range'

export type InsightsRangeState = {
  rangePreset: InsightsRangePreset
  setRangePreset: (value: InsightsRangePreset) => void
  customFrom: string
  setCustomFrom: (value: string) => void
  customTo: string
  setCustomTo: (value: string) => void
  commitCustomRange: () => void
  customInvalid: boolean
  rangeInputDates: InsightsRangeInputDates
  comparisonPeriod: InsightsComparisonPeriod
  cardTransitionKey: string
  cardQueriesEnabled: boolean
}

/**
 * Owns insight range presets, custom date drafts, query enablement, and card transition keys
 */
export function useInsightsRange(): InsightsRangeState {
  const defaultCustomRange = useMemo(() => getDefaultCustomRange(), [])
  const initialRangeInputDates = useMemo(
    () => getRangeInputDates('THIS_MONTH', defaultCustomRange.from, defaultCustomRange.to),
    [defaultCustomRange],
  )
  const initialRangeDisplayDates = useMemo(
    () => getRangeDisplayDates('THIS_MONTH', defaultCustomRange.from, defaultCustomRange.to),
    [defaultCustomRange],
  )
  const [rangePreset, setRangePresetState] = useState<InsightsRangePreset>('THIS_MONTH')
  const [committedCustomFrom, setCommittedCustomFrom] = useState(defaultCustomRange.from)
  const [committedCustomTo, setCommittedCustomTo] = useState(defaultCustomRange.to)
  const [customFrom, setCustomFromState] = useState(initialRangeDisplayDates.from)
  const [customTo, setCustomToState] = useState(initialRangeDisplayDates.to)
  const [rangeInputDates, setRangeInputDates] = useState<InsightsRangeInputDates>(initialRangeInputDates)
  const [comparisonPeriod, setComparisonPeriod] = useState<InsightsComparisonPeriod>(getRangeComparisonPeriod('THIS_MONTH'))

  const customInvalid = rangePreset === 'CUSTOM'
    && customFrom !== ''
    && customTo !== ''
    && getCustomRangeDays(customFrom, customTo) === null
  const cardTransitionKey = `${rangeInputDates.from}:${rangeInputDates.to}:${comparisonPeriod}`
  const cardQueriesEnabled = rangeInputDates.from !== '' && rangeInputDates.to !== ''

  /**
   * Updates preset dates while preserving the committed custom range for later reuse
   */
  function setRangePreset(value: InsightsRangePreset) {
    setRangePresetState(value)

    if (value === 'CUSTOM') {
      const nextRange = { from: committedCustomFrom, to: committedCustomTo }
      setCustomFromState(nextRange.from)
      setCustomToState(nextRange.to)
      setRangeInputDates(nextRange)
      setComparisonPeriod(getRangeComparisonPeriod(value))
      return
    }

    const nextInputRange = getRangeInputDates(value, committedCustomFrom, committedCustomTo)
    const nextDisplayRange = getRangeDisplayDates(value, committedCustomFrom, committedCustomTo)
    setCustomFromState(nextDisplayRange.from)
    setCustomToState(nextDisplayRange.to)
    setRangeInputDates(nextInputRange)
    setComparisonPeriod(getRangeComparisonPeriod(value))
  }

  function setCustomFrom(value: string) {
    setRangePresetState('CUSTOM')
    setCustomFromState(value)
  }

  function setCustomTo(value: string) {
    setRangePresetState('CUSTOM')
    setCustomToState(value)
  }

  /**
   * Commits custom dates only after both inputs form a valid range
   */
  function commitCustomRange() {
    if (rangePreset !== 'CUSTOM' || customFrom === '' || customTo === '' || getCustomRangeDays(customFrom, customTo) === null) {
      return
    }

    setCommittedCustomFrom(customFrom)
    setCommittedCustomTo(customTo)
    setRangeInputDates({ from: customFrom, to: customTo })
    setComparisonPeriod(getRangeComparisonPeriod('CUSTOM'))
  }

  return {
    rangePreset,
    setRangePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    commitCustomRange,
    customInvalid,
    rangeInputDates,
    comparisonPeriod,
    cardTransitionKey,
    cardQueriesEnabled,
  }
}
