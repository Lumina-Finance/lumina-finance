import { useMemo, useState } from 'react'
import type {
  InsightsComparisonPeriod,
  SavedInsightsRange,
  SavedInsightsRangeQualifier,
  SavedInsightsRangeUnit,
} from '@/api/insights'
import type { InsightsRangeInputDates, InsightsRangePreset } from '../types/range'
import { getRangeComparisonPeriod, getRangeInputDates, getRelativeRangeInputDates } from '../utils/range'

// The relative builder opens on a familiar three-month rolling window when Custom is first picked
const DEFAULT_RELATIVE_AMOUNT = 3
const DEFAULT_RELATIVE_UNIT: SavedInsightsRangeUnit = 'month'
const DEFAULT_RELATIVE_QUALIFIER: SavedInsightsRangeQualifier = 'past'

/**
 * The applied range that drives the cards and the collapsed pill. It is committed only on a fixed
 * preset click, Apply, Save, or applying a saved range, never while the builder draft is edited
 */
type CommittedRange = {
  preset: InsightsRangePreset
  amount: number
  unit: SavedInsightsRangeUnit
  qualifier: SavedInsightsRangeQualifier
  savedRangeName: string | null
  inputDates: InsightsRangeInputDates
  comparisonPeriod: InsightsComparisonPeriod
}

export type InsightsRangeState = {
  // Preset highlighted in the control, which reads CUSTOM while the builder is being edited
  selectedPreset: InsightsRangePreset
  selectPreset: (value: InsightsRangePreset) => void
  revertSelection: () => void
  // Draft window shown in the builder, applied to the cards only on commit
  draftAmount: number
  draftUnit: SavedInsightsRangeUnit
  draftQualifier: SavedInsightsRangeQualifier
  draftInputDates: InsightsRangeInputDates
  setDraftAmount: (value: number) => void
  setDraftUnit: (value: SavedInsightsRangeUnit) => void
  setDraftQualifier: (value: SavedInsightsRangeQualifier) => void
  // Commits the draft window, optionally tagging it with the name it was just saved under
  applyDraft: (savedRangeName?: string | null) => void
  applySavedRange: (savedRange: SavedInsightsRange) => void
  // Applied range, for the collapsed pill label and the card queries
  appliedPreset: InsightsRangePreset
  appliedAmount: number
  appliedUnit: SavedInsightsRangeUnit
  appliedQualifier: SavedInsightsRangeQualifier
  appliedSavedRangeName: string | null
  rangeInputDates: InsightsRangeInputDates
  comparisonPeriod: InsightsComparisonPeriod
  cardTransitionKey: string
  cardQueriesEnabled: boolean
}

/**
 * Owns insight range presets, the relative custom-window builder draft, the committed range the
 * cards query, query enablement, and card transition keys
 */
