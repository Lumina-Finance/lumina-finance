import { useId, useRef, type CSSProperties, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Landmark, ListChecks, PauseCircle, TriangleAlert } from 'lucide-react'
import type { BankReviewItem } from '@/api/bank-sync'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
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

// What a failed read of the items calls them, in its notice and on Bulk approve
// Bulk approve's label at the full text colour, set through the button's own variable so the held
// fade still greys it out
const BULK_APPROVE_LABEL = { '--app-secondary-button-text': 'var(--app-text)' } as CSSProperties

const ITEMS_SUBJECT = 'Bank items to review'

// Why Bulk approve is unavailable while only new items wait in scope
export const BULK_APPROVE_UNAVAILABLE_REASON =
  'Bulk approve applies corrections and removals. New items need a merchant and category, so each is added on its own.'

// How a row out of view leaves as the block closes, so closing on hundreds of loaded items animates
// only the rows anyone can see
const LEAVE_AT_ONCE = { opacity: 0, transition: { duration: 0 } }

/** The account a bank item belongs to, as its row names it and writes its amount */
export type ReviewItemAccount = {
  name: string
  currency: string
}

type BankReviewBlockProps = {
  /** The items loaded so far, newest first, each of an account the caller can name */
  items: BankReviewItem[]

  /** Every item waiting in scope, loaded or not, which the header counts */
  total: number

  /** Set while the items have never loaded, which the block says in place of its count and rows */
  itemsFailure: BankReadFailure | null

  /** Takes the button that reads the items again, which a Needs review marker focuses while they can't load */
  itemsRetryRef: Ref<HTMLButtonElement>
  accountFor: (accountId: string) => ReviewItemAccount

  /** Left out on an account's own page, where every item is that account's */
  showAccountNames: boolean

  /** Today as "YYYY-MM-DD" in the user's profile timezone, which decides whether a date shows its year */
  today: string
  backlogNotice: BacklogNotice | null

  /** Set while the backlogs the notice reads have never loaded */
  backlogFailure: BankReadFailure | null
  expanded: boolean
  onToggleExpanded: () => void

  /** The rows on screen as the block last closed, which collapse while the rest leave at once, or null to collapse every row that leaves */
  rowsInViewAtClose: ReadonlySet<string> | null

  /** Called once every row that was leaving has gone */
  onRowsLeft: () => void

  /** More items wait to load, which happens as the open block's end comes into view */
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

  /** Set while a correction or a removal waits in scope, which bulk approval can apply */
  canBulkApprove: boolean
  onBulkApprove: () => void
  prefersReducedMotion: boolean | null
}

/**
 * The bank items waiting for review above the transaction list: new items, corrections and removals
 * that stay outside the ledger and every balance until the user acts on them
 *
 * Each row opens its item for review. Rows grow in and collapse out with the list's day groups, except that closing the block collapses only
 * the rows on screen. A read that fails is said inside the block, under its title, rather than
 * leaving it empty
 *
 * Bulk approve in the header opens what bulk approval would apply. With no correction or removal in
 * scope, or while the items can't load, it says why it is unavailable, on hover and on focus
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
  canBulkApprove,
  onBulkApprove,
  prefersReducedMotion,
}: BankReviewBlockProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  // Unavailable with nothing it can apply, or while the items can't load, which it says as the block does
  const bulkApproveReason = itemsFailure
    ? `${ITEMS_SUBJECT} could not load.`
    : canBulkApprove
      ? undefined
      : BULK_APPROVE_UNAVAILABLE_REASON
  const titleId = useId()
  const listId = useId()
  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_ITEM_COUNT)
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
      {/* The subtitle shares the header's rows, so on a phone Bulk approve takes a full-width row of its
          own beneath it, leaving the title its line */}
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

        {/* Beside the title from 750px. Its label takes the full text colour, since the muted one falls
            short of AA on the block's tint in the dark theme */}
        <div className="order-last basis-full pb-3 min-[750px]:order-none min-[750px]:ml-auto min-[750px]:basis-auto min-[750px]:pb-0">
          <DisabledReasonButton
            className="app-secondary-button w-full min-[750px]:w-auto"
            style={BULK_APPROVE_LABEL}
            onClick={onBulkApprove}
            disabledReason={bulkApproveReason}
          >
            <ListChecks size={15} aria-hidden />
            Bulk approve
          </DisabledReasonButton>
        </div>

        {/* The caret opens and closes the list, up here so a long list closes from where it starts, not
            from its end, and ends the header's first row like the chevron of the app's other collapsible
            sections. It stays mounted as the list changes, which keeps keyboard focus on it through both.
            It turns over as they do, and its name says what pressing it does */}
        {total > COLLAPSED_ITEM_COUNT && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-label={expanded ? 'Show fewer' : `Show all ${total.toLocaleString()}`}
            onClick={onToggleExpanded}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)] motion-reduce:transition-none min-[750px]:ml-2"
          >
            <ChevronDown size={16} aria-hidden className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
        <p className="basis-full pb-3 pt-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          From your bank, and left out of every balance until you act on them.
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
      <div ref={listRef} id={listId} role="list">
        {/* A leaving row reads which rows were on screen from here rather than from its own props,
            which stop updating once it has left the list */}
        <AnimatePresence initial={false} custom={rowsInViewAtClose} onExitComplete={onRowsLeft}>
          {visibleItems.map((item) => {
            const account = accountFor(item.account_id)
            const amount = getReviewItemAmount(item, account.currency, formatMovedCurrency)
            const details = [
              formatReviewDate(item.bank.date, today),
              showAccountNames && account.name,
              describeReviewItem(item),
            ]

            // The divider sits on the content rather than the row, so it stops short of the card's edges
            const content = (
              <div
                className="flex items-center gap-3 py-2.5"
                style={{ borderTop: '1px solid var(--app-review-divider)' }}
              >
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
                    {details.filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span
                  data-testid="review-item-amount"
                  className="shrink-0 font-financial text-sm font-medium tabular-nums"
                  style={{
                    color: amount.sign > 0 ? 'var(--app-positive)' : 'var(--app-text)',
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
                // never a tab stop, which the row has in its button
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
                {/* A ring rather than a fill, since the warning tint would take the muted line below
                    4.5:1 in the dark theme. It frames the content, halfway into
                    the margin the dividers and text keep from the card's edges, so it touches neither */}
                <span
                  data-testid="review-item-ring"
                  aria-hidden
                  className="pointer-events-none absolute inset-x-2 bottom-0 top-px rounded-lg sm:inset-x-2.5"
                  style={{
                    boxShadow: highlightedId === item.id ? 'inset 0 0 0 2px var(--app-warning-dot)' : 'none',
                    transition: prefersReducedMotion ? undefined : 'box-shadow 0.5s',
                  }}
                />

                {/* Ringed on hover and keyboard focus like the highlight above, so the two read alike,
                    with a ring of its own so neither waits on the other's fade. The hover variant also
                    matches a focused button, so the focus ring is marked important to win over it */}
                <button
                  type="button"
                  onClick={() => onOpenItem(item)}
                  className="group relative block w-full px-4 text-left focus-visible:outline-none sm:px-5"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-2 bottom-0 top-px rounded-lg transition-shadow motion-reduce:transition-none group-hover:ring-1 group-hover:ring-inset group-hover:ring-[var(--app-review-border)] group-focus-visible:ring-2! group-focus-visible:ring-inset group-focus-visible:ring-[var(--app-focus-ring)]! sm:inset-x-2.5"
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
