import type { ReactNode } from 'react'
import { Unlink } from 'lucide-react'
import { HintButton } from '@/components/tooltips/HintButton'
import type { RefundStatus } from '@/components/transactions/transaction-modal/utils/refund'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatDateLabel } from '@/utils/date'

/** Named in a chain's row for a transaction with no merchant */
export const NO_MERCHANT = 'No merchant'

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

// One stretch of the dashed line. The dashes come from a repeating gradient rather than a dashed border, since the
// browser stretches a dashed border's dashes to fill its length, and the short stretches between rows then read solid.
// The dashes take the subtle text colour at 80%, so the line that ties the refunds to their expense reaches the 3:1 a
// non-text mark needs, about 3.2:1 on the window in the light theme and 3.8:1 in the dark one. The border colour
// reached only 1.4:1
const DASHES = {
  backgroundImage: 'linear-gradient(color-mix(in srgb, var(--app-text-subtle) 80%, transparent) 50%, transparent 50%)',
  backgroundSize: '1px 6px',
}

// The dashed line that joins the rows, centred under the round icons. A stretch that ends on a whole gap leads the
// stretch after it into a dash, so the dashes stay in step where two meet
function ChainLine({ className = '', endsOnGap = false }: { className?: string; endsOnGap?: boolean }) {
  return (
    <span className={`flex w-9 shrink-0 justify-center self-stretch ${className}`} aria-hidden>
      <span className="w-px" style={endsOnGap ? { ...DASHES, backgroundPosition: 'bottom' } : DASHES} />
    </span>
  )
}

// The stretch of dashed line above or below a row's icon, so the line stays whole however tall a wrapped row grows.
// The stretch below ends on a whole gap, however tall, so the stretch after it starts its dash in step
function ChainSegment({ drawn, below = false }: { drawn: boolean; below?: boolean }) {
  return (
    <span className="flex min-h-0 flex-1 justify-center" aria-hidden>
      {drawn && <span className="w-px" style={below ? { ...DASHES, backgroundPosition: 'bottom' } : DASHES} />}
    </span>
  )
}

/**
 * Part of the dashed line between two refunds, drawn inside each refund's own row. That row clips as it grows and
 * collapses. The part takes 8px above the refund and 4px below it, so two refunds sit 12px apart. An unsaved
 * refund's dashed border reaches 4px into each, and its "Unsaved" label, centred on the border's top edge above
 * Unlink, takes the rest of the room above. Under an unsaved refund joined to the one above, the border fills all 8px.
 * Under the last refund the part keeps its room with no line, so the line ends at that refund's icon
 */
export function RefundChainGap({ place, drawn = true }: { place: 'above' | 'below'; drawn?: boolean }) {
  return (
    <div className={`flex ${place === 'above' ? 'h-2' : 'h-1'}`}>
      {/* The 4px below starts on a dash where the icon's stretch ended on a gap, and the 8px above ends on a whole
          gap, so the two make one 12px run of whole dashes and the icon's stretch after them starts on a dash */}
      <ChainLine className={drawn ? '' : 'invisible'} endsOnGap={place === 'above'} />
    </div>
  )
}

/**
 * The dashed line under the expense. With the room above the first refund, it puts the refunds twice as far from the
 * expense as from each other, so the expense reads apart from them
 */
export function RefundChainLead() {
  return (
    // Starts on a dash where the expense's stretch ended on a gap. The first refund's 8px above it ends the run on a
    // whole gap
    <div className="flex h-4">
      <ChainLine />
    </div>
  )
}

