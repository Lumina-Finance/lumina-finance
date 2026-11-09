import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { getSaveFailureMessage } from '@/utils/createFailure'
import { useRecordBalanceMatch, type BalanceMatch } from '@/api/bank-sync'
import { CurrencyUnavailableTooltip } from '@/components/currency/CurrencyUnavailableTooltip'
import ActionFeedbackButton from '@/components/feedback/ActionButton'
import { useCurrencyListState } from '@/hooks/useCurrencyListState'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { useToast } from '@/hooks/useToast'
import {
  describeSign,
  getRecordingProblem,
  holdsSign,
  readRecording,
  readTypedAmount,
  RECORDING_FAILED_MESSAGE,
  SIGNED_AMOUNT_MESSAGE,
  type TypedAmount,
} from '@/pages/accounts/detail/components/bank-link/balanceMatch'
import { useMoveFocusOnFold } from '@/pages/accounts/detail/components/bank-link/useMoveFocusOnFold'
import { AccountIdentityFieldLabelRow } from '@/pages/accounts/detail/components/edit-identity/controls/FieldLabelRow'
import { formatDateLabel } from '@/utils/date'
import { formatCurrencySymbol, getSymbolInputStyle } from '@/utils/formatCurrency'
import { getAmountSign, signMovedAmount } from '@/utils/negativeAmount'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent, fromMinorUnits } from '@/utils/moneyInput'

const AMOUNT_FIELDS = ['amount'] as const
const RECORD_LABEL = 'Record adjustment'
// The sign and symbol are drawn 1rem in from the field's edge in 1rem text
const PREFIX_PLACEMENT = { insetRem: 1, fontRem: 1 }
// Outlined like Sync now and Unlink below it, since the modal's footer holds its one filled primary,
// Save changes. At the field's 40px height, so the two line up
const BUTTON_CLASS = 'relative w-full shrink-0 whitespace-nowrap sm:w-(--fit-width)'

type BalanceMatchOfferProps = {
  accountId: string
  offer: BalanceMatch

  /** The account's currency, shared by a live link's bank account */
  currency: string
  providerName: string

  /** Moves focus on once the offer starts to fold away with focus still in it */
  onFolded: () => void
}

/**
 * The offer to record the gap between the bank's balance and the ledger's as a balance adjustment
 * dated the day before the import start. It sits at the foot of the balance panel under the balances
 * and their difference whenever there is a gap to close, with the offered amount to keep or type over.
 * It says which way the offered amount moves the ledger's balance, and while items waiting for review
 * would move it, by how much, since the offer leaves them out and so differs from the difference shown
 * above it
 *
 * Recording shows the difference left. The offer folds away when none is, and otherwise stays with
 * the amount left, replacing whatever was typed, as it does whenever a read of the link brings
 * another amount. Focus stays on Record adjustment while the offer stays, and moves on once it folds
 *
 * Record adjustment refuses a blank or zero amount with a message beside the field, and then fades,
 * staying focusable and giving the same message as its reason until the amount is fixed. The field
 * says why it refuses a typed or pasted sign, and Record adjustment refuses the same way while that
 * message shows. Either refusal moves focus to the field. A press while recording runs does nothing.
 * A refused recording says why in a toast, and the account's bank link is read again, so an offer that
 * moved meanwhile shows its new amount. Enter in the field records nothing, since the offer sits inside
 * the account's edit form and Enter would otherwise press its Save. While the currency list lacks the
 * account's currency, the amount and Record adjustment lock, with the reason beside the label, as
 * other stored amounts do
 */
