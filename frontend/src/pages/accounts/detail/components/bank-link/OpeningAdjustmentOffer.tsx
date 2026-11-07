import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { ApiError } from '@/api/auth'
import { useRecordOpeningAdjustment, useSkipOpeningAdjustment, type OpeningAdjustment } from '@/api/bank-sync'
import { CurrencyUnavailableTooltip } from '@/components/currency/CurrencyUnavailableTooltip'
import ActionFeedbackButton from '@/components/feedback/ActionButton'
import { useCurrencyListState } from '@/hooks/useCurrencyListState'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { useToast } from '@/hooks/useToast'
import {
  ANSWER_FAILED_MESSAGE,
  describeSign,
  holdsSign,
  readRecordedAmount,
  SIGNED_AMOUNT_MESSAGE,
  ZERO_AMOUNT_MESSAGE,
} from '@/pages/accounts/detail/components/bank-link/openingAdjustment'
import { useMoveFocusOnFold } from '@/pages/accounts/detail/components/bank-link/useMoveFocusOnFold'
import { AccountIdentityFieldLabelRow } from '@/pages/accounts/detail/components/edit-identity/controls/FieldLabelRow'
import { formatDateLabel } from '@/utils/date'
import { getAmountSign, signMovedAmount } from '@/utils/negativeAmount'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent, fromMinorUnits } from '@/utils/moneyInput'

const SKIP_LABEL = 'Skip'
const RECORD_LABEL = 'Record adjustment'
const BUTTON_CLASS = 'relative w-full shrink-0 whitespace-nowrap sm:w-(--fit-width)'

type OpeningAdjustmentOfferProps = {
  accountId: string
  offer: OpeningAdjustment

  /** The account's currency, shared by a live link's bank account */
  currency: string
  providerName: string

  /**
   * Moves focus on once an answer goes through, or a read of the link leaves the offer out first, since
   * the offer folds away with the button holding it
   */
  onAnswered: () => void
}

/**
 * The one-time offer, once the initial import is reviewed, to record the gap between the bank's
 * balance and the ledger's as an opening adjustment dated the day before the import start. It sits at
 * the foot of the balance panel under the balances and their difference, with the offered amount to
 * keep or type over, and folds away once answered, leaving the balances. It says which way the offered
 * amount moves the ledger's balance, and while items waiting for review would move it, by how much,
 * since the offer leaves them out and so differs from the difference shown above it
 *
 * Record adjustment refuses a blank or zero amount with a message beside the field, and the field
 * says why it refuses a typed or pasted sign, recording the amount it keeps if pressed. A press while
 * either answer runs does nothing, and the buttons keep the focus they hold, as Sync now does, until
 * an answer goes through, or a read of the link leaves the offer out first, and focus inside the offer
 * moves on. A refused answer says why in a toast, and the account's bank link is read again. That
 * folds the offer away if it was answered elsewhere. Enter in the field records nothing, since the
 * offer sits inside the account's edit form and Enter would otherwise press its Save. While the
 * currency list lacks the account's currency, the amount and Record adjustment lock, with the reason
 * beside the label, as other stored amounts do
 */