/** A short muted line on the dashed line, standing for rows the chain folds away, such as "2 refunds linked" */
export function RefundChainNote({ children, lineBelow = true }: { children: ReactNode; lineBelow?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="flex w-9 shrink-0 flex-col items-center self-stretch">
        <ChainSegment drawn />
        <ChainSegment drawn={lineBelow} below />
      </span>
      <p className="py-1 text-xs leading-4" style={{ color: 'var(--app-text-muted)' }} data-testid="refund-chain-note">
        {children}
      </p>
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

  /** Marks the row a link picker would add, in a preview of the chain linking makes */
  isNew?: boolean

  /** Joins an unsaved row's border to the unsaved row above or below it, so a run of them shares one border */
  joinsAbove?: boolean
  joinsBelow?: boolean

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
  isNew = false,
  joinsAbove = false,
  joinsBelow = false,
  unlink,
  keepsUnlinkRoom = false,
  lineAbove = false,
  lineBelow = false,
  linkId,
  testId,
}: RefundChainRowProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  // A link Save has yet to make sits in a dashed border in the warning colour, with no fill, and "Unsaved" sits on
  // the border's top edge above Unlink. The border reaches past the row by 8px on each side and 4px above and below,
  // into the room between rows, and its padding takes that back. So the row keeps its place and height, and nothing
  // moves when Save takes the border away. Unsaved rows next to each other share one border with one label: a row
  // joined to the one above reaches through all 8px above it with no top edge, and a row joined to the one below
  // drops its bottom edge, so their sides meet at the edge of the rows they grow in
  const unsavedBox = notSaved
    ? [
        'relative -mx-2 border-x border-dashed px-[7px]',
        joinsAbove ? '-mt-2 pt-2' : '-mt-1 rounded-t-lg border-t pt-[3px]',
        joinsBelow ? '-mb-1 pb-1' : '-mb-1 rounded-b-lg border-b pb-[3px]',
      ].join(' ')
    : ''
  return (
    <div
      className={`flex items-center gap-3 ${unsavedBox}`}
      style={notSaved ? { borderColor: 'var(--app-warning-dot)' } : undefined}
      data-testid={testId}
      data-link-id={linkId}
      data-not-saved={notSaved ? 'true' : undefined}
    >
      {/* The label's fill matches the window behind the box, so it breaks the dashes where it sits. Its line box is
          shorter than its letters, so the fill hides only the border, never the row above. It ends where Unlink, or
          the room Unlink keeps, ends, 7px of padding in from the right, so it stays off the border's rounded corner
          and clear of the dashed line that runs down through the icons. A screen reader hears "not saved yet" after
          the name instead */}
      {notSaved && !joinsAbove && (
        <span
          className="absolute right-[7px] top-[-0.5px] -translate-y-1/2 px-1 text-[0.625rem] font-semibold uppercase leading-1.5 tracking-wider"
          style={{ background: 'var(--app-bg)', color: 'var(--app-warning-text)' }}
          aria-hidden
          data-testid="unsaved-label"
        >
          Unsaved
        </span>
      )}
      {/* The icon stays centred on the row's text, with the line filling the room a wrapped row leaves around it */}
      <span className="flex w-9 shrink-0 flex-col items-center self-stretch">
        <ChainSegment drawn={lineAbove} />
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none"
          style={{ background: 'var(--app-surface-soft)' }}
          aria-hidden
        >
          {icon}
        </span>
        <ChainSegment drawn={lineBelow} below />
      </span>
      <div className="min-w-0 flex-1">
        {/* A long name wraps on a phone rather than cutting off, since the row has room to grow. A screen reader hears
            that the link is unsaved in place of the drawn border */}
        <p className="break-words text-sm font-medium leading-5" style={{ color: 'var(--app-text)' }}>
          {merchantName}
          {notSaved && <span className="sr-only">, not saved yet</span>}
          {/* Sits after the name, 4px off it, as a word a screen reader hears in its place */}
          {isNew && (
            <span
              className="ml-1 inline-block rounded-full px-1.5 align-[1px] text-[0.625rem] font-semibold uppercase leading-4 tracking-wider"
              style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
              data-testid="refund-chain-new"
            >
              <span className="sr-only">, </span>New
            </span>
          )}
        </p>
        {/* Wraps between whole phrases on a narrow screen rather than cutting the date off. Each phrase draws its
            dot in front, and the negative margin pushes the dot of a phrase starting a line out of the clipped box.
            The dot is drawn rather than written, with empty alternative text, so screen readers skip it */}
        <div className="overflow-hidden">
          <p className="-ml-3 flex flex-wrap text-xs leading-4" style={{ color: 'var(--app-text-muted)' }}>
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
        style={{ color: amount <= 0 ? 'var(--app-text)' : 'var(--app-positive)' }}
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

  /** Shown before the total in a preview. A preview has no section heading to carry the badge */
  status?: RefundStatus | null

  /** Has a screen reader read the whole line out again when the total changes, as a preview's picks change it */
  announcesChanges?: boolean
}

/** Closes the chain with what is left to refund of the expense, held at its height while that is worked out */
export function RefundChainFooter({
  room,
  currency,
  keepsUnlinkRoom,
  status,
  announcesChanges = false,
}: RefundChainFooterProps) {
  const { formatCurrency } = useMoneyFormatters()
  return (
    <div
      className="mt-2 flex items-center gap-3 border-t pt-2.5 text-sm leading-5"
      style={{ borderColor: 'var(--app-border)' }}
      aria-live={announcesChanges ? 'polite' : undefined}
      aria-atomic={announcesChanges ? true : undefined}
    >
      <span className="flex-1" style={{ color: 'var(--app-text-muted)' }}>
        Left to refund
      </span>
      {status && room !== undefined && <RefundStatusBadge status={status} />}
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
