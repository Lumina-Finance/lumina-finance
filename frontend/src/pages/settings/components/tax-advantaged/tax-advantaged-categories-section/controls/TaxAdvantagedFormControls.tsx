import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { Currency } from '@/api/currency'
import type { TaxTreatment } from '@/api/taxAdvantagedCategories'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { TAX_TREATMENT_OPTIONS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/taxAdvantagedCategoryConstants'
import {
  currencySymbol,
  formatMoneyInput,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/taxAdvantagedCategoryUtils'
import { formatMoneyInputLive, sanitizeMoneyInput } from '@/utils/moneyInput'

export function TaxAdvantagedCurrencyWarning() {
  return (
    <span className="inline-flex h-4 items-center align-middle leading-none">
      <IconTooltip
        label="Tax-advantaged category currency limitation"
        level="important"
        widthClassName="w-56"
        size={14}
        strokeWidth={2.4}
      >
        Tax-advantaged categories currently link only accounts in the same currency.
      </IconTooltip>
    </span>
  )
}

export function CurrencyInput({
  ariaLabel,
  currencies,
  currency,
  onBlur,
  onChange,
  placeholder,
  required = false,
  value,
}: {
  ariaLabel?: string
  currencies: Currency[]
  currency: string
  onBlur?: () => void
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  value: string
}) {
  const [focused, setFocused] = useState(false)
  const symbol = currencySymbol(currencies, currency)
  const displayValue = focused ? value : formatMoneyInput(value, currencies, currency)

  return (
    <div className="relative">
      {symbol && (
        <span
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
          style={{
            color: 'var(--app-text-subtle)',
            fontSize: '0.9375rem',
            lineHeight: 1,
          }}
          aria-hidden
        >
          {symbol}
        </span>
      )}
      <input
        aria-label={ariaLabel}
        className={`app-input w-full ${symbol ? 'pl-8' : ''}`}
        inputMode="decimal"
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onChange={(event) => onChange(sanitizeMoneyInput(event.target.value))}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        required={required}
        type="text"
        value={displayValue}
      />
    </div>
  )
}

export function InlineCurrencyInput({
  ariaLabel,
  currencies,
  currency,
  onBlur,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string
  currencies: Currency[]
  currency: string
  onBlur?: () => void
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  const [focused, setFocused] = useState(false)
  const symbol = currencySymbol(currencies, currency)
  const displayValue = focused ? value : formatMoneyInput(value, currencies, currency)

  return (
    <div
      className="group flex h-6 min-w-0 items-center gap-1"
      style={{ borderBottom: '1px solid var(--app-border-strong)' }}
    >
      {symbol && (
        <span className="shrink-0 text-[0.9375rem]" style={{ color: 'var(--app-text-subtle)' }} aria-hidden>
          {symbol}
        </span>
      )}
      <input
        aria-label={ariaLabel}
        className="block h-6 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-6 outline-none"
        inputMode="decimal"
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onChange={(event) => onChange(sanitizeMoneyInput(event.target.value))}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        style={{ color: 'var(--app-text)' }}
        type="text"
        value={displayValue}
      />
      <Pencil
        size={13}
        className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
        style={{ color: 'var(--app-text-subtle)' }}
        aria-hidden
      />
    </div>
  )
}

export function CompactCurrencyInput({
  ariaLabel,
  currencies,
  currency,
  onBlur,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string
  currencies: Currency[]
  currency: string
  onBlur?: () => void
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  const symbol = currencySymbol(currencies, currency)
  const displayValue = formatMoneyInputLive(value)

  return (
    <div
      className="group flex h-9 w-full min-w-0 items-center gap-1.5 rounded-md border border-transparent px-2 transition-colors duration-150 hover:border-[var(--app-border)] focus-within:border-[var(--app-accent-border)]"
      style={{ background: 'color-mix(in srgb, var(--app-input-bg) 55%, var(--app-bg))' }}
    >
      {symbol && (
        <span className="shrink-0 text-[0.9375rem]" style={{ color: 'var(--app-text-subtle)' }} aria-hidden>
          {symbol}
        </span>
      )}
      <input
        aria-label={ariaLabel}
        className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
        inputMode="decimal"
        onBlur={() => {
          onBlur?.()
        }}
        onChange={(event) => onChange(sanitizeMoneyInput(event.target.value))}
        placeholder={placeholder}
        style={{ color: 'var(--app-text)' }}
        type="text"
        value={displayValue}
      />
      <Pencil
        size={13}
        className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
        style={{ color: 'var(--app-text-subtle)' }}
        aria-hidden
      />
    </div>
  )
}

export function InlineTaxTreatmentSelect({
  onBlur,
  onChange,
  value,
}: {
  onBlur?: () => void
  onChange: (value: TaxTreatment) => void
  value: TaxTreatment
}) {
  return (
    <div
      className="group flex h-6 min-w-0 items-center gap-1"
      style={{ borderBottom: '1px solid var(--app-border-strong)' }}
    >
      <select
        aria-label="Category type"
        className="block h-6 min-w-0 flex-1 appearance-none bg-transparent text-[0.9375rem] font-medium leading-6 outline-none"
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value as TaxTreatment)}
        style={{ color: 'var(--app-text)' }}
        value={value}
      >
        {TAX_TREATMENT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Pencil
        size={13}
        className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
        style={{ color: 'var(--app-text-subtle)' }}
        aria-hidden
      />
    </div>
  )
}
