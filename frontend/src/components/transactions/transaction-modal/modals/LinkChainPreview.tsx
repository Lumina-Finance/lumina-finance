import type { ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import type { Transaction } from '@/api/transactions'
import RevealRow from '@/components/transactions/transaction-modal/sections/RevealRow'
import {
  NO_MERCHANT,
  RefundChainBox,
  RefundChainFooter,
  RefundChainGap,
  RefundChainLead,
  RefundChainNote,
  RefundChainRow,
} from '@/components/transactions/transaction-modal/sections/RefundChain'
import {
  REFUND_STATUS_LABELS,
  describeLinkedRefunds,
  getRefundStatus,
} from '@/components/transactions/transaction-modal/utils/refund'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

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
 * refund with no expense picked yet shows itself alone, marked New. A screen reader hears what is left each time a
 * pick changes it, from a live region present from the start, so the first pick is read too
 */
export default function LinkChainPreview({
  transaction,
  picked,
  linkedCount,
  refundRoom,
  iconOf,
  kindOf,
}: LinkChainPreviewProps) {
  const { formatCurrency } = useMoneyFormatters()
  const picksRefund = transaction.amount < 0
  const expense = picksRefund ? transaction : picked[0]

  // A refund being linked again to the expense it was on is not among that expense's refunds a second time
  const refunds = picksRefund ? picked : [transaction]
  const alreadyLinked = !expense
    ? 0
    : picksRefund
      ? linkedCount
      : expense.refund_transaction_ids.filter((id) => id !== transaction.id).length
  const roomBefore = !expense ? undefined : picksRefund ? refundRoom : -expense.amount - (expense.refunded_amount ?? 0)
  const room =
    roomBefore === undefined ? undefined : roomBefore - refunds.reduce((total, refund) => total + refund.amount, 0)
  const status = expense && room !== undefined ? getRefundStatus(expense, room) : null
  const announcement =
    expense && room !== undefined
      ? [status && REFUND_STATUS_LABELS[status], `${formatCurrency(room, expense.currency)} left to refund`]
          .filter(Boolean)
          .join(', ')
      : ''

  return (
    <div data-testid="link-chain-preview">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {/* The refund alone and the chain a pick makes are rows of their own, so one eases out as the other eases in */}
      <AnimatePresence initial={false}>
        {!expense ? (
          <RevealRow key="alone" spacingClassName="">
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
          </RevealRow>
        ) : (
          <RevealRow key={expense.id} spacingClassName="">
            <RefundChainBox>
              <RefundChainRow
                icon={iconOf(expense)}
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
              {/* The lead eases with the first pick, so the chain's height never snaps beside an easing row */}
              <AnimatePresence initial={false}>
                {refunds.length > 0 && alreadyLinked === 0 && (
                  <RevealRow key="lead" spacingClassName="">
                    <RefundChainLead />
                  </RevealRow>
                )}
              </AnimatePresence>
              {/* A long run of picks scrolls in its own box, so it never pushes the list off a phone's screen. Each pick
                  eases in and out as a row of the Refunds section does */}
              <div className="max-h-[9.5rem] overflow-y-auto overscroll-contain">
                <AnimatePresence initial={false}>
                  {refunds.map((refund, index) => (
                    <RevealRow key={refund.id} spacingClassName="">
                      <RefundChainGap place="above" />
                      <RefundChainRow
                        icon={iconOf(expense)}
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
                    </RevealRow>
                  ))}
                </AnimatePresence>
              </div>
              <RefundChainFooter room={room} currency={expense.currency} keepsUnlinkRoom={false} status={status} />
            </RefundChainBox>
          </RevealRow>
        )}
      </AnimatePresence>
    </div>
  )
}
