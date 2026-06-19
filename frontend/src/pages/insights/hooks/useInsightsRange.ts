import { useMemo, useState } from 'react'
import type { SavedInsightsRange } from '@/api/insights'
import type {
  InsightsComparisonPeriod,
  InsightsRangeInputDates,
  InsightsRangePreset,
  SavedInsightsRangeQualifier,
  SavedInsightsRangeUnit,
} from '../types/range'
import { getRangeComparisonPeriod, getRangeInputDates, getRelativeRangeInputDates } from '../utils/range'

// The relative builder opens on a familiar three-month rolling window when Custom is first picked
const DEFAULT_RELATIVE_AMOUNT = 3
const DEFAULT_RELATIVE_UNIT: SavedInsightsRangeUnit = 'month'
const DEFAULT_RELATIVE_QUALIFIER: SavedInsightsRangeQualifier = 'past'

export type InsightsRangeState = {
  rangePreset: InsightsRangePreset
  setRangePreset: (value: InsightsRangePreset) => void
  relativeAmount: number
  relativeUnit: SavedInsightsRangeUnit
  relativeQualifier: SavedInsightsRangeQualifier
  setRelativeAmount: (value: number) => void
  setRelativeUnit: (value: SavedInsightsRangeUnit) => void
  setRelativeQualifier: (value: SavedInsightsRangeQualifier) => void
  applySavedRange: (savedRange: SavedInsightsRange) => void
  // Name of the saved range currently applied, shown as the pill label until the window changes
  appliedSavedRangeName: string | null
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
  const [relativeQualifier, setRelativeQualifierState] = useState<SavedInsightsRangeQualifier>(DEFAULT_RELATIVE_QUALIFIER)
  const [rangeInputDates, setRangeInputDates] = useState<InsightsRangeInputDates>(initialRangeInputDates)
  const [comparisonPeriod, setComparisonPeriod] = useState<InsightsComparisonPeriod>(getRangeComparisonPeriod('THIS_MONTH'))
  const [appliedSavedRangeName, setAppliedSavedRangeName] = useState<string | null>(null)

  const cardTransitionKey = `${rangeInputDates.from}:${rangeInputDates.to}:${comparisonPeriod}`
  const cardQueriesEnabled = rangeInputDates.from !== '' && rangeInputDates.to !== ''

  /**
   * Switches to a fixed preset, or re-resolves the relative window when Custom is chosen
   */
  function setRangePreset(value: InsightsRangePreset) {
    setRangePresetState(value)
    setRangeInputDates(
      value === 'CUSTOM'
        ? getRelativeRangeInputDates(relativeAmount, relativeUnit, relativeQualifier)
        : getRangeInputDates(value),
    )
    setComparisonPeriod(getRangeComparisonPeriod(value))
    setAppliedSavedRangeName(null)
  }

  /**
   * Makes a relative window the active range, normalizing inputs a qualifier cannot hold, and
   * clearing any saved range name since a manually built window no longer matches a saved one
   */
  function applyRelativeRange(amount: number, unit: SavedInsightsRangeUnit, qualifier: SavedInsightsRangeQualifier) {
    // Only a rolling window counts days, so This and Last fall back to whole weeks. The count is
    // kept across qualifier switches even for This, whose resolver and label ignore it anyway
    const normalizedUnit = qualifier !== 'past' && unit === 'day' ? 'week' : unit

    setRangePresetState('CUSTOM')
    setRelativeAmountState(amount)
    setRelativeUnitState(normalizedUnit)
    setRelativeQualifierState(qualifier)
    setRangeInputDates(getRelativeRangeInputDates(amount, normalizedUnit, qualifier))
    setComparisonPeriod(getRangeComparisonPeriod('CUSTOM'))
    setAppliedSavedRangeName(null)
  }

  /**
   * Applies a saved range's window and keeps its name so the pill reads as that saved range
   */
  function applySavedRange(savedRange: SavedInsightsRange) {
    applyRelativeRange(savedRange.amount, savedRange.unit, savedRange.qualifier)
    setAppliedSavedRangeName(savedRange.name)
  }

  function setRelativeAmount(value: number) {
    applyRelativeRange(value, relativeUnit, relativeQualifier)
  }

  function setRelativeUnit(value: SavedInsightsRangeUnit) {
    applyRelativeRange(relativeAmount, value, relativeQualifier)
  }

  function setRelativeQualifier(value: SavedInsightsRangeQualifier) {
    applyRelativeRange(relativeAmount, relativeUnit, value)
  }

  return {
    rangePreset,
    setRangePreset,
    relativeAmount,
    relativeUnit,
    relativeQualifier,
    setRelativeAmount,
    setRelativeUnit,
    setRelativeQualifier,
    applySavedRange,
    appliedSavedRangeName,
    rangeInputDates,
    comparisonPeriod,
    cardTransitionKey,
    cardQueriesEnabled,
  }
}
