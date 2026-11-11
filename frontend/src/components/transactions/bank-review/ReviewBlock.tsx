import { useId, useRef, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Landmark, PauseCircle, TriangleAlert } from 'lucide-react'
import type { BankReviewItem } from '@/api/bank-sync'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { Checkbox } from '@/components/forms/Checkbox'
import { HintButton } from '@/components/tooltips/HintButton'
import { CONTENT_EASE_CURVE, QUICK_EASE_S } from '@/utils/widthEase'
import { describeTickLimit } from '@/components/transactions/bulk-edit/reviewSelection'
import type { RowSelectionMark } from '@/components/transactions/bulk-edit/selection'
import { DetailPhrases } from '@/components/transactions/bank-review/DetailPhrases'
import { ReadFailureNotice, type BankReadFailure } from '@/components/transactions/bank-review/ReadFailureNotice'
import { REVIEW_MOTION } from '@/components/transactions/constants/bankReview'
import { useFocusAfterRetry } from '@/components/transactions/hooks/useFocusAfterRetry'
import {
  REVIEW_KIND_LABELS,
  describeReviewItem,
  formatReviewDate,
  getReviewItemAmount,
  type BacklogNotice,
} from '@/components/transactions/utils/bankReview'

// How many items show before the block is opened, so a long backlog doesn't push the ledger away
export const COLLAPSED_ITEM_COUNT = 4

// What a failed read of the items calls them in its notice
const ITEMS_SUBJECT = 'Bank items to review'

// How a row out of view leaves as the block closes, the way every row leaves for a reader who asks for
// less motion, so closing on hundreds of loaded items animates only the rows anyone can see
const LEAVE_AT_ONCE = REVIEW_MOTION.reduced.leave

/** The account a bank item belongs to, as its row names it and writes its amount */
export type ReviewItemAccount = {
  name: string
  currency: string
}

/**
 * What the block needs while the transaction list is in selection mode. Only new items can be
 * ticked, since a correction or a removal is decided beside its ledger transaction
 */
export type ReviewRowSelection = {
  /** How a new item's row is marked once any pending shift-click is taken into account */
  markFor: (itemId: string) => RowSelectionMark

  /** False once the selection is full and the item isn't in it */
  isSelectable: (itemId: string) => boolean
  onToggle: (itemId: string, withShift: boolean) => void
  onPointerEnter: (itemId: string) => void
  onPointerLeaveList: () => void
}

type BankReviewBlockProps = {
  /** The items loaded so far, newest first, each of an account the caller can name */
  items: BankReviewItem[]

  /** Every item waiting in scope, loaded or not. The header counts them */
  total: number

  /** Set while the items have never loaded. The block says so in place of its count and rows */
  itemsFailure: BankReadFailure | null

  /** Takes the button that reads the items again. A Needs review marker focuses it while they can't load */
  itemsRetryRef: Ref<HTMLButtonElement>
  accountFor: (accountId: string) => ReviewItemAccount

  /** Left out on an account's own page, since every item there is that account's */
  showAccountNames: boolean

  /** Today as "YYYY-MM-DD" in the user's profile timezone. It decides whether a date shows its year */
  today: string
  backlogNotice: BacklogNotice | null

  /** Set while the backlogs the notice reads have never loaded */
  backlogFailure: BankReadFailure | null
  expanded: boolean
  onToggleExpanded: () => void

  /** The rows on screen as the block last closed, or null to collapse every row that leaves. Those rows collapse while the rest leave at once */
  rowsInViewAtClose: ReadonlySet<string> | null

  /** Called once every row that was leaving has gone */
  onRowsLeft: () => void

  /** More items wait to load. That happens as the open block's end comes into view */
  hasMoreItems: boolean
  isLoadingMore: boolean
  loadMoreSentinelRef: (element: HTMLDivElement | null) => void

  /** Makes newly mounted rows appear without growing in, used for a page of items that just loaded */
  skipEnterAnimation: boolean

  /** The item a Needs review marker just went to, ringed for a moment so the eye finds it */
  highlightedId: string | null

  /** Set while a Needs review marker's request is still going to its item */
  isGoingToItem: boolean

  /** Takes each row as it mounts and null as it goes, for scrolling to and focusing an item */
  registerRow: (itemId: string, row: HTMLDivElement | null) => void

  /** Opens an item for review */
  onOpenItem: (item: BankReviewItem) => void

  /** Set while the transaction list is in selection mode. A new item's row then ticks it rather than opening it */
  selection?: ReviewRowSelection

  prefersReducedMotion: boolean | null
}

