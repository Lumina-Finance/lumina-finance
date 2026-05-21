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
  commitCustomRange: () => void
  customInvalid: boolean
  rangeInputDates: InsightsRangeInputDates
  cardTransitionKey: string
  cardQueriesEnabled: boolean
}

export function useInsightsRange(): InsightsRangeState {
  const defaultCustomRange = useMemo(() => getDefaultCustomRange(), [])
  const initialRangeInputDates = useMemo(
    () => getRangeInputDates('THIS_MONTH', defaultCustomRange.from, defaultCustomRange.to),
    [defaultCustomRange],
  )
  const [rangePreset, setRangePresetState] = useState<InsightsRangePreset>('THIS_MONTH')
  const [committedCustomFrom, setCommittedCustomFrom] = useState(defaultCustomRange.from)
  const [committedCustomTo, setCommittedCustomTo] = useState(defaultCustomRange.to)
  const [customFrom, setCustomFromState] = useState(initialRangeInputDates.from)
  const [customTo, setCustomToState] = useState(initialRangeInputDates.to)
  const [rangeInputDates, setRangeInputDates] = useState<InsightsRangeInputDates>(initialRangeInputDates)

  const customInvalid = rangePreset === 'CUSTOM'
    && customFrom !== ''
    && customTo !== ''
    && getCustomRangeDays(customFrom, customTo) === null
  const cardTransitionKey = `${rangeInputDates.from}:${rangeInputDates.to}`
  const cardQueriesEnabled = rangeInputDates.from !== '' && rangeInputDates.to !== ''

  function setRangePreset(value: InsightsRangePreset) {
    setRangePresetState(value)

    if (value === 'CUSTOM') {
      const nextRange = { from: committedCustomFrom, to: committedCustomTo }
      setCustomFromState(nextRange.from)
      setCustomToState(nextRange.to)
      setRangeInputDates(nextRange)
      return
    }

    const nextRange = getRangeInputDates(value, committedCustomFrom, committedCustomTo)
    setCustomFromState(nextRange.from)
    setCustomToState(nextRange.to)
    setRangeInputDates(nextRange)
  }

  function setCustomFrom(value: string) {
    setRangePresetState('CUSTOM')
    setCustomFromState(value)
  }

  function setCustomTo(value: string) {
    setRangePresetState('CUSTOM')
    setCustomToState(value)
  }

  function commitCustomRange() {
    if (rangePreset !== 'CUSTOM' || customFrom === '' || customTo === '' || getCustomRangeDays(customFrom, customTo) === null) {
      return
    }

    setCommittedCustomFrom(customFrom)
    setCommittedCustomTo(customTo)
    setRangeInputDates({ from: customFrom, to: customTo })
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
    cardTransitionKey,
    cardQueriesEnabled,
  }
}
