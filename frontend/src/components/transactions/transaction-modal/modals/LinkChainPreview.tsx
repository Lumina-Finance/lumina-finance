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
  RefundChainRow,
} from '@/components/transactions/transaction-modal/sections/RefundChain'
import { REFUND_STATUS_LABELS, getRefundStatus } from '@/components/transactions/transaction-modal/utils/refund'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

interface LinkChainPreviewProps {
  /** The open transaction. On an expense the picks are its refunds, and on a refund the pick is its expense */
  transaction: Transaction

  /** The rows picked so far, in the list's order */
  picked: Transaction[]

  /** On an expense, what is left to refund before the picks, undefined while it loads. Ignored on a refund */
  refundRoom: number | undefined

  /** The round icon an expense and its refunds share, from the expense's category */
  iconOf: (expense: Transaction) => ReactNode
  kindOf: (expense: Transaction) => string
}

/**
 * The chain linking would make, pinned above the picker's buttons in the look of the Refunds section: the expense, its
 * refunds, and what is left to refund with its badge. Each pick sits in the dashed Unsaved border the Refunds section
 * gives a link Save has yet to make, since Link only holds it there until Save. The refunds the expense already has stay
 * out, since what is left already counts them. A refund with no expense picked yet shows itself alone. A screen reader
 * hears what is left each time a pick changes it, from a live region present from the start, so the first pick is read
 * too
 */
export default function LinkChainPreview({ transaction, picked, refundRoom, iconOf, kindOf }: LinkChainPreviewProps) {
  const { formatCurrency } = useMoneyFormatters()
  const picksRefund = transaction.amount < 0
  const expense = picksRefund ? transaction : picked[0]

  // A refund being linked again to the expense it was on is not among that expense's refunds a second time
  const refunds = picksRefund ? picked : [transaction]
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
                notSaved={!picksRefund}
                lineBelow
              />
              {/* The lead eases with the first pick, so the chain's height never snaps beside an easing row */}
              <AnimatePresence initial={false}>
                {refunds.length > 0 && (
                  <RevealRow key="lead" spacingClassName="">
                    <RefundChainLead />
                  </RevealRow>
                )}
              </AnimatePresence>
              {/* A long run of picks scrolls in its own box, so it never pushes the list off a phone's screen. Each pick
                  eases in and out as a row of the Refunds section does. The box and each row reach 8px past the chain
                  on each side, with padding to match, so neither cuts off the Unsaved border */}
              <div className="-mx-2 max-h-[9.5rem] overflow-y-auto overscroll-contain">
                <AnimatePresence initial={false}>
                  {refunds.map((refund, index) => (
                    <RevealRow key={refund.id} spacingClassName="px-2">
                      <RefundChainGap place="above" />
                      <RefundChainRow
                        icon={iconOf(expense)}
                        merchantName={refund.merchant_name ?? NO_MERCHANT}
                        kind="Refund"
                        dt={refund.dt}
                        amount={refund.amount}
                        currency={refund.currency}
                        notSaved={picksRefund}
                        joinsAbove={picksRefund && index > 0}
                        joinsBelow={picksRefund && index < refunds.length - 1}
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
