import DateField from '@/components/date-field/DateField'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import IconTooltip from '@/components/tooltips/IconTooltip'
import TransactionModalFieldLabelRow from '@/pages/transactions/components/transaction-modal/controls/FieldLabelRow'
import TransactionModalSectionFrame from '@/pages/transactions/components/transaction-modal/controls/SectionFrame'
import { formatMoneyInputLive } from '@/utils/moneyInput'

interface TransactionDetailsSectionProps {
  date: string
  dateError?: string | false
  currencyOptions: DropdownOption[]
  currencyValue: string
  currencyPlaceholder: string
  selectedCurrencySymbol: string
  amount: string
  amountError?: string | false
  notes: string
  readOnly: boolean
  onDateChange: (value: string) => void
  onDateBlur: () => void
  onAmountChange: (value: string) => void
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
  notes,
  readOnly,
  onDateChange,
  onDateBlur,
  onAmountChange,
  onAmountBlur,
  onNotesChange,
}: TransactionDetailsSectionProps) {
  return (
    <TransactionModalSectionFrame number="03" title="Details">
      <div className="grid gap-3 sm:grid-cols-[11rem_8.5rem_minmax(0,1fr)]">
        <div>
          <TransactionModalFieldLabelRow htmlFor="txn-date" label="Date" error={dateError} />
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
          <TransactionModalFieldLabelRow htmlFor="txn-amount" label="Amount" error={amountError} />
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
              type="text"
              inputMode="decimal"
              className={`app-input w-full disabled:cursor-not-allowed disabled:opacity-60 ${selectedCurrencySymbol ? 'pl-8' : ''} ${amountError ? 'app-input-error' : ''}`}
              placeholder="0.00"
              value={formatMoneyInputLive(amount)}
              disabled={readOnly}
              onChange={(event) => onAmountChange(event.target.value)}
              onBlur={onAmountBlur}
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
    </TransactionModalSectionFrame>
  )
}