export function OpeningAdjustmentOffer({
  accountId,
  offer,
  currency,
  providerName,
  onAnswered,
}: OpeningAdjustmentOfferProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const amountId = useId()
  const signId = useId()
  const { currencies, formatCurrency } = useMoneyFormatters()
  const { showToast } = useToast()
  const record = useRecordOpeningAdjustment()
  const skip = useSkipOpeningAdjustment()
  const { buttonRef: skipRef, style: skipStyle, measure: skipMeasure } = useFittedButtonWidth(SKIP_LABEL)
  const { buttonRef: recordRef, style: recordStyle, measure: recordMeasure } = useFittedButtonWidth(RECORD_LABEL)
  const currencyState = useCurrencyListState()
  const symbol = currencies.find((entry) => entry.id === currency)?.symbol ?? ''

  // Without the currency's decimal places the offered amount can be neither shown nor read back, so
  // the amount and Record adjustment lock until the currency list has them. Skip records nothing
  const knownExponent = findCurrencyExponent(currencies, currency)
  const locked = knownExponent === null
  const exponent = knownExponent ?? DEFAULT_MINOR_UNIT_EXPONENT

  // The offered amount until the field is typed in, so an offer read again with another amount shows it
  const [typed, setTyped] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const amountInput = useMoneyInput({
    value: typed ?? (locked ? '' : fromMinorUnits(Math.abs(offer.amount), exponent)),
    exponent,
    onChange: (value, text) => {
      setTyped(value)

      // The field refuses text holding a sign and keeps its value, so the refused text is read to say
      // why. Settling on blur reports no text, so the message is left as it was
      if (text !== undefined) setError(holdsSign(text) ? SIGNED_AMOUNT_MESSAGE : null)
    },
  })
  const busy = record.isPending || skip.isPending
  const prefix = signMovedAmount(getAmountSign(offer.amount), symbol)

  // How approving the items waiting for review would move the ledger's balance, as a direction in words
  // and an unsigned amount. The offer leaves that movement out
  const waitingDirection = offer.waiting_amount < 0 ? 'lower' : 'raise'
  const waitingSize = formatCurrency(Math.abs(offer.waiting_amount), currency)
  useMoveFocusOnFold(rootRef, onAnswered)

  const reportError = (cause: unknown) =>
    showToast({ status: 'error', text: cause instanceof ApiError ? cause.message : ANSWER_FAILED_MESSAGE })

  // The answer is awaited here rather than through the mutation's own callbacks. Those are dropped once
  // the offer has gone, so a refusal still says why after a read of the link has left it out. Focus
  // elsewhere stays where the person put it while the answer ran
  const answer = (send: () => Promise<unknown>) => {
    void send().then(() => {
      if (rootRef.current?.contains(document.activeElement)) onAnswered()
    }, reportError)
  }

  const recordOffer = () => {
    const amount = readRecordedAmount(amountInput.value, exponent, offer.amount)
    if (amount === null) {
      setError(ZERO_AMOUNT_MESSAGE)
      return
    }
    setError(null)
    answer(() => record.mutateAsync({ accountId, amount }))
  }

  const skipOffer = () => {
    setError(null)
    answer(() => skip.mutateAsync(accountId))
  }

  // Deleting in a field the refused text left blank changes no text, so no change arrives to clear
  // the message, yet it is still the person taking the sign back
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.preventDefault()
    if ((event.key === 'Backspace' || event.key === 'Delete') && error === SIGNED_AMOUNT_MESSAGE) setError(null)
  }

  return (
    <div ref={rootRef} className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        Record an opening adjustment on {formatDateLabel(offer.adjustment_date)}, to bring your ledger&apos;s balance in
        line with {providerName}&apos;s.{' '}
        {offer.amount < 0 ? "This lowers your ledger's balance." : "This raises your ledger's balance."}
        {offer.waiting_amount !== 0 &&
          ` Approving the items waiting for review would ${waitingDirection} your ledger's balance by ${waitingSize}, so this leaves them out. Review them first if you entered any of them by hand.`}
      </p>
      {/* The label row spans the answers too, so the message beside the label keeps to one line
          wherever the amount and the answers share a row */}
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
          error={error ?? undefined}
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
              className={`app-input disabled:cursor-not-allowed disabled:opacity-60 ${error ? 'app-input-error' : ''}`}
              // Clear of the sign and symbol, however many characters they take
              style={prefix ? { paddingLeft: `calc(1.5rem + ${prefix.length}ch)` } : undefined}
              aria-describedby={signId}
              aria-invalid={error ? true : undefined}
              disabled={locked}
              readOnly={busy}
              {...amountInput}
              onKeyDown={handleKeyDown}
            />
            {/* The sign beside the field is drawn, so the field's description says it in words */}
            <span id={signId} className="sr-only">
              {describeSign(offer.amount)}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ActionFeedbackButton
              ref={skipRef}
              type="button"
              status={skip.isPending ? 'loading' : 'idle'}
              loadingLabel="Skipping"
              className={`app-secondary-button ${BUTTON_CLASS}`}
              style={skipStyle}
              measure={skipMeasure}
              aria-disabled={record.isPending || undefined}
              onClick={busy ? undefined : skipOffer}
            >
              {SKIP_LABEL}
            </ActionFeedbackButton>
            <ActionFeedbackButton
              ref={recordRef}
              type="button"
              status={record.isPending ? 'loading' : 'idle'}
              loadingLabel="Recording adjustment"
              className={`app-primary-button ${BUTTON_CLASS}`}
              style={recordStyle}
              measure={recordMeasure}
              aria-disabled={skip.isPending || locked || undefined}
              onClick={busy || locked ? undefined : recordOffer}
            >
              {RECORD_LABEL}
            </ActionFeedbackButton>
          </div>
        </div>
      </div>
    </div>
  )
}