/**
 * The bank items waiting for review above the transaction list: new items, corrections and removals
 * that stay outside the ledger and every balance until the user acts on them
 *
 * Each row opens its item for review. Rows grow in and collapse out with the list's day groups, except that closing the block collapses only
 * the rows on screen. A read that fails is said inside the block, under its title, rather than
 * leaving it empty
 */
export function BankReviewBlock({
  items,
  total,
  itemsFailure,
  itemsRetryRef,
  accountFor,
  showAccountNames,
  today,
  backlogNotice,
  backlogFailure,
  expanded,
  onToggleExpanded,
  rowsInViewAtClose,
  onRowsLeft,
  hasMoreItems,
  isLoadingMore,
  loadMoreSentinelRef,
  skipEnterAnimation,
  highlightedId,
  isGoingToItem,
  registerRow,
  onOpenItem,
  selection,
  prefersReducedMotion,
}: BankReviewBlockProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  const titleId = useId()
  const listId = useId()
  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_ITEM_COUNT)
  const toggleLabel = expanded ? 'Show fewer' : `Show all ${total.toLocaleString()}`
  const { collapsed, enterTransition, leave } = REVIEW_MOTION[prefersReducedMotion ? 'reduced' : 'full']

  // Items that load on a retry take focus on their first row, as a Needs review marker's item does,
  // and a pause status on its notice, or on the title when it has nothing to say
  const headingRef = useRef<HTMLHeadingElement>(null)
  const backlogNoticeRef = useRef<HTMLParagraphElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemsFailureRef = useRef<HTMLDivElement>(null)
  const backlogFailureRef = useRef<HTMLDivElement>(null)
  useFocusAfterRetry(itemsFailure !== null, itemsFailureRef, () =>
    listRef.current?.querySelector<HTMLElement>('[role="listitem"]'),
  )
  useFocusAfterRetry(backlogFailure !== null, backlogFailureRef, () => backlogNoticeRef.current ?? headingRef.current)

  // Each notice grows in and collapses out under the title, its room kept inside it
  const notice = {
    className: 'overflow-hidden',
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1 },
    exit: leave,
    transition: enterTransition,
  }

  return (
    <section
      aria-labelledby={titleId}

      // Read by a browser test waiting for a marker's request to end, since closing the block until
      // then opens it again
      data-going-to-item={isGoingToItem ? 'true' : 'false'}
      className="overflow-hidden rounded-2xl border border-dashed"
      style={{ borderColor: 'var(--app-review-border)', background: 'var(--app-review-bg)' }}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 px-4 pt-3.5 sm:px-5">
        <Landmark
          size={17}
          strokeWidth={2}
          aria-hidden
          className="shrink-0"
          style={{ color: 'var(--app-warning-text)' }}
        />
        {/* Titled like the page's other cards. Focusable once a retry succeeds, but never a tab stop */}
        <h2 ref={headingRef} id={titleId} tabIndex={-1} className="app-label leading-snug focus:outline-none">
          Waiting for review
        </h2>

        {/* Left out while the items can't load, since nothing is known to count */}
        {itemsFailure === null && (
          <span
            data-testid="review-count"
            className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
            style={{ background: 'var(--app-warning-text)', color: 'var(--app-review-count-text)' }}
          >
            {total.toLocaleString()}
          </span>
        )}

        {/* The caret opens and closes the list, up here so a long list closes from where it starts, not
            from its end, and ends the header's first row like the chevron of the app's other collapsible
            sections. It stays mounted as the list changes, so keyboard focus stays on it through both.
            It turns over as they do, and its name says what pressing it does */}
        {/* Grows in when the backlog passes the rows shown, and shrinks away when it falls back under */}
        <AnimatePresence initial={false}>
          {total > COLLAPSED_ITEM_COUNT && (
            <motion.span
              key="toggle"
              className="ml-auto inline-flex shrink-0"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: prefersReducedMotion ? 0 : QUICK_EASE_S, ease: CONTENT_EASE_CURVE }}
            >
              <HintButton
                aria-expanded={expanded}
                aria-controls={listId}
                aria-label={toggleLabel}
                hint={toggleLabel}
                onClick={onToggleExpanded}
                className="app-icon-button"
              >
                <ChevronDown
                  size={16}
                  aria-hidden
                  className={`transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
                />
              </HintButton>
            </motion.span>
          )}
        </AnimatePresence>
        <p className="basis-full pb-3 pt-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Bank items stay out of every balance until you add them to your ledger.
        </p>
      </div>

      <AnimatePresence initial={false}>
        {backlogNotice && (
          <motion.div key="backlog" {...notice}>
            <div className="px-4 pb-3 sm:px-5">
              {/* Focusable once a retry succeeds, but never a tab stop */}
              <p
                ref={backlogNoticeRef}
                tabIndex={-1}
                className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs focus:outline-none"
                style={{ background: 'var(--app-warning-soft)', color: 'var(--app-text)' }}
              >
                {backlogNotice.tone === 'paused' ? (
                  <PauseCircle
                    size={14}
                    aria-hidden
                    className="mt-px shrink-0"
                    style={{ color: 'var(--app-warning-text)' }}
                  />
                ) : (
                  <TriangleAlert
                    size={14}
                    aria-hidden
                    className="mt-px shrink-0"
                    style={{ color: 'var(--app-warning-text)' }}
                  />
                )}
                <span>{backlogNotice.text}</span>
              </p>
            </div>
          </motion.div>
        )}
        {backlogFailure && (
          <motion.div key="backlog-failure" {...notice}>
            <div ref={backlogFailureRef} className="px-4 pb-3 sm:px-5">
              <ReadFailureNotice subject="Sync pause status" failure={backlogFailure} />
            </div>
          </motion.div>
        )}
        {itemsFailure && (
          <motion.div key="items-failure" {...notice}>
            <div ref={itemsFailureRef} className="px-4 pb-3 sm:px-5">
              <ReadFailureNotice subject={ITEMS_SUBJECT} failure={itemsFailure} retryRef={itemsRetryRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* One list, so a screen reader counts every loaded item, with each row past the first few
          growing in as the block opens */}
      <div ref={listRef} id={listId} role="list" onMouseLeave={selection?.onPointerLeaveList}>
        {/* A leaving row reads which rows were on screen from here rather than from its own props,
            since those stop updating once it has left the list */}
        <AnimatePresence initial={false} custom={rowsInViewAtClose} onExitComplete={onRowsLeft}>
          {visibleItems.map((item) => {
            const account = accountFor(item.account_id)
            const amount = getReviewItemAmount(item, account.currency, formatMovedCurrency)
            const details = [
              formatReviewDate(item.bank.date, today),
              showAccountNames && account.name,
              describeReviewItem(item),
            ]

            // In selection mode a new item's row ticks it, and every row makes room for the box so
            // the text of corrections and removals lines up with the rest. A range being picked takes the
            // hover wash made for a shaded surface, since the plain hover fill matches this card in light
            const tick = selection && item.kind === 'new' ? selection : null
            const mark = tick ? tick.markFor(item.id) : 'none'
            const isSelectable = tick ? tick.isSelectable(item.id) : false
            const selectionBackground =
              mark === 'selected'
                ? 'var(--app-accent-soft)'
                : mark === 'pending'
                  ? 'var(--app-hover-on-surface-soft)'
                  : undefined

            const content = (
              <div className="flex items-center gap-3 py-2.5">
                <div data-testid="review-item-text" className="min-w-0 flex-1">
                  {/* The label runs inline after the text, so a wrapped description keeps it beside its last word */}
                  <p className="break-words text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                    {item.bank.description}
                    <span
                      className="ml-2 inline-block whitespace-nowrap rounded-full border px-1.5 py-0.5 align-[1px] text-xs font-medium leading-none"
                      style={{ borderColor: 'var(--app-review-border)', color: 'var(--app-warning-text)' }}
                    >
                      {REVIEW_KIND_LABELS[item.kind]}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                    <DetailPhrases phrases={details} />
                  </p>
                </div>
                <span
                  data-testid="review-item-amount"
                  className="shrink-0 font-financial text-sm font-medium tabular-nums"
                  style={{
                    color:
                      amount.sign > 0
                        ? mark === 'selected'
                          ? 'var(--app-positive-on-accent-tint)'
                          : 'var(--app-positive)'
                        : 'var(--app-text)',
                    textDecoration: amount.isStruckThrough ? 'line-through' : undefined,
                  }}
                >
                  {amount.text}
                </span>
              </div>
            )

            return (
              <motion.div
                key={item.id}
                ref={(row: HTMLDivElement | null) => registerRow(item.id, row)}
                role="listitem"

                // Focusable from a Needs review marker, so a screen reader moves to the item too, but
                // never a tab stop, since the row has one in its button
                tabIndex={-1}
                className="relative overflow-hidden focus:outline-none"
                initial={skipEnterAnimation ? false : collapsed}
                animate={{ height: 'auto', opacity: 1 }}
                variants={{
                  leave: (inView: ReadonlySet<string> | null) =>
                    inView === null || inView.has(item.id) ? leave : LEAVE_AT_ONCE,
                }}
                exit="leave"
                transition={enterTransition}
              >
                {/* The divider spans the same width as the hover fill and the ring below it, short of the
                    card's edges, so the fill never reaches past the line above it */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-2 top-0 h-px sm:inset-x-2.5"
                  style={{ background: 'var(--app-review-divider)' }}
                />

                {/* A ring rather than a fill, since the warning tint would take the muted line below
                    4.5:1 in the dark theme. It frames the content, halfway into
                    the margin the text keeps from the card's edges, in line with the divider above it */}
                <span
                  data-testid="review-item-ring"
                  aria-hidden
                  className="pointer-events-none absolute inset-x-2 bottom-0 top-px rounded-lg sm:inset-x-2.5"
                  style={{
                    boxShadow: highlightedId === item.id ? 'inset 0 0 0 2px var(--app-warning-dot)' : 'none',
                    transition: prefersReducedMotion
                      ? undefined
                      : 'box-shadow var(--app-ease-duration) var(--app-ease-curve)',
                  }}
                />

                {/* Beside the row's button rather than inside it, since a checkbox can't sit inside
                    another button. Raised above it, so a press on the box lands on the box */}
                {tick && (
                  <span
                    className="absolute inset-y-0 left-4 z-10 flex items-center sm:left-5"
                    title={isSelectable ? undefined : describeTickLimit(true)}
                  >
                    <Checkbox
                      checked={mark === 'selected'}
                      disabled={!isSelectable}
                      label={`Select ${item.bank.description}, waiting for review`}
                      onChange={(event) => tick.onToggle(item.id, event.shiftKey)}
                    />
                  </span>
                )}
                <button
                  type="button"

                  // A ticked row's button takes the tick rather than opening the item. A shift-click
                  // runs even on a row past the limit, since the range it takes steps over that row
                  onClick={(event) => {
                    if (!tick) onOpenItem(item)
                    else if (isSelectable || event.shiftKey) tick.onToggle(item.id, event.shiftKey)
                  }}
                  onMouseEnter={tick ? () => tick.onPointerEnter(item.id) : undefined}
                  tabIndex={tick ? -1 : undefined}
                  className={`group relative block w-full text-left focus-visible:outline-none ${
                    selection ? 'pl-12 pr-4 sm:pl-13 sm:pr-5' : 'px-4 sm:px-5'
                  } ${tick ? 'select-none' : ''}`}
                  style={{ background: selectionBackground }}
                >
                  {/* Fills on hover as a transaction row does, easing over the same time. The fill is the wash
                      made for a shaded surface, since the flat hover colour is the review block's own. Keyboard
                      focus keeps the ring in place of the fill, so the ring is measured against the block, as
                      the Accounts rows do. The hover variant also matches a focused button, so the fill is
                      cleared and the ring marked important to win over it */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-2 bottom-0 top-px rounded-lg transition-[background-color,box-shadow] motion-reduce:transition-none group-hover:bg-[var(--app-hover-on-surface-soft)] group-focus-visible:bg-transparent! group-focus-visible:ring-2! group-focus-visible:ring-inset group-focus-visible:ring-[var(--app-focus-ring)]! sm:inset-x-2.5"
                  />
                  {content}
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {expanded && hasMoreItems && (
        <>
          <div ref={loadMoreSentinelRef} aria-hidden style={{ height: 1 }} />
          {isLoadingMore && (
            <p
              role="status"
              className="px-4 py-2.5 text-center text-sm sm:px-5"
              style={{ color: 'var(--app-text-muted)' }}
            >
              Loading more items…
            </p>
          )}
        </>
      )}
    </section>
  )
}
