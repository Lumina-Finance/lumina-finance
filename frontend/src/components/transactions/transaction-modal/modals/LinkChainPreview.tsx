import type { ReactNode } from 'react'
import type { Transaction } from '@/api/transactions'
import {
  NO_MERCHANT,
  RefundChainBox,
  RefundChainFooter,
  RefundChainGap,
  RefundChainLead,
  RefundChainNote,
  RefundChainRow,
} from '@/components/transactions/transaction-modal/sections/RefundChain'
import { describeLinkedRefunds, getRefundStatus } from '@/components/transactions/transaction-modal/utils/refund'

interface LinkChainPreviewProps {
  /** The open transaction. On an expense the picks are its refunds, and on a refund the pick is its expense */
  transaction: Transaction

  /** The rows picked so far, in the order they were picked */
  picked: Transaction[]

  /** On an expense, the refunds the window already has, saved and held. Ignored on a refund */
  linkedCount: number

  /** On an expense, what is left to refund before the picks, undefined while it loads. Ignored on a refund */
  refundRoom: number | undefined

  /** The round icon an expense and its refunds share, from the expense's category */
  iconOf: (expense: Transaction) => ReactNode
  kindOf: (expense: Transaction) => string
}

/**
 * The chain linking would make, pinned above the picker's buttons in the look of the Refunds section: the expense, a
 * line for the refunds it already has, each picked refund marked New, and what is left to refund with its badge. A
 * refund with no expense picked yet shows itself under a prompt to pick one
 */
export default function LinkChainPreview({
  transaction,
  picked,
  linkedCount,
  refundRoom,
  iconOf,
  kindOf,
}: LinkChainPreviewProps) {
  const picksRefund = transaction.amount < 0
  const expense = picksRefund ? transaction : picked[0]

  if (!expense) {
    return (
      <div className="space-y-2" data-testid="link-chain-preview">
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Pick the expense this refund gives money back for.
        </p>
        <RefundChainBox>
          <RefundChainRow
            icon={iconOf(transaction)}
            merchantName={transaction.merchant_name ?? NO_MERCHANT}
            kind="Refund"
            dt={transaction.dt}
            amount={transaction.amount}
            currency={transaction.currency}
            isNew
          />
        </RefundChainBox>
      </div>
    )
  }

  // A refund being linked again to the expense it was on is not among that expense's refunds a second time
  const refunds = picksRefund ? picked : [transaction]
  const alreadyLinked = picksRefund
    ? linkedCount
    : expense.refund_transaction_ids.filter((id) => id !== transaction.id).length
  const roomBefore = picksRefund ? refundRoom : -expense.amount - (expense.refunded_amount ?? 0)
  const room =
    roomBefore === undefined ? undefined : roomBefore - refunds.reduce((total, refund) => total + refund.amount, 0)
  const status = room === undefined ? null : getRefundStatus(expense, room)
  const icon = iconOf(expense)
  return (
    <div data-testid="link-chain-preview">
      <RefundChainBox>
        <RefundChainRow
          icon={icon}
          merchantName={expense.merchant_name ?? NO_MERCHANT}
          kind={kindOf(expense)}
          dt={expense.dt}
          amount={expense.amount}
          currency={expense.currency}
          lineBelow
        />
        {alreadyLinked > 0 && (
          <RefundChainNote lineBelow={refunds.length > 0}>{describeLinkedRefunds(alreadyLinked)}</RefundChainNote>
        )}
        {refunds.length > 0 && alreadyLinked === 0 && <RefundChainLead />}
        {/* A long run of picks scrolls in its own box, so it never pushes the list off a phone's screen */}
        <div className="max-h-[9.5rem] overflow-y-auto overscroll-contain">
          {refunds.map((refund, index) => (
            <div key={refund.id}>
              <RefundChainGap place="above" />
              <RefundChainRow
                icon={icon}
                merchantName={refund.merchant_name ?? NO_MERCHANT}
                kind="Refund"
                dt={refund.dt}
                amount={refund.amount}
                currency={refund.currency}
                isNew
                lineAbove
                lineBelow={index < refunds.length - 1}
              />
              <RefundChainGap place="below" drawn={index < refunds.length - 1} />
            </div>
          ))}
        </div>
        <RefundChainFooter
          room={room}
          currency={expense.currency}
          keepsUnlinkRoom={false}
          status={status}
          announcesChanges
        />
      </RefundChainBox>
    </div>
  )
}
