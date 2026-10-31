import { useRef, type FocusEvent, type KeyboardEvent } from 'react'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import DateField from '@/components/date-field/DateField'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { useTransactionModalIds } from '@/components/transactions/transaction-modal/ids'
import ShortcutHint from '@/components/transactions/transaction-modal/controls/ShortcutHint'
import ShortcutHints from '@/components/transactions/transaction-modal/controls/ShortcutHints'
import { toShortcutKeyEvent } from '@/components/transactions/transaction-modal/hooks/useShortcuts'
import {
  getAriaFieldShortcut,
  getDateKeyAction,
  readIsMac,
} from '@/components/transactions/transaction-modal/utils/shortcuts'
import { useAuth } from '@/hooks/useAuth'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { getTodayYmd } from '@/utils/date'
import { getSymbolInputStyle } from '@/utils/formatCurrency'
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

  // Whether the amount is locked, decided by the modal from the transaction's own currency rather
  // than recomputed here, so the field the form treats as locked is the field the user sees disabled
  isAmountLocked: boolean

  // Which of the reasons the amount is locked for, since a list still arriving is worth waiting
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
  const ids = useTransactionModalIds()
  const { user } = useAuth()
  const amountInput = useMoneyInput({
    value: amount,
    exponent: currencyExponent,
    onChange: onAmountChange,
    onBlur: onAmountBlur,
  })

  // Set once a digit or an erase has edited the date since focus came into the field. From then on a `t`
  // is no longer a jump to today
  const editedDateRef = useRef(false)

  const handleDateKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only the segments, since the calendar popover opens over the field and its keys are its own
    if (readOnly || !(event.target instanceof HTMLInputElement)) return

    if (/^\d$/.test(event.key) || event.key === 'Backspace') {
      editedDateRef.current = true
      return
    }

    const action = getDateKeyAction(toShortcutKeyEvent(event, false, readIsMac()), editedDateRef.current)
    // The brackets step from any field and are taken by the dialogue's shortcuts, so only `t` is the date field's own
    if (action?.kind !== 'today') return

    // Taken here so the segment under the key never sees it
    event.preventDefault()
    event.stopPropagation()
    onDateChange(getTodayYmd(user?.tz))
  }

  const handleDateFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) editedDateRef.current = false
  }

  return (
    <CreateModalSectionFrame step="03" title="Details">
      <div className="grid gap-3 sm:grid-cols-[11rem_8.5rem_minmax(0,1fr)]">
        <div>
          <CreateModalFieldLabelRow
            htmlFor={ids.date}
            label="Date"
            accessory={
              !readOnly && (
                <ShortcutHints>
                  <ShortcutHint field="date" />
                </ShortcutHints>
              )
            }
            error={dateError}
            errorId={ids.errors.date}
          />
          <div onKeyDownCapture={handleDateKeyDown} onFocusCapture={handleDateFocus}>
            <DateField
              id={ids.date}
              ariaLabel="Date"
              keyShortcuts={getAriaFieldShortcut('date')}
              value={date}
              error={!!dateError}
              describedById={ids.errors.date}
              disabled={readOnly}
              onChange={onDateChange}
              onBlur={onDateBlur}
            />
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <label htmlFor={ids.currency} className="app-label block text-[0.9375rem] leading-5">
              Currency
            </label>
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
            id={ids.currency}
            options={currencyOptions}
            value={currencyValue}
            onChange={() => undefined}
            placeholder={currencyPlaceholder}
            searchable
            searchPlaceholder="Search currencies..."
            disabled
            disabledReason="Locked to the selected account's currency"
          />
        </div>
        <div>
          <CreateModalFieldLabelRow
            htmlFor={ids.amount}
            label={
              isAmountLocked ? (
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
              ) : (
                'Amount'
              )
            }
            accessory={
              !readOnly &&
              !isAmountLocked && (
                <ShortcutHints>
                  <ShortcutHint field="amount" />
                </ShortcutHints>
              )
            }
            error={amountError}
            errorId={ids.errors.amount}
          />
          <div className="relative">
            {selectedCurrencySymbol && (
              <span
                className="app-input-prefix pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                style={{
                  fontSize: '0.9375rem',
                  lineHeight: 1,
                }}
                aria-hidden
              >
                {selectedCurrencySymbol}
              </span>
            )}
            <input
              id={ids.amount}
              className={`app-input w-full disabled:cursor-not-allowed disabled:opacity-60 ${selectedCurrencySymbol ? 'pl-8' : ''} ${amountError ? 'app-input-error' : ''}`}
              style={getSymbolInputStyle(selectedCurrencySymbol)}
              aria-keyshortcuts={getAriaFieldShortcut('amount')}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? ids.errors.amount : undefined}
              placeholder={isAmountLocked ? undefined : getMoneyPlaceholder(currencyExponent)}
              disabled={readOnly || isAmountLocked}
              {...amountInput}
            />
          </div>
        </div>
      </div>

      <div>
        <div className="relative mb-1.5 flex w-fit min-w-0 items-center gap-1.5">
          <label htmlFor={ids.notes} className="app-label block shrink-0 text-[0.9375rem] leading-5">
            Notes
          </label>
          {!readOnly && (
            <ShortcutHints>
              <ShortcutHint field="notes" />
            </ShortcutHints>
          )}
        </div>
        <input
          id={ids.notes}
          type="text"
          aria-keyshortcuts={getAriaFieldShortcut('notes')}
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
