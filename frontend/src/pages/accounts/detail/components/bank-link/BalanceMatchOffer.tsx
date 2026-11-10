import { useRef } from 'react'
import { getSaveFailureMessage } from '@/utils/createFailure'
import { useRecordBalanceMatch, type BalanceMatch } from '@/api/bank-sync'
import ActionFeedbackButton from '@/components/feedback/ActionButton'
import { LabelWithHint } from '@/components/tooltips/LabelWithHint'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useToast } from '@/hooks/useToast'
import { RECORDING_FAILED_MESSAGE } from '@/pages/accounts/detail/components/bank-link/balanceMatch'
import { useMoveFocusOnFold } from '@/pages/accounts/detail/components/bank-link/useMoveFocusOnFold'
import { formatDateLabel } from '@/utils/date'

const RECORD_LABEL = 'Record adjustment'
// Outlined like Sync now and Unlink below it, since the modal's footer holds its one filled primary,
// Save changes
const BUTTON_CLASS = 'relative w-full shrink-0 whitespace-nowrap sm:w-(--fit-width)'

type BalanceMatchOfferProps = {
  accountId: string
  offer: BalanceMatch

  /** The account's currency, shared by a live link's bank account */
  currency: string
  providerName: string

  /** Moves focus on once the offer starts to fold away with focus still in it */
  onFolded: () => void

  /** Runs once the adjustment is recorded, such as to close the modal holding the offer */
  onRecorded?: () => void
}

/**
 * The offer to record the gap between the bank's balance and the ledger's as a balance adjustment
 * dated the day before the import start. It sits at the foot of the balance panel under the balances
 * and their difference whenever there is a gap to close. The amount is worked out by the server and
 * shown as a figure with its sign, labelled like the balances above it, since it can't be changed, and
 * its label's info icon says how it is worked out, as the difference's says why the balances differ. Its
 * one sentence gives the adjustment's date. While items wait for review it asks for them to be reviewed
 * first if any were entered by hand, since the offer leaves them out
 *
 * Recording records the amount shown, and the account's modal then closes. Where the offer stays open,
 * it folds away once the ledger matches, and otherwise shows the amount still offered, with focus
 * moving on as it folds. A press while recording runs does nothing. A refused recording says why in a toast,
 * and the account's bank link is read again, so an offer that moved meanwhile shows its new amount
 */
export function BalanceMatchOffer({
  accountId,
  offer,
  currency,
  providerName,
  onFolded,
  onRecorded,
}: BalanceMatchOfferProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { formatMovedCurrency } = useMoneyFormatters()
  const { showToast } = useToast()
  const record = useRecordBalanceMatch()
  const { buttonRef: recordRef, style: recordStyle, measure: recordMeasure } = useFittedButtonWidth(RECORD_LABEL)
  useMoveFocusOnFold(rootRef, onFolded)

  // The recording is awaited here rather than through the mutation's own callbacks. Those are dropped
  // once the offer has gone, so a refusal still says why after a read of the link has left it out
  const recordOffer = () => {
    void record
      .mutateAsync({ accountId, offeredAmount: offer.amount })
      .then(() => onRecorded?.())
      .catch((cause) => showToast({ status: 'error', text: getSaveFailureMessage(cause, RECORDING_FAILED_MESSAGE) }))
  }

  return (
    <div ref={rootRef} className="space-y-3">
      {/* Titled as the Archive section's card is, so it reads as a heading over the amount */}
      <div className="space-y-1">
        <p className="font-medium" style={{ color: 'var(--app-text)' }}>
          Match {providerName}&apos;s balance
        </p>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Adds a balance adjustment on {formatDateLabel(offer.adjustment_date)}.
          {offer.waiting_amount !== 0 && ' Review the waiting items first if you entered any by hand.'}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {/* Labelled as the balances above it are, as a statement line on phones */}
        <dl>
          <div className="flex items-center justify-between gap-x-3 sm:block">
            <dt
              className="flex items-center gap-1 text-xs font-medium uppercase"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              <LabelWithHint
                label="Adjustment"
                hint={`${providerName}'s balance minus your ledger's on the day ${providerName} read it, leaving out the items waiting for review, since ${providerName}'s balance already holds them.`}
                hintLabel="How the adjustment is worked out"
                hintPlacement="top"
              />
            </dt>
            <dd
              className="whitespace-nowrap font-financial text-lg font-semibold tabular-nums sm:mt-0.5"
              style={{ color: 'var(--app-text)' }}
            >
              {formatMovedCurrency(offer.amount, currency)}
            </dd>
          </div>
        </dl>
        <ActionFeedbackButton
          ref={recordRef}
          type="button"
          status={record.isPending ? 'loading' : 'idle'}
          loadingLabel="Recording adjustment"
          className={`app-secondary-button ${BUTTON_CLASS}`}
          style={recordStyle}
          measure={recordMeasure}
          onClick={record.isPending ? undefined : recordOffer}
        >
          {RECORD_LABEL}
        </ActionFeedbackButton>
      </div>
    </div>
  )
}
