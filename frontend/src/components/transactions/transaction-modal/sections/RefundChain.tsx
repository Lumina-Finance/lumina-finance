import type { ReactNode } from 'react'
import { Unlink } from 'lucide-react'
import { HintButton } from '@/components/tooltips/HintButton'
import type { RefundStatus } from '@/components/transactions/transaction-modal/utils/refund'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatDateLabel } from '@/utils/date'

const STATUS_BADGES: Record<RefundStatus, { label: string; background: string; color: string }> = {
  full: { label: 'Refunded in full', background: 'var(--app-positive-soft)', color: 'var(--app-positive-text)' },
  partial: { label: 'Partly refunded', background: 'var(--app-warning-soft)', color: 'var(--app-warning-text)' },
}

/** Says at the end of the section's heading how much of the expense its refunds give back */
export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const { label, background, color } = STATUS_BADGES[status]
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5"
      style={{ background, color }}
      data-testid="refund-status"
    >
      {label}
    </span>
  )
}

// The dashed line that joins the rows, centred under the round icons
function ChainLine({ className = '' }: { className?: string }) {
  return (
    <span className={`flex w-9 shrink-0 justify-center self-stretch ${className}`} aria-hidden>
      <span className="border-l border-dashed" style={{ borderColor: 'var(--app-border-strong)' }} />
    </span>
  )
}

// The stretch of dashed line above or below a row's icon, so the line stays whole however tall a wrapped row grows
function ChainSegment({ drawn }: { drawn: boolean }) {
  return (
    <span className="flex min-h-0 flex-1 justify-center" aria-hidden>
      {drawn && <span className="border-l border-dashed" style={{ borderColor: 'var(--app-border-strong)' }} />}
    </span>
  )
}

/**
 * Half the dashed line between two refunds, drawn above and below each one. An unsaved refund's box spreads over both
 * halves, so the box stays inside the refund's own row. That row clips as it grows and collapses. Under the last refund
 * the half keeps its room with no line, so the line ends at that refund's icon
 */
export function RefundChainGap({ drawn = true }: { drawn?: boolean }) {
  return (
    <div className="flex h-1.5">
      <ChainLine className={drawn ? '' : 'invisible'} />
    </div>
  )
}

/**
 * The dashed line under the expense. With the first refund's own half gap, it puts the refunds twice as far from the
 * expense as from each other, so the expense reads apart from them
 */
export function RefundChainLead() {
  return (
    <div className="flex h-4.5">
      <ChainLine />
    </div>
  )
}

/** Follows the Refunds heading with how many refunds the chain holds */
export function RefundCount({ count }: { count: number }) {
  return (
    <span
      className="ml-1.5 whitespace-nowrap font-normal"
      style={{ color: 'var(--app-text-muted)' }}
      data-testid="refund-count"
    >
      {/* A screen reader hears ", 3 linked" after the heading in place of the drawn dot and number */}
      <span aria-hidden>· {count}</span>
      <span className="sr-only">, {count} linked</span>
    </span>
  )
}

interface RefundChainRowProps {
  icon: ReactNode
  merchantName: string

  /** What the transaction is, such as its category or "Refund", shown before its date */
  kind: string
  dt: string
  amount: number
  currency: string

  /** Marks a link that Save has yet to make */
  notSaved?: boolean

  /** Offered on a refund the window can unlink, named after the transaction on the other side of the link */
  unlink?: { otherName: string; disabled: boolean; onUnlink: () => void }

  /** Keeps the room Unlink takes on a row without it, so every amount in the chain ends on one edge */
  keepsUnlinkRoom?: boolean

  /** Carries the dashed line from the row above down to the icon, and from the icon on to the row below */
  lineAbove?: boolean
  lineBelow?: boolean

  /** The id of the transaction on the row, so focus can find its Unlink once a link made in the picker lands here */
  linkId?: string
  testId?: string
}

