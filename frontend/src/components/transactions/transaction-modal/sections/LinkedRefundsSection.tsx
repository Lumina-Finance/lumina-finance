import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import TransactionModalLinkRefundPicker from '@/components/transactions/transaction-modal/modals/LinkRefundPicker'
import RevealRow from '@/components/transactions/transaction-modal/sections/RevealRow'
import { useRefundLinkCandidates, useTransaction, type Transaction } from '@/api/transactions'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import type { PendingLinks } from '@/components/transactions/transaction-modal/hooks/usePendingLinks'
import { getOfferedCandidates, getRefusedRooms } from '@/components/transactions/transaction-modal/utils/refund'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatDateLabel } from '@/utils/date'

// Why the button that opens the picker is held off
const NO_REFUND_FITS = 'No money that came in fits what is left to refund'
const NO_EXPENSE_FITS = 'No expense has room for this refund'

interface LinkedRowFrameProps {
  merchantName: string
  dt: string
  amount: number
  currency: string

  /** Marks a link that Save has yet to make */
  notSaved: boolean
  readOnly: boolean
  disabled: boolean
  onUnlink: () => void
}

function LinkedRowFrame({
  merchantName,
  dt,
  amount,
  currency,
  notSaved,
  readOnly,
  disabled,
  onUnlink,
}: LinkedRowFrameProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
      style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
      data-testid="linked-transaction"
      data-not-saved={notSaved ? 'true' : undefined}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-5" style={{ color: 'var(--app-text)' }}>
          {merchantName}
        </p>
        <p className="flex flex-wrap gap-x-2 text-xs leading-4" style={{ color: 'var(--app-text-muted)' }}>
          <span>{formatDateLabel(dt)}</span>
          {notSaved && <span>Not saved yet</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-financial text-sm" style={{ color: 'var(--app-text)' }}>
          {formatMovedCurrency(amount, currency)}
        </span>
        {!readOnly && (
          <button
            type="button"
            className="app-secondary-button"
            aria-label={`Unlink ${merchantName}`}
            disabled={disabled}
            onClick={onUnlink}
          >
            Unlink
          </button>
        )}
      </div>
    </div>
  )
}

interface SavedRowProps {
  /** The transaction on the other side of a link that is already saved */
  linkedId: string
  readOnly: boolean
  disabled: boolean
  onUnlink: () => void
}

function SavedRow({ linkedId, readOnly, disabled, onUnlink }: SavedRowProps) {
  const query = useTransaction(linkedId)

  // Keeps showing what was loaded while Save has the copy reload, so the row never drops to the shorter placeholder
  const [lastLoaded, setLastLoaded] = useState(query.data)
  if (query.data && query.data !== lastLoaded) setLastLoaded(query.data)
  const linked = { isError: query.isError, data: query.data ?? lastLoaded }
  if (linked.isError && !linked.data) {
    return (
      <p role="alert" className="text-sm" style={{ color: 'var(--app-negative)' }}>
        Oops, something went wrong loading the linked transaction. Please reopen this transaction.
      </p>
    )
  }
  if (!linked.data) {
    return (
      <div
        className="flex items-center rounded-lg px-3 py-2"
        style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
        data-testid="linked-transaction"
      >
        <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Loading…
        </p>
      </div>
    )
  }
  return (
    <LinkedRowFrame
      merchantName={linked.data.merchant_name ?? 'No merchant'}
      dt={linked.data.dt}
      amount={linked.data.amount}
      currency={linked.data.currency}
      notSaved={false}
      readOnly={readOnly}
      disabled={disabled}
      onUnlink={onUnlink}
    />
  )
}

interface LinkedRefundsSectionProps {
  transaction: Transaction
  readOnly: boolean

  /** True while Save is applying the window's changes, which locks the controls that make more */
  disabled: boolean

  /** Money out that can be refunded, so a refund that already exists can be linked to it */
  canLinkRefund: boolean

  /** Money in that is not yet the refund of anything, so it can be linked to the expense it refunds */
  canLinkExpense: boolean

  /** The link changes made in the window, which Save applies */
  pending: PendingLinks

  /** What is left to refund of an expense once the refunds saved and held are counted */
  refundRoom: number | undefined
}

