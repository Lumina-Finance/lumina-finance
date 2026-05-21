import { InsightsRangeSelector, type InsightsRangeSelectorOption } from './InsightsRangeSelector'
import type { InsightsRangePreset } from '../types/range'
import type { KeyboardEvent } from 'react'

const INSIGHTS_RANGE_OPTIONS: InsightsRangeSelectorOption<InsightsRangePreset>[] = [
  { value: 'THIS_MONTH', label: 'MTD', description: 'This month' },
  { value: 'LAST_MONTH', label: 'LM', description: 'Last month' },
  { value: 'LAST_30_DAYS', label: '30D', description: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: '90D', description: 'Last 90 days' },
  { value: 'THIS_YEAR', label: 'YTD', description: 'This year' },
  { value: 'CUSTOM', label: 'Custom' },
]

type InsightsFloatingRangeControlProps = {
  preset: InsightsRangePreset
  fromDateValue: string
  toDateValue: string
  customInvalid: boolean
  onPresetChange: (value: InsightsRangePreset) => void
  onCustomFromChange: (value: string) => void
  onCustomToChange: (value: string) => void
  onCustomRangeCommit: () => void
}

export function InsightsFloatingRangeControl({
  preset,
  fromDateValue,
  toDateValue,
  customInvalid,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
  onCustomRangeCommit,
}: InsightsFloatingRangeControlProps) {
  function handleCustomFromChange(value: string) {
    onCustomFromChange(value)
  }

  function handleCustomToChange(value: string) {
    onCustomToChange(value)
  }

  function handleDateKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      onCustomRangeCommit()
      event.currentTarget.blur()
    }
  }

  const dateFields = (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <input
          type="date"
          className={`app-input app-date-input-balanced min-w-0 ${customInvalid ? 'app-input-error' : ''}`}
          aria-label="Insights start date"
          value={fromDateValue}
          onChange={(event) => handleCustomFromChange(event.target.value)}
          onBlur={onCustomRangeCommit}
          onKeyDown={handleDateKeyDown}
        />
        <span className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
          to
        </span>
        <input
          type="date"
          className={`app-input app-date-input-balanced min-w-0 ${customInvalid ? 'app-input-error' : ''}`}
          aria-label="Insights end date"
          value={toDateValue}
          onChange={(event) => handleCustomToChange(event.target.value)}
          onBlur={onCustomRangeCommit}
          onKeyDown={handleDateKeyDown}
        />
      </div>
      {customInvalid && (
        <p className="mt-1 text-xs" style={{ color: 'var(--app-negative)' }}>
          Start date must be on or before end date.
        </p>
      )}
    </div>
  )

  const renderControl = (dropdownPlacement?: 'bottom' | 'top') => (
    <div
      className="app-card rounded-xl p-3"
      style={{
        background: 'color-mix(in srgb, var(--app-accent) 12%, var(--app-bg))',
        borderColor: 'transparent',
      }}
    >
      <InsightsRangeSelector
        value={preset}
        options={INSIGHTS_RANGE_OPTIONS}
        onChange={onPresetChange}
        ariaLabel="Insights date range"
        className="w-full"
        sheetTitle="Insights date range"
        dropdownPlacement={dropdownPlacement}
      />
      <div className="mt-2">
        {dateFields}
      </div>
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