/** One transaction in the chain: its category icon, merchant, what it is and when, and the amount that moved */
export function RefundChainRow({
  icon,
  merchantName,
  kind,
  dt,
  amount,
  currency,
  notSaved = false,
  unlink,
  keepsUnlinkRoom = false,
  lineAbove = false,
  lineBelow = false,
  linkId,
  testId,
}: RefundChainRowProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  return (
    // A link Save has yet to make sits in a dashed amber box. The box reaches past the row by 8px on each side and 4px
    // above and below, into the room between rows, and its padding and border take that back. So the row keeps its
    // place and height, and nothing moves when Save turns the box back into a plain row. Two unsaved refunds in a row
    // keep 4px of the 12px between them, so their boxes never touch
    <div
      className={`flex items-center gap-3 ${notSaved ? '-mx-2 -my-1 rounded-lg border border-dashed px-[7px] py-[3px]' : ''}`}
      style={notSaved ? { background: 'var(--app-warning-soft)', borderColor: 'var(--app-warning-dot)' } : undefined}
      data-testid={testId}
      data-link-id={linkId}
      data-not-saved={notSaved ? 'true' : undefined}
    >
      {/* The icon stays centred on the row's text, with the line filling the room a wrapped row leaves around it */}
      <span className="flex w-9 shrink-0 flex-col items-center self-stretch">
        <ChainSegment drawn={lineAbove} />
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none ${notSaved ? 'border-[1.5px] border-dashed' : ''}`}
          style={
            notSaved
              ? { borderColor: 'var(--app-warning-dot)', background: 'var(--app-surface-soft)' }
              : { background: 'var(--app-surface-soft)' }
          }
          aria-hidden
        >
          {icon}
        </span>
        <ChainSegment drawn={lineBelow} />
      </span>
      <div className="min-w-0 flex-1">
        {/* A long name wraps on a phone rather than cutting off, since the row has room to grow */}
        <p className="break-words text-sm font-medium leading-5" style={{ color: 'var(--app-text)' }}>
          {merchantName}
          {notSaved && (
            <span
              className="ml-1.5 inline-block rounded-full px-1.5 align-[1px] text-xs font-medium leading-4"
              style={{ background: 'var(--app-warning-text)', color: 'var(--app-bg)' }}
            >
              Unsaved
            </span>
          )}
        </p>
        {/* Wraps between whole phrases on a narrow screen rather than cutting the date off. Each phrase draws its
            dot in front, and the negative margin pushes the dot of a phrase starting a line out of the clipped box.
            The dot is drawn rather than written, with empty alternative text, so screen readers skip it */}
        <div className="overflow-hidden">
          <p
            className="-ml-3 flex flex-wrap text-xs leading-4"
            style={{ color: notSaved ? 'var(--app-text-muted-on-warning)' : 'var(--app-text-muted)' }}
          >
            {[kind, formatDateLabel(dt)].map((part) => (
              <span
                key={part}
                className="whitespace-nowrap before:inline-block before:w-3 before:text-center before:content-['·'_/_'']"
              >
                {part}
              </span>
            ))}
          </p>
        </div>
      </div>
      <span
        className="font-financial shrink-0 text-sm"
        style={{ color: amount > 0 ? 'var(--app-positive)' : 'var(--app-text)' }}
      >
        {formatMovedCurrency(amount, currency)}
      </span>
      {/* The row grows and collapses inside a box that clips, so the focus ring is drawn inside the button's edge */}
      {unlink && (
        <HintButton
          className="app-icon-button shrink-0 focus-visible:[outline-offset:calc(var(--app-focus-offset)*-1)]"
          hint="Unlink"
          aria-label={`Unlink ${unlink.otherName}`}
          disabled={unlink.disabled}
          onClick={unlink.onUnlink}
        >
          <Unlink size={16} aria-hidden />
        </HintButton>
      )}
      {!unlink && keepsUnlinkRoom && <span className="w-8 shrink-0" aria-hidden />}
    </div>
  )
}

/** Holds a row's place while its transaction loads, at the height the loaded row takes */
export function RefundChainPlaceholder() {
  return (
    <div className="flex h-9 items-center gap-3" data-testid="linked-transaction">
      <ChainLine className="opacity-0" />
      <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        Loading…
      </p>
    </div>
  )
}

interface RefundChainFooterProps {
  room: number | undefined
  currency: string

  /** Keeps Unlink's room after the total, so it ends on the same edge as the amounts above it */
  keepsUnlinkRoom: boolean
}

/** Closes the chain with what is left to refund of the expense, held at its height while that is worked out */
export function RefundChainFooter({ room, currency, keepsUnlinkRoom }: RefundChainFooterProps) {
  const { formatCurrency } = useMoneyFormatters()
  return (
    <div
      className="mt-1.5 flex items-center gap-3 border-t pt-2.5 text-sm leading-5"
      style={{ borderColor: 'var(--app-border)' }}
    >
      <span className="flex-1" style={{ color: 'var(--app-text-muted)' }}>
        Left to refund
      </span>
      {room === undefined ? (
        <span role="status" style={{ color: 'var(--app-text-muted)' }}>
          Loading…
        </span>
      ) : (
        <span className="font-financial" style={{ color: 'var(--app-text)' }} data-testid="refund-room">
          {formatCurrency(room, currency)}
        </span>
      )}
      {keepsUnlinkRoom && <span className="w-8 shrink-0" aria-hidden />}
    </div>
  )
}

/** The box the expense, its marker, its refunds and the footer sit in */
export function RefundChainBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border px-3 pb-2.5 pt-3" style={{ borderColor: 'var(--app-border)' }}>
      {children}
    </div>
  )
}
