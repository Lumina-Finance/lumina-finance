import { useMemo, useState } from 'react'
import type {
  InsightsComparisonPeriod,
  InsightsRangeInputDates,
  InsightsRangePreset,
  SavedInsightsRangeUnit,
} from '../types/range'
import { getRangeComparisonPeriod, getRangeInputDates, getRelativeRangeInputDates } from '../utils/range'

// The relative builder opens on a familiar three-month look-back when Custom is first picked
const DEFAULT_RELATIVE_AMOUNT = 3
const DEFAULT_RELATIVE_UNIT: SavedInsightsRangeUnit = 'month'

export type InsightsRangeState = {
  rangePreset: InsightsRangePreset
  setRangePreset: (value: InsightsRangePreset) => void
  relativeAmount: number
  relativeUnit: SavedInsightsRangeUnit
  setRelativeAmount: (value: number) => void
  setRelativeUnit: (value: SavedInsightsRangeUnit) => void
  applyRelativeRange: (amount: number, unit: SavedInsightsRangeUnit) => void
  rangeInputDates: InsightsRangeInputDates
  comparisonPeriod: InsightsComparisonPeriod
  cardTransitionKey: string
  cardQueriesEnabled: boolean
}

/**
 * Owns insight range presets, the relative custom-window builder, query enablement, and
 * card transition keys
 */
export function useInsightsRange(): InsightsRangeState {
  const initialRangeInputDates = useMemo(() => getRangeInputDates('THIS_MONTH'), [])
  const [rangePreset, setRangePresetState] = useState<InsightsRangePreset>('THIS_MONTH')
  const [relativeAmount, setRelativeAmountState] = useState(DEFAULT_RELATIVE_AMOUNT)
  const [relativeUnit, setRelativeUnitState] = useState<SavedInsightsRangeUnit>(DEFAULT_RELATIVE_UNIT)
  const [rangeInputDates, setRangeInputDates] = useState<InsightsRangeInputDates>(initialRangeInputDates)
  const [comparisonPeriod, setComparisonPeriod] = useState<InsightsComparisonPeriod>(getRangeComparisonPeriod('THIS_MONTH'))

  const cardTransitionKey = `${rangeInputDates.from}:${rangeInputDates.to}:${comparisonPeriod}`
  const cardQueriesEnabled = rangeInputDates.from !== '' && rangeInputDates.to !== ''

  /**
   * Switches to a fixed preset, or re-resolves the rolling window when Custom is chosen
   */
  function setRangePreset(value: InsightsRangePreset) {
    setRangePresetState(value)
    setRangeInputDates(
      value === 'CUSTOM' ? getRelativeRangeInputDates(relativeAmount, relativeUnit) : getRangeInputDates(value),
    )
    setComparisonPeriod(getRangeComparisonPeriod(value))
  }

  /**
   * Makes a relative window the active range and remembers its amount and unit for saving
   */
  function applyRelativeRange(amount: number, unit: SavedInsightsRangeUnit) {
    setRangePresetState('CUSTOM')
    setRelativeAmountState(amount)
    setRelativeUnitState(unit)
    setRangeInputDates(getRelativeRangeInputDates(amount, unit))
    setComparisonPeriod(getRangeComparisonPeriod('CUSTOM'))
  }

  function setRelativeAmount(value: number) {
    applyRelativeRange(value, relativeUnit)
  }

  function setRelativeUnit(value: SavedInsightsRangeUnit) {
    applyRelativeRange(relativeAmount, value)
  }

  return {
    rangePreset,
    setRangePreset,
    relativeAmount,
    relativeUnit,
    setRelativeAmount,
    setRelativeUnit,
    applyRelativeRange,
    rangeInputDates,
    comparisonPeriod,
    cardTransitionKey,
    cardQueriesEnabled,
  }
}