/**
 * Names the other side of a refund link from either transaction, with a way to remove it, and offers
 * to link an existing refund or expense where none is linked. A refund shows the expense it refunds
 * and an expense shows its refunds. Links made, removed or created here are held, and shown as such,
 * until the window is saved. It draws nothing where there is no link and none can be made
 */
export default function TransactionModalLinkedRefundsSection({
  transaction,
  readOnly,
  disabled,
  canLinkRefund,
  canLinkExpense,
  pending,
  refundRoom,
}: LinkedRefundsSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  // The list row the modal opened from is a snapshot, so the links come from the live copy once it loads
  const live = useTransaction(transaction.id)
  const current = live.data ?? transaction
  const isUnlinked = (id: string) => pending.unlinkedRefundIds.includes(id) || pending.appliedUnlinkIds.includes(id)
  const isRefund = current.amount > 0

  // A link or refund that Save has made keeps the row it had, from what the window already knew of it, until the
  // window closes. The saved copy loads after Save, and swapping to it would take the row away and bring it back
  const appliedOriginal = isRefund && !isUnlinked(current.id) ? pending.appliedLinks[0] : undefined
  const appliedRefundLinks = isRefund ? [] : pending.appliedLinks.filter((link) => !isUnlinked(link.id))
  const appliedIds = [...appliedRefundLinks.map((link) => link.id), ...pending.appliedRefunds.map((r) => r.id)]
  const savedOriginalId = isUnlinked(current.id) || appliedOriginal ? null : current.refund_of_transaction_id

  // Links picked for a refund name its one expense, and links picked for an expense name its refunds
  const pendingOriginal = isRefund ? pending.links[0] : undefined
  const pendingRefundLinks = isRefund ? [] : pending.links
  const savedRefundIds = current.refund_transaction_ids.filter((id) => !isUnlinked(id) && !appliedIds.includes(id))
  const appliedRefunds = pending.appliedRefunds.filter((refund) => !isUnlinked(refund.id))

  // The button that opens the picker is held off while nothing in the unfiltered list could be picked. The query is
  // the picker's own with nothing searched or filtered, so the two share one request
  const candidates = useRefundLinkCandidates(
    canLinkRefund || canLinkExpense ? current.id : null,
    '',
    pending.unlinkedRefundIds.length > 0 ? { unlinked_id: pending.unlinkedRefundIds } : {},
  )
  const unheld =
    candidates.data &&
    getOfferedCandidates(
      current,
      candidates.data.filter((candidate) => !pending.links.some((link) => link.id === candidate.id)),
    )
  const anythingFits = unheld === undefined || unheld.length > getRefusedRooms(current, unheld, refundRoom, []).size
  const refundCount =
    savedRefundIds.length +
    appliedRefundLinks.length +
    appliedRefunds.length +
    pendingRefundLinks.length +
    pending.refunds.length
  const showRefunds = refundCount > 0 || canLinkRefund
  const showRefundOf =
    Boolean(savedOriginalId) || appliedOriginal !== undefined || pendingOriginal !== undefined || canLinkExpense
  if (!showRefunds && !showRefundOf) return null

  const linkButton = (label: string) => (
    <DisabledReasonButton
      className="app-secondary-button whitespace-nowrap"
      data-testid="link-existing"
      disabled={disabled}
      disabledReason={anythingFits ? undefined : isRefund ? NO_EXPENSE_FITS : NO_REFUND_FITS}
      onClick={() => setPickerOpen(true)}
    >
      {label}
    </DisabledReasonButton>
  )
  const prompt = (text: string, label: string) => (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {text}
      </p>
      {linkButton(label)}
    </div>
  )

  return (
    <>
      {showRefundOf && (
        <CreateModalSectionFrame step="04" title="Refund of">
          <div className="-mb-2">
            <AnimatePresence initial={false}>
              {savedOriginalId ? (
                <RevealRow key={savedOriginalId} testId="linked-row">
                  <SavedRow
                    linkedId={savedOriginalId}
                    readOnly={readOnly}
                    disabled={disabled}
                    onUnlink={() => pending.unlink(current.id)}
                  />
                </RevealRow>
              ) : appliedOriginal ? (
                <RevealRow key={appliedOriginal.id} testId="linked-row">
                  <LinkedRowFrame
                    merchantName={appliedOriginal.merchant_name ?? 'No merchant'}
                    dt={appliedOriginal.dt}
                    amount={appliedOriginal.amount}
                    currency={appliedOriginal.currency}
                    notSaved={false}
                    readOnly={readOnly}
                    disabled={disabled}
                    onUnlink={() => pending.unlink(current.id)}
                  />
                </RevealRow>
              ) : pendingOriginal ? (
                <RevealRow key={pendingOriginal.id} testId="linked-row">
                  <LinkedRowFrame
                    merchantName={pendingOriginal.merchant_name ?? 'No merchant'}
                    dt={pendingOriginal.dt}
                    amount={pendingOriginal.amount}
                    currency={pendingOriginal.currency}
                    notSaved
                    readOnly={readOnly}
                    disabled={disabled}
                    onUnlink={() => pending.removeLink(pendingOriginal.id)}
                  />
                </RevealRow>
              ) : (
                <RevealRow key="prompt">
                  {prompt('If this gives money back for an expense, link them.', 'Link to an expense')}
                </RevealRow>
              )}
            </AnimatePresence>
          </div>
        </CreateModalSectionFrame>
      )}
      {showRefunds && (
        <CreateModalSectionFrame step={showRefundOf ? '05' : '04'} title="Refunds">
          <div className="-mb-2">
            <AnimatePresence initial={false}>
              {savedRefundIds.map((refundId) => (
                <RevealRow key={refundId} testId="linked-row">
                  <SavedRow
                    linkedId={refundId}
                    readOnly={readOnly}
                    disabled={disabled}
                    onUnlink={() => pending.unlink(refundId)}
                  />
                </RevealRow>
              ))}
              {appliedRefundLinks.map((refund) => (
                <RevealRow key={refund.id} testId="linked-row">
                  <LinkedRowFrame
                    merchantName={refund.merchant_name ?? 'No merchant'}
                    dt={refund.dt}
                    amount={refund.amount}
                    currency={refund.currency}
                    notSaved={false}
                    readOnly={readOnly}
                    disabled={disabled}
                    onUnlink={() => pending.unlink(refund.id)}
                  />
                </RevealRow>
              ))}
              {appliedRefunds.map((refund) => (
                <RevealRow key={refund.key} testId="linked-row">
                  <LinkedRowFrame
                    merchantName={refund.preview.merchant_name ?? 'No merchant'}
                    dt={refund.preview.dt}
                    amount={refund.preview.amount}
                    currency={refund.preview.currency}
                    notSaved={false}
                    readOnly={readOnly}
                    disabled={disabled}
                    onUnlink={() => pending.unlink(refund.id)}
                  />
                </RevealRow>
              ))}
              {pendingRefundLinks.map((refund) => (
                <RevealRow key={refund.id} testId="linked-row">
                  <LinkedRowFrame
                    merchantName={refund.merchant_name ?? 'No merchant'}
                    dt={refund.dt}
                    amount={refund.amount}
                    currency={refund.currency}
                    notSaved
                    readOnly={readOnly}
                    disabled={disabled}
                    onUnlink={() => pending.removeLink(refund.id)}
                  />
                </RevealRow>
              ))}
              {pending.refunds.map((refund) => (
                <RevealRow key={refund.key} testId="linked-row">
                  <LinkedRowFrame
                    merchantName={refund.preview.merchant_name ?? 'No merchant'}
                    dt={refund.preview.dt}
                    amount={refund.preview.amount}
                    currency={refund.preview.currency}
                    notSaved
                    readOnly={readOnly}
                    disabled={disabled}
                    onUnlink={() => pending.removeRefund(refund.key)}
                  />
                </RevealRow>
              ))}
              {canLinkRefund && (
                <RevealRow key="prompt">
                  {prompt('Link a refund that is already recorded.', 'Link an existing refund')}
                </RevealRow>
              )}
            </AnimatePresence>
          </div>
        </CreateModalSectionFrame>
      )}
      <TransactionModalLinkRefundPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        transaction={current}
        heldIds={pending.links.map((link) => link.id)}
        unlinkedIds={pending.unlinkedRefundIds}
        refundRoom={refundRoom}
        onPick={(picked) => picked.forEach(pending.addLink)}
      />
    </>
  )
}
