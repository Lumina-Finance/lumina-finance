import { useState, type ChangeEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'
import type { SavedInsightsRangeQualifier, SavedInsightsRangeUnit } from '../types/range'

const RELATIVE_UNITS: SavedInsightsRangeUnit[] = ['day', 'week', 'month', 'quarter', 'year']

// This and Last name whole calendar periods, so they hide the day unit, and This takes no count
const QUALIFIER_OPTIONS: {
  value: SavedInsightsRangeQualifier
  label: string
  allowsDay: boolean
  hasCount: boolean
}[] = [
  { value: 'this', label: 'This', allowsDay: false, hasCount: false },
  { value: 'last', label: 'Last', allowsDay: false, hasCount: true },
  { value: 'past', label: 'Past', allowsDay: true, hasCount: true },
]

// Restored when the amount field is left empty or invalid
const DEFAULT_RELATIVE_AMOUNT = 3

/**
 * Labels a unit singular or plural, for example "month" or "months"
 */
function formatUnitLabel(unit: SavedInsightsRangeUnit, plural: boolean) {
  return plural ? `${unit}s` : unit
}

type RelativeRangeBuilderProps = {
  amount: number
  unit: SavedInsightsRangeUnit
  qualifier: SavedInsightsRangeQualifier
  onAmountChange: (value: number) => void
  onUnitChange: (value: SavedInsightsRangeUnit) => void
  onQualifierChange: (value: SavedInsightsRangeQualifier) => void
}

/**
 * Renders the custom insights window builder: a This/Last/Past qualifier with a period unit, plus
 * a count for the Last and Past qualifiers
 */
export function RelativeRangeBuilder({
  amount,
  unit,
  qualifier,
  onAmountChange,
  onUnitChange,
  onQualifierChange,
}: RelativeRangeBuilderProps) {
  const [unitMenuOpen, setUnitMenuOpen] = useState(false)
  const [amountText, setAmountText] = useState(String(amount))
  const [trackedAmount, setTrackedAmount] = useState(amount)

  const activeQualifier = QUALIFIER_OPTIONS.find((option) => option.value === qualifier) ?? QUALIFIER_OPTIONS[2]
  const usePlural = activeQualifier.hasCount && amount !== 1
  const unitOptions = activeQualifier.allowsDay ? RELATIVE_UNITS : RELATIVE_UNITS.filter((value) => value !== 'day')

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
      <div className="app-range-qualifier" role="tablist" aria-label="Relative range type">
        {QUALIFIER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={option.value === qualifier}
            className={joinClassNames(
              'app-range-seg-option',
              option.value === qualifier && 'app-range-seg-option-active',
            )}
            onClick={() => onQualifierChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {activeQualifier.hasCount && (
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
        )}
        <button
          type="button"
          className="app-input flex min-w-0 flex-1 items-center justify-between gap-2"
          aria-expanded={unitMenuOpen}
          aria-label="Relative range unit"
          onClick={() => setUnitMenuOpen((current) => !current)}
        >
          <span className="truncate">{formatUnitLabel(unit, usePlural)}</span>
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
            {unitOptions.map((value) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={value === unit}
                className={joinClassNames(
                  'app-range-unit-option',
                  value === unit && 'app-range-unit-option-active',
                )}
                onClick={() => selectUnit(value)}
              >
                {formatUnitLabel(value, usePlural)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
