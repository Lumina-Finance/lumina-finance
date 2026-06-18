import { useId, type ChangeEvent } from 'react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import type { SavedInsightsRangeUnit } from '../types/range'

const RELATIVE_UNIT_OPTIONS: DropdownOption[] = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
  { value: 'month', label: 'months' },
  { value: 'quarter', label: 'quarters' },
  { value: 'year', label: 'years' },
]

type RelativeRangeBuilderProps = {
  amount: number
  unit: SavedInsightsRangeUnit
  resolvedFrom: string
  resolvedTo: string
  onAmountChange: (value: number) => void
  onUnitChange: (value: SavedInsightsRangeUnit) => void
}

/**
 * Renders the "Last N units" builder for the custom insights window, with the dates it
 * currently resolves to so a relative window never reads as abstract
 */
export function RelativeRangeBuilder({
  amount,
  unit,
  resolvedFrom,
  resolvedTo,
  onAmountChange,
  onUnitChange,
}: RelativeRangeBuilderProps) {
  const unitFieldId = useId()

  /**
   * Forwards only whole amounts of at least one so the window never inverts or empties
   */
  function handleAmountChange(event: ChangeEvent<HTMLInputElement>) {
    const parsed = Number.parseInt(event.target.value, 10)
    if (Number.isFinite(parsed) && parsed >= 1) {
      onAmountChange(parsed)
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>Last</span>
        <input
          type="number"
          min={1}
          step={1}
          value={amount}
          onChange={handleAmountChange}
          className="app-input app-input-no-spinner w-16 text-center tabular-nums"
          aria-label="Relative range amount"
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={unitFieldId} className="sr-only">Relative range unit</label>
          <Dropdown
            id={unitFieldId}
            options={RELATIVE_UNIT_OPTIONS}
            value={unit}
            onChange={(value) => onUnitChange(value as SavedInsightsRangeUnit)}
            className="app-input w-full"
          />
        </div>
      </div>
      <p className="mt-1 text-xs tabular-nums" style={{ color: 'var(--app-text-subtle)' }}>
        {resolvedFrom} to {resolvedTo}
      </p>
    </div>
  )
}
