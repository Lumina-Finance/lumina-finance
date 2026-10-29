import { ApiError } from '@/api/auth'
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
        Could not load the linked transaction.
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
          {unlink.error instanceof ApiError ? unlink.error.message : 'Could not unlink the transaction.'}
        </p>
      )}
    </div>
  )
}

interface LinkedRefundsSectionProps {
  transaction: Transaction
  readOnly: boolean
}

/**
 * Names the other side of a refund link from either transaction, with a way to remove it. A refund
 * shows the expense it refunds and an expense shows its refunds. It draws nothing when there is no link
 */
export default function TransactionModalLinkedRefundsSection({ transaction, readOnly }: LinkedRefundsSectionProps) {
  // The list row the modal opened from is a snapshot, so the links come from the live copy once it loads
  const live = useTransaction(transaction.id)
  const current = live.data ?? transaction
  const refundOfId = current.refund_of_transaction_id
  const refundIds = current.refund_transaction_ids
  if (!refundOfId && refundIds.length === 0) return null

  // A refund edited into an outflow can be refunded itself, so one transaction can hold both sides
  return (
    <>
      {refundOfId && (
        <CreateModalSectionFrame step="04" title="Refund of">
          <LinkedTransactionRow linkedId={refundOfId} refundId={current.id} readOnly={readOnly} />
        </CreateModalSectionFrame>
      )}
      {refundIds.length > 0 && (
        <CreateModalSectionFrame step={refundOfId ? '05' : '04'} title="Refunds">
          <div className="space-y-2">
            {refundIds.map((refundId) => (
              <LinkedTransactionRow key={refundId} linkedId={refundId} refundId={refundId} readOnly={readOnly} />
            ))}
          </div>
        </CreateModalSectionFrame>
      )}
    </>
  )
}
