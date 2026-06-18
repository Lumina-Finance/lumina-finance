import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { TimeRangeSelector, type TimeRangeSelectorOption } from '@/components/time-range/Selector'
import type { SavedInsightsRange } from '@/api/insights'
import type { InsightsRangePreset, SavedInsightsRangeUnit } from '../types/range'
import { RelativeRangeBuilder } from './RelativeRangeBuilder'
import { SavedRanges } from './SavedRanges'

const INSIGHTS_RANGE_OPTIONS: TimeRangeSelectorOption<InsightsRangePreset>[] = [
  { value: 'THIS_MONTH', label: 'MTD', description: 'This month' },
  { value: 'LAST_MONTH', label: 'LM', description: 'Last month' },
  { value: 'LAST_30_DAYS', label: '30D', description: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: '90D', description: 'Last 90 days' },
  { value: 'THIS_YEAR', label: 'YTD', description: 'This year' },
  { value: 'CUSTOM', label: 'Custom' },
]

const customPanelTransition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const

type InsightsFloatingRangeControlProps = {
  preset: InsightsRangePreset
  relativeAmount: number
  relativeUnit: SavedInsightsRangeUnit
  resolvedFrom: string
  resolvedTo: string
  savedRanges: SavedInsightsRange[]
  onPresetChange: (value: InsightsRangePreset) => void
  onRelativeAmountChange: (value: number) => void
  onRelativeUnitChange: (value: SavedInsightsRangeUnit) => void
  onSaveCurrentRange: (name: string) => Promise<void>
  onApplySavedRange: (range: SavedInsightsRange) => void
  onDeleteSavedRange: (rangeId: string) => void
}

/**
 * Renders the sticky insights range picker, the relative custom-window builder, and the
 * list of saved ranges
 */
export function InsightsFloatingRangeControl({
  preset,
  relativeAmount,
  relativeUnit,
  resolvedFrom,
  resolvedTo,
  savedRanges,
  onPresetChange,
  onRelativeAmountChange,
  onRelativeUnitChange,
  onSaveCurrentRange,
  onApplySavedRange,
  onDeleteSavedRange,
}: InsightsFloatingRangeControlProps) {
  const isCustom = preset === 'CUSTOM'
  const shouldReduceMotion = useReducedMotion()

  /**
   * Keeps desktop and mobile floating controls structurally identical
   */
  const renderControl = (dropdownPlacement?: 'bottom' | 'top') => (
    <div
      className="app-card rounded-xl p-3"
      style={{
        background: 'color-mix(in srgb, var(--app-accent) 12%, var(--app-bg))',
        borderColor: 'transparent',
      }}
    >
      <TimeRangeSelector
        value={preset}
        options={INSIGHTS_RANGE_OPTIONS}
        onChange={onPresetChange}
        ariaLabel="Insights date range"
        variant="mobile"
        className="w-full"
        sheetTitle="Insights date range"
        dropdownPlacement={dropdownPlacement}
        shortcutMode="when-description-differs"
      />
      <AnimatePresence initial={false}>
        {isCustom && (
          <motion.div
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : customPanelTransition}
            className="overflow-hidden"
          >
            <RelativeRangeBuilder
              amount={relativeAmount}
              unit={relativeUnit}
              resolvedFrom={resolvedFrom}
              resolvedTo={resolvedTo}
              onAmountChange={onRelativeAmountChange}
              onUnitChange={onRelativeUnitChange}
            />
            <SavedRanges
              savedRanges={savedRanges}
              onSaveCurrentRange={onSaveCurrentRange}
              onApplySavedRange={onApplySavedRange}
              onDeleteSavedRange={onDeleteSavedRange}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-20 min-[1050px]:hidden">
        <div className="pointer-events-auto">
          {renderControl('top')}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 z-40 hidden min-[1050px]:block">
        <div className="sticky top-6 flex justify-end">
          <div className="pointer-events-auto w-[24rem]">
            {renderControl()}
          </div>
        </div>
      </div>
    </>
  )
}
