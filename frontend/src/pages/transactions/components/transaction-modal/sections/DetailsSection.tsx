import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import DateField from '@/components/date-field/DateField'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { getMoneyPlaceholder } from '@/utils/moneyInput'
import {
  CURRENCY_AMOUNT_NOTICE,
  CURRENCY_AMOUNT_UNKNOWN,
  CURRENCY_LIST_LOADING,
  CURRENCY_LIST_NOTICE,
  type CurrencyListState,
} from '@/utils/currencyStatus'

interface TransactionDetailsSectionProps {
  date: string
  dateError?: string | false
  currencyOptions: DropdownOption[]
  currencyValue: string
  currencyPlaceholder: string
  selectedCurrencySymbol: string
  amount: string
  amountError?: string | false

  // Whether the amount stands down, decided by the modal from the transaction's own currency rather
  // than recomputed here, so the field the form treats as locked is the field the user sees disabled
  isAmountLocked: boolean

  // Which of the reasons the amount stands down for, since a list still arriving is worth waiting
  // out, one that failed is worth a reload, and one that simply does not carry the currency is
  // neither. The lock itself is decided above rather than read off this
  currencyState: CurrencyListState
  currencyExponent: number
  notes: string
  readOnly: boolean
  onDateChange: (value: string) => void
  onDateBlur: () => void
  onAmountChange: (value: string, typed?: string) => void
  onAmountBlur: () => void
  onNotesChange: (value: string) => void
}

/**
 * Renders date, currency, amount, and notes controls for the transaction form
 */
export default function TransactionDetailsSection({
  date,
  dateError,
  currencyOptions,
  currencyValue,
  currencyPlaceholder,
  selectedCurrencySymbol,
  amount,
  amountError,
  isAmountLocked,
  currencyState,
  currencyExponent,
  notes,
  readOnly,
  onDateChange,
  onDateBlur,
  onAmountChange,
  onAmountBlur,
  onNotesChange,
}: TransactionDetailsSectionProps) {
  const amountInput = useMoneyInput({
    value: amount,
    exponent: currencyExponent,
    onChange: onAmountChange,
    onBlur: onAmountBlur,
  })

  return (
    <CreateModalSectionFrame step="03" title="Details">
      <div className="grid gap-3 sm:grid-cols-[11rem_8.5rem_minmax(0,1fr)]">
        <div>
          <CreateModalFieldLabelRow htmlFor="txn-date" label="Date" error={dateError} />
          <DateField
            id="txn-date"
            ariaLabel="Date"
            value={date}
            error={!!dateError}
            disabled={readOnly}
            onChange={onDateChange}
            onBlur={onDateBlur}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <label className="app-label block text-[0.9375rem] leading-5">Currency</label>
            <IconTooltip label="Transaction currency limitation">
              Locked to the selected account's currency
            </IconTooltip>
            {currencyState === 'loading' && (
              <IconTooltip label="Loading currencies" modalFieldTabStop>
                {CURRENCY_LIST_LOADING}
              </IconTooltip>
            )}
            {currencyState === 'unavailable' && (
              <IconTooltip label="Currency list unavailable" level="important" modalFieldTabStop>
                {CURRENCY_LIST_NOTICE}
              </IconTooltip>
            )}
          </div>
          <Dropdown
            options={currencyOptions}
            value={currencyValue}
            onChange={() => undefined}
            placeholder={currencyPlaceholder}
            searchable
            searchPlaceholder="Search currencies..."
            disabled
          />
        </div>
        <div>
          <CreateModalFieldLabelRow
            htmlFor="txn-amount"
            label={isAmountLocked ? (
              <span className="inline-flex items-center gap-2">
                Amount
                {currencyState === 'loading' ? (
                  <IconTooltip label="Loading currencies" modalFieldTabStop>
                    {CURRENCY_LIST_LOADING}
                  </IconTooltip>
                ) : (
                  <IconTooltip label="Amount unavailable" level="important" modalFieldTabStop>
                    {currencyState === 'unavailable' ? CURRENCY_AMOUNT_NOTICE : CURRENCY_AMOUNT_UNKNOWN}
                  </IconTooltip>
                )}
              </span>
            ) : 'Amount'}
            error={amountError}
          />
          <div className="relative">
            {selectedCurrencySymbol && (
              <span
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                style={{
                  color: 'var(--app-text-subtle)',
                  fontSize: '0.9375rem',
                  lineHeight: 1,
                }}
                aria-hidden
              >
                {selectedCurrencySymbol}
              </span>
            )}
            <input
              id="txn-amount"
              className={`app-input w-full disabled:cursor-not-allowed disabled:opacity-60 ${selectedCurrencySymbol ? 'pl-8' : ''} ${amountError ? 'app-input-error' : ''}`}
              placeholder={isAmountLocked ? undefined : getMoneyPlaceholder(currencyExponent)}
              disabled={readOnly || isAmountLocked}
              {...amountInput}
            />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="txn-notes" className="app-label mb-1.5 block text-[0.9375rem] leading-5">Notes</label>
        <input
          id="txn-notes"
          type="text"
          className="app-input disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Optional"
          value={notes}
          disabled={readOnly}
          onChange={(event) => onNotesChange(event.target.value)}
          maxLength={500}
        />
      </div>
    </CreateModalSectionFrame>
  )
}
