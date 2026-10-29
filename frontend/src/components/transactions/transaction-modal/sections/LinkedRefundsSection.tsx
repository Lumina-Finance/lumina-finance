import { useState } from 'react'
import { ApiError } from '@/api/auth'
import TransactionModalLinkRefundPicker from '@/components/transactions/transaction-modal/modals/LinkRefundPicker'
import { useTransaction, useUnlinkRefund, type Transaction } from '@/api/transactions'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatDateLabel } from '@/utils/date'

interface LinkedTransactionRowProps {
  /** The transaction on the other side of the link */
  linkedId: string

  /** The refund of the pair, which is the one the server unlinks by */
  refundId: string
  readOnly: boolean
}

function LinkedTransactionRow({ linkedId, refundId, readOnly }: LinkedTransactionRowProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  const linked = useTransaction(linkedId)
  const unlink = useUnlinkRefund()
  const merchantName = linked.data?.merchant_name ?? 'No merchant'

  if (linked.isError) {
    return (
      <p role="alert" className="text-sm" style={{ color: 'var(--app-negative)' }}>
        Oops, something went wrong loading the linked transaction. Please reopen this transaction.
      </p>
    )
  }

  return (
    <div>
      <div
        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
        style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
        data-testid="linked-transaction"
      >
        {linked.data ? (
          <>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-5" style={{ color: 'var(--app-text)' }}>
                {merchantName}
              </p>
              <p className="text-xs leading-4" style={{ color: 'var(--app-text-muted)' }}>
                {formatDateLabel(linked.data.dt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="font-financial text-sm" style={{ color: 'var(--app-text)' }}>
                {formatMovedCurrency(linked.data.amount, linked.data.currency)}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  className="app-secondary-button"
                  aria-label={`Unlink ${merchantName}`}
                  aria-busy={unlink.isPending}
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(refundId)}
                >
                  Unlink
                </button>
              )}
            </div>
          </>
        ) : (
          <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Loading…
          </p>
        )}
      </div>
      {unlink.isError && (
        <p role="alert" className="mt-1 text-sm" style={{ color: 'var(--app-negative)' }}>
          {unlink.error instanceof ApiError ? unlink.error.message : 'Oops, something went wrong. Please try again.'}
        </p>
      )}
    </div>
  )
}

interface LinkedRefundsSectionProps {
  transaction: Transaction
  readOnly: boolean

  /** Money out that can be refunded, so a refund that already exists can be linked to it */
  canLinkRefund: boolean

  /** Money in that is not yet the refund of anything, so it can be linked to the expense it refunds */
  canLinkExpense: boolean
}

/**
 * Names the other side of a refund link from either transaction, with a way to remove it, and offers
 * to link an existing refund or expense where none is linked. A refund shows the expense it refunds
 * and an expense shows its refunds. It draws nothing where there is no link and none can be made
 */
export default function TransactionModalLinkedRefundsSection({
  transaction,
  readOnly,
  canLinkRefund,
  canLinkExpense,
}: LinkedRefundsSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  // The list row the modal opened from is a snapshot, so the links come from the live copy once it loads
  const live = useTransaction(transaction.id)
  const current = live.data ?? transaction
  const refundOfId = current.refund_of_transaction_id
  const refundIds = current.refund_transaction_ids
  const showRefunds = refundIds.length > 0 || canLinkRefund
  const showRefundOf = Boolean(refundOfId) || canLinkExpense
  if (!showRefunds && !showRefundOf) return null

  const linkButton = (label: string) => (
    <button type="button" className="app-secondary-button whitespace-nowrap" data-testid="link-existing" onClick={() => setPickerOpen(true)}>
      {label}
    </button>
  )

  return (
    <>
      {showRefundOf && (
        <CreateModalSectionFrame step="04" title="Refund of">
          {refundOfId ? (
            <LinkedTransactionRow linkedId={refundOfId} refundId={current.id} readOnly={readOnly} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                If this gives money back for an expense, link them.
              </p>
              {linkButton('Link to an expense')}
            </div>
          )}
        </CreateModalSectionFrame>
      )}
      {showRefunds && (
        <CreateModalSectionFrame step={showRefundOf ? '05' : '04'} title="Refunds">
          <div className="space-y-2">
            {refundIds.map((refundId) => (
              <LinkedTransactionRow key={refundId} linkedId={refundId} refundId={refundId} readOnly={readOnly} />
            ))}
            {canLinkRefund && (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {refundIds.length === 0 ? 'No refund is linked yet.' : 'Another refund can be linked.'}
                </p>
                {linkButton('Link an existing refund')}
              </div>
            )}
          </div>
        </CreateModalSectionFrame>
      )}
      <TransactionModalLinkRefundPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        transaction={current}
      />
    </>
  )
}
