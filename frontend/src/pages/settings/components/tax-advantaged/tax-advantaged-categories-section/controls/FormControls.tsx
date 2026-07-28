import { Pencil } from 'lucide-react'
import type { Currency } from '@/api/currency'
import type { TaxTreatment } from '@/api/tax-advantaged-categories'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { TAX_TREATMENT_OPTIONS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import { currencySymbol } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'
import { getCurrencyExponent, getMoneyPlaceholder } from '@/utils/moneyInput'

/**
 * Tooltip icon warning that tax-advantaged categories only link accounts sharing the category's
 * currency
 */
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

/**
 * Bordered money input that shows the currency symbol and renders its value through the shared
 * money-input formatting, in the browser's own locale convention
 */
export function CurrencyInput({
  ariaLabel,
  currencies,
  currency,
  id,
  onBlur,
  onChange,
  placeholder,
  required = false,
  value,
}: {
  ariaLabel?: string
  currencies: Currency[]
  currency: string
  id?: string
  onBlur?: () => void
  onChange: (value: string) => void

  // Left out to show the currency's own zero. A word is passed instead where telling the user the
  // field is required or optional helps more than showing the amount format
  placeholder?: string
  required?: boolean
  value: string
}) {
  const symbol = currencySymbol(currencies, currency)
  const exponent = getCurrencyExponent(currencies, currency)
  const moneyInput = useMoneyInput({
    value,
    exponent,
    onChange,
    onBlur,
  })

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
        id={id}
        className={`app-input w-full ${symbol ? 'pl-8' : ''}`}
        placeholder={placeholder ?? getMoneyPlaceholder(exponent)}
        required={required}
        {...moneyInput}
      />
    </div>
  )
}

/**
 * Compact bordered money input used in modal fields, rendering its value through the shared
 * money-input formatting like the other currency inputs
 */
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

  // Left out to show the currency's own zero. A word is passed instead where telling the user the
  // field is required or optional helps more than showing the amount format
  placeholder?: string
  value: string
}) {
  const symbol = currencySymbol(currencies, currency)
  const exponent = getCurrencyExponent(currencies, currency)
  const moneyInput = useMoneyInput({
    value,
    exponent,
    onChange,
    onBlur,
  })

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
        style={{ color: 'var(--app-text)' }}
        placeholder={placeholder ?? getMoneyPlaceholder(exponent)}
        {...moneyInput}
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

/**
 * Underlined select for choosing a category's tax treatment inline, styled to match the other
 * inline editors
 */
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