export function useInsightsRange(): InsightsRangeState {
  const initialDates = useMemo(() => getRangeInputDates('THIS_MONTH'), [])
  const [selectedPreset, setSelectedPreset] = useState<InsightsRangePreset>('THIS_MONTH')
  const [draftAmount, setDraftAmountState] = useState(DEFAULT_RELATIVE_AMOUNT)
  const [draftUnit, setDraftUnitState] = useState<SavedInsightsRangeUnit>(DEFAULT_RELATIVE_UNIT)
  const [draftQualifier, setDraftQualifierState] = useState<SavedInsightsRangeQualifier>(DEFAULT_RELATIVE_QUALIFIER)
  const [committed, setCommitted] = useState<CommittedRange>({
    preset: 'THIS_MONTH',
    amount: DEFAULT_RELATIVE_AMOUNT,
    unit: DEFAULT_RELATIVE_UNIT,
    qualifier: DEFAULT_RELATIVE_QUALIFIER,
    savedRangeName: null,
    inputDates: initialDates,
    comparisonPeriod: getRangeComparisonPeriod('THIS_MONTH'),
  })

  const draftInputDates = getRelativeRangeInputDates(draftAmount, draftUnit, draftQualifier)
  const cardTransitionKey = `${committed.inputDates.from}:${committed.inputDates.to}:${committed.comparisonPeriod}`
  const cardQueriesEnabled = committed.inputDates.from !== '' && committed.inputDates.to !== ''

  /**
   * Highlights a preset segment. Fixed presets apply and query immediately, while Custom only
   * opens the builder and seeds the draft from the applied range when that range is already custom
   */
  function selectPreset(value: InsightsRangePreset) {
    setSelectedPreset(value)
    if (value === 'CUSTOM') {
      if (committed.preset === 'CUSTOM') {
        setDraftAmountState(committed.amount)
        setDraftUnitState(committed.unit)
        setDraftQualifierState(committed.qualifier)
      }
      return
    }
    setCommitted({
      preset: value,
      amount: committed.amount,
      unit: committed.unit,
      qualifier: committed.qualifier,
      savedRangeName: null,
      inputDates: getRangeInputDates(value),
      comparisonPeriod: getRangeComparisonPeriod(value),
    })
  }

  /**
   * Returns the highlight to the applied range, used when the panel is dismissed without
   * committing so an abandoned Custom selection does not stay highlighted
   */
  function revertSelection() {
    setSelectedPreset(committed.preset)
  }

  function setDraftAmount(value: number) {
    setSelectedPreset('CUSTOM')
    setDraftAmountState(value)
  }

  function setDraftUnit(value: SavedInsightsRangeUnit) {
    setSelectedPreset('CUSTOM')
    setDraftUnitState(value)
  }

  function setDraftQualifier(value: SavedInsightsRangeQualifier) {
    setSelectedPreset('CUSTOM')
    setDraftQualifierState(value)
    // Only a rolling window counts days, so This and Last fall back to whole weeks
    if (value !== 'past' && draftUnit === 'day') {
      setDraftUnitState('week')
    }
  }

  /**
   * Commits the current draft as the applied range, tagging it with a saved range name when the
   * commit came from saving so the pill reads as that saved range
   */
  function applyDraft(savedRangeName: string | null = null) {
    setSelectedPreset('CUSTOM')
    setCommitted({
      preset: 'CUSTOM',
      amount: draftAmount,
      unit: draftUnit,
      qualifier: draftQualifier,
      savedRangeName,
      inputDates: getRelativeRangeInputDates(draftAmount, draftUnit, draftQualifier),
      comparisonPeriod: getRangeComparisonPeriod('CUSTOM'),
    })
  }

  /**
   * Applies a saved range, committing it and seeding the draft so reopening the builder shows it
   */
  function applySavedRange(savedRange: SavedInsightsRange) {
    setSelectedPreset('CUSTOM')
    setDraftAmountState(savedRange.amount)
    setDraftUnitState(savedRange.unit)
    setDraftQualifierState(savedRange.qualifier)
    setCommitted({
      preset: 'CUSTOM',
      amount: savedRange.amount,
      unit: savedRange.unit,
      qualifier: savedRange.qualifier,
      savedRangeName: savedRange.name,
      inputDates: getRelativeRangeInputDates(savedRange.amount, savedRange.unit, savedRange.qualifier),
      comparisonPeriod: getRangeComparisonPeriod('CUSTOM'),
    })
  }

  return {
    selectedPreset,
    selectPreset,
    revertSelection,
    draftAmount,
    draftUnit,
    draftQualifier,
    draftInputDates,
    setDraftAmount,
    setDraftUnit,
    setDraftQualifier,
    applyDraft,
    applySavedRange,
    appliedPreset: committed.preset,
    appliedAmount: committed.amount,
    appliedUnit: committed.unit,
    appliedQualifier: committed.qualifier,
    appliedSavedRangeName: committed.savedRangeName,
    rangeInputDates: committed.inputDates,
    comparisonPeriod: committed.comparisonPeriod,
    cardTransitionKey,
    cardQueriesEnabled,
  }
}