export function BalanceMatchOffer({ accountId, offer, currency, providerName, onFolded }: BalanceMatchOfferProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const amountId = useId()
  const signId = useId()
  const errorId = useId()
  const { currencies, formatCurrency } = useMoneyFormatters()
  const { showToast } = useToast()
  const record = useRecordBalanceMatch()
  const { buttonRef: recordRef, style: recordStyle, measure: recordMeasure } = useFittedButtonWidth(RECORD_LABEL)
  const currencyState = useCurrencyListState()
  // Written the way the rest of the app writes it, in the reader's own language
  const symbol = currencies.some((entry) => entry.id === currency) ? formatCurrencySymbol(currency) : ''

  // Without the currency's decimal places the offered amount can be neither shown nor read back, so
  // the amount and Record adjustment lock until the currency list has them
  const knownExponent = findCurrencyExponent(currencies, currency)
  const locked = knownExponent === null
  const exponent = knownExponent ?? DEFAULT_MINOR_UNIT_EXPONENT

  const [typed, setTyped] = useState<TypedAmount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const typedValue = readTypedAmount(typed, offer.amount)

  const amountInput = useMoneyInput({
    value: typedValue ?? (locked ? '' : fromMinorUnits(Math.abs(offer.amount), exponent)),
    exponent,
    onChange: (value, text) => {
      setTyped({ offered: offer.amount, value })

      // The field refuses text holding a sign and keeps its value, so the refused text is read to say
      // why. Settling on blur reports no text, so the message is left as it was
      if (text !== undefined) {
        setError(holdsSign(text) ? SIGNED_AMOUNT_MESSAGE : null)
      }
    },
  })

  // A press that finds nothing to record fades Record adjustment with the reason and marks the amount,
  // and both stay until the amount is fixed, whatever is typed meanwhile
  const refusal = useRefusedSubmit(
    { amount: getRecordingProblem(error, amountInput.value, exponent, offer.amount) },
    AMOUNT_FIELDS,
    { amount: amountId },
  )
  const shownError = error ?? refusal.errors.amount
  const prefix = signMovedAmount(getAmountSign(offer.amount), symbol)

  // How approving the items waiting for review would move the ledger's balance, as a direction in words
  // and an unsigned amount. The offer leaves that movement out
  const waitingDirection = offer.waiting_amount < 0 ? 'lower' : 'raise'
  const waitingSize = formatCurrency(Math.abs(offer.waiting_amount), currency)
  useMoveFocusOnFold(rootRef, onFolded)

  // The recording is awaited here rather than through the mutation's own callbacks. Those are dropped
  // once the offer has gone, so a refusal still says why after a read of the link has left it out
  const recordOffer = () => {
    if (!refusal.guard()) return
    const reading = readRecording(error, amountInput.value, exponent, offer.amount)
    if ('refusal' in reading) return
    setError(null)
    void record
      .mutateAsync({ accountId, amount: reading.amount, offeredAmount: offer.amount })
      .catch((cause) => showToast({ status: 'error', text: getSaveFailureMessage(cause, RECORDING_FAILED_MESSAGE) }))
  }

  // Deleting in a field the refused text left blank changes no text, so no change arrives to clear
  // the message, yet it is still the person taking the sign back
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.preventDefault()
    if ((event.key === 'Backspace' || event.key === 'Delete') && error === SIGNED_AMOUNT_MESSAGE) {
      setError(null)
    }
  }

  return (
    <div ref={rootRef} className="space-y-3">
      {/* Titled as the Archive section's card is, so it reads as a heading over the field's label */}
      <div className="space-y-1">
        <p className="font-medium" style={{ color: 'var(--app-text)' }}>
          Match {providerName}&apos;s balance
        </p>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Record the difference as a balance adjustment on {formatDateLabel(offer.adjustment_date)}, so your ledger
          matches {providerName}&apos;s balance.{' '}
          {offer.amount < 0 ? "This lowers your ledger's balance." : "This raises your ledger's balance."}
          {offer.waiting_amount !== 0 &&
            ` Approving the items waiting for review would ${waitingDirection} your ledger's balance by ${waitingSize}, so this leaves them out. Review them first if you entered any of them by hand.`}
        </p>
      </div>
      {/* The label row spans the button too, so the message beside the label keeps to one line
          wherever the amount and the button share a row */}
      <div>
        <AccountIdentityFieldLabelRow
          label={
            <span className="inline-flex items-center gap-2">
              Adjustment amount
              <CurrencyUnavailableTooltip
                unavailable={locked}
                currencyState={currencyState}
                label="Adjustment amount unavailable"
              />
            </span>
          }
          htmlFor={amountId}
          error={shownError}
          errorId={errorId}
          sequential
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 sm:flex-1">
            {prefix && (
              <span
                className="app-input-prefix pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base"
                aria-hidden
              >
                {prefix}
              </span>
            )}
            <input
              id={amountId}
              className={`app-input disabled:cursor-not-allowed disabled:opacity-60 ${prefix ? 'pl-8' : ''} ${shownError ? 'app-input-error' : ''}`}
              // Clear of the sign and symbol, however many characters they take
              style={getSymbolInputStyle(prefix, PREFIX_PLACEMENT)}
              aria-describedby={shownError ? `${errorId} ${signId}` : signId}
              aria-invalid={shownError ? true : undefined}
              disabled={locked}
              readOnly={record.isPending}
              {...amountInput}
              onKeyDown={handleKeyDown}
            />
            {/* The sign beside the field is drawn, so the field's description says it in words */}
            <span id={signId} className="sr-only">
              {describeSign(offer.amount)}
            </span>
          </div>
          <ActionFeedbackButton
            ref={recordRef}
            type="button"
            status={record.isPending ? 'loading' : 'idle'}
            loadingLabel="Recording adjustment"
            className={`app-secondary-button ${BUTTON_CLASS}`}
            style={recordStyle}
            measure={recordMeasure}
            disabledReason={refusal.blockedReason ?? null}
            aria-disabled={locked || undefined}
            onClick={record.isPending || locked ? undefined : recordOffer}
          >
            {RECORD_LABEL}
          </ActionFeedbackButton>
        </div>
      </div>
    </div>
  )
}
