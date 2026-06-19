import { useState, type ChangeEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'
import type { SavedInsightsRangeUnit } from '../types/range'

const RELATIVE_UNIT_OPTIONS: { value: SavedInsightsRangeUnit; label: string }[] = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
  { value: 'month', label: 'months' },
  { value: 'quarter', label: 'quarters' },
  { value: 'year', label: 'years' },
]

// Restored when the amount field is left empty or invalid
const DEFAULT_RELATIVE_AMOUNT = 3

type RelativeRangeBuilderProps = {
  amount: number
  unit: SavedInsightsRangeUnit
  onAmountChange: (value: number) => void
  onUnitChange: (value: SavedInsightsRangeUnit) => void
}

/**
 * Renders the "Last N units" builder for the custom insights window
 */
export function RelativeRangeBuilder({
  amount,
  unit,
  onAmountChange,
  onUnitChange,
}: RelativeRangeBuilderProps) {
  const [unitMenuOpen, setUnitMenuOpen] = useState(false)
  const [amountText, setAmountText] = useState(String(amount))
  const [trackedAmount, setTrackedAmount] = useState(amount)
  const unitLabel = RELATIVE_UNIT_OPTIONS.find((option) => option.value === unit)?.label ?? unit

  // Reflect amounts applied from presets or saved ranges back into the editable field
  if (amount !== trackedAmount) {
    setTrackedAmount(amount)
    setAmountText(String(amount))
  }

  /**
   * Lets the field be cleared while typing and commits only whole amounts of at least one
   */
  function handleAmountChange(event: ChangeEvent<HTMLInputElement>) {
    const nextText = event.target.value
    setAmountText(nextText)
    const parsed = Number.parseInt(nextText, 10)
    if (Number.isFinite(parsed) && parsed >= 1) {
      onAmountChange(parsed)
    }
  }

  /**
   * Falls back to the default amount when the field is left empty or invalid
   */
  function handleAmountBlur() {
    const parsed = Number.parseInt(amountText, 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setAmountText(String(DEFAULT_RELATIVE_AMOUNT))
      onAmountChange(DEFAULT_RELATIVE_AMOUNT)
      return
    }
    setAmountText(String(parsed))
  }

  function selectUnit(value: SavedInsightsRangeUnit) {
    onUnitChange(value)
    setUnitMenuOpen(false)
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>Last</span>
        <input
          type="number"
          min={1}
          step={1}
          value={amountText}
          onChange={handleAmountChange}
          onBlur={handleAmountBlur}
          className="app-input app-input-no-spinner w-16 text-center tabular-nums"
          aria-label="Relative range amount"
        />
        <button
          type="button"
          className="app-input flex min-w-0 flex-1 items-center justify-between gap-2"
          aria-expanded={unitMenuOpen}
          aria-label="Relative range unit"
          onClick={() => setUnitMenuOpen((current) => !current)}
        >
          <span className="truncate">{unitLabel}</span>
          <ChevronDown
            size={15}
            aria-hidden
            className={joinClassNames('shrink-0 transition-transform', unitMenuOpen && 'rotate-180')}
            style={{ color: 'var(--app-text-subtle)' }}
          />
        </button>
      </div>

      <div className={joinClassNames('app-range-unit-menu', unitMenuOpen && 'app-range-unit-menu-open')}>
        <div className="app-range-unit-menu-body">
          <div className="app-range-unit-list" role="listbox" aria-label="Relative range unit">
            {RELATIVE_UNIT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === unit}
                className={joinClassNames(
                  'app-range-unit-option',
                  option.value === unit && 'app-range-unit-option-active',
                )}
                onClick={() => selectUnit(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
