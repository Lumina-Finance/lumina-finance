import { useId } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Landmark, PauseCircle, TriangleAlert } from 'lucide-react'
import type { BankReviewItem } from '@/api/bank-sync'
import LoadFailure from '@/components/errors/LoadFailure'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import {
  REVIEW_KIND_LABELS,
  describeReviewItem,
  formatReviewDate,
  getReviewItemAmount,
  type BacklogNotice,
} from '@/components/transactions/utils/bankReview'

// How many items show before the block is opened, so a long backlog doesn't push the ledger away
export const COLLAPSED_ITEM_COUNT = 4

const ROW_EASE = [0.22, 1, 0.36, 1] as const
const ROW_DURATION_S = 0.24

/** The account a review item belongs to, as its row names it and writes its amount */
export type ReviewItemAccount = {
  name: string
  currency: string
}

interface BankReviewBlockProps {
  /** The items loaded so far, newest first, each of an account the caller can name */
  items: BankReviewItem[]

  /** Every item waiting in scope, loaded or not, which the header counts */
  total: number
  accountFor: (accountId: string) => ReviewItemAccount

  /** Left out on an account's own page, where every item is that account's */
  showAccountNames: boolean

  /** Today as "YYYY-MM-DD" in the user's profile timezone, which decides whether a date shows its year */
  today: string
  backlogNotice: BacklogNotice | null

  /** Why the backlogs the notice reads could not load, null when they did */
  backlogError: unknown
  expanded: boolean
  onToggleExpanded: () => void

  /** More items wait to load, which happens as the open block's end comes into view */
  hasMoreItems: boolean
  isLoadingMore: boolean
  loadMoreSentinelRef: (element: HTMLDivElement | null) => void

  /** Makes newly mounted rows appear without growing in, used for a page of items that just loaded */
  skipEnterAnimation: boolean

  /** The item a Needs review marker just went to, ringed for a moment so the eye finds it */
  highlightedId: string | null

  /** Takes each row as it mounts and null as it goes, for scrolling to and focusing an item */
  registerRow: (itemId: string, row: HTMLDivElement | null) => void
  prefersReducedMotion: boolean | null
}

/**
 * The bank items waiting for review above the transaction list: new items, corrections and removals
 * that stay outside the ledger and every balance until the user acts on them
 *
 * A row shows its item and opens nothing, holding its content in a single element under its divider
 */
export default function BankReviewBlock({
  items,
  total,
  accountFor,
  showAccountNames,
  today,
  backlogNotice,
  backlogError,
  expanded,
  onToggleExpanded,
  hasMoreItems,
  isLoadingMore,
  loadMoreSentinelRef,
  skipEnterAnimation,
  highlightedId,
  registerRow,
  prefersReducedMotion,
}: BankReviewBlockProps) {
  const { formatMovedAmount } = useMoneyFormatters()
  const titleId = useId()
  const listId = useId()
  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_ITEM_COUNT)
  const rowTransition = { duration: prefersReducedMotion ? 0 : ROW_DURATION_S, ease: ROW_EASE }
  const collapsedRow = prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }

  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-2xl border border-dashed"
      style={{ borderColor: 'var(--app-review-border)', background: 'var(--app-review-bg)' }}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3.5 sm:px-5">
        <Landmark size={17} strokeWidth={2} aria-hidden className="shrink-0" style={{ color: 'var(--app-warning-text)' }} />
        <h2 id={titleId} className="text-[0.9375rem] font-semibold" style={{ color: 'var(--app-text)' }}>
          Waiting for review
        </h2>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
          style={{ background: 'var(--app-review-count-bg)', color: 'var(--app-review-count-text)' }}
        >
          {total.toLocaleString()}
        </span>
      </div>
      <p className="px-4 pb-3 pt-1 text-xs sm:px-5" style={{ color: 'var(--app-text-muted)' }}>
        From your bank, and left out of every balance until you act on them.
      </p>

      <AnimatePresence initial={false}>
        {backlogNotice && (
          <motion.div
            key="backlog"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={rowTransition}
          >
            <div className="px-4 pb-3 sm:px-5">
              <p
                className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: 'var(--app-warning-soft)', color: 'var(--app-text)' }}
              >
                {backlogNotice.tone === 'paused'
                  ? <PauseCircle size={14} aria-hidden className="mt-px shrink-0" style={{ color: 'var(--app-warning-text)' }} />
                  : <TriangleAlert size={14} aria-hidden className="mt-px shrink-0" style={{ color: 'var(--app-warning-text)' }} />}
                <span>{backlogNotice.text}</span>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {backlogError !== null && (
        <LoadFailure compact error={backlogError} subject="Sync pause status" className="px-4 pb-3 sm:px-5" />
      )}

      {/* One list, so a screen reader counts every loaded item, with each row past the first few
          growing in as the block opens */}
      <div id={listId} role="list">
        <AnimatePresence initial={false}>
          {visibleItems.map((item) => {
            const account = accountFor(item.account_id)
            const amount = getReviewItemAmount(item, account.currency, formatMovedAmount)
            const details = [formatReviewDate(item.bank.date, today), showAccountNames && account.name, describeReviewItem(item)]
            return (
              <motion.div
                key={item.id}
                ref={(row: HTMLDivElement | null) => registerRow(item.id, row)}
                role="listitem"

                // Focusable from a Needs review marker, so a screen reader moves to the item too, but
                // never a tab stop, since the row opens nothing
                tabIndex={-1}
                className="overflow-hidden focus:outline-none"
                initial={skipEnterAnimation ? false : collapsedRow}
                animate={{ height: 'auto', opacity: 1 }}
                exit={collapsedRow}
                transition={rowTransition}
              >
                {/* A ring rather than a fill, since any fill lighter than the block's own would take
                    the muted line below 4.5:1 in the dark theme */}
                <div
                  className="px-4 sm:px-5"
                  style={{
                    boxShadow: highlightedId === item.id ? 'inset 0 0 0 2px var(--app-warning-dot)' : 'none',
                    transition: prefersReducedMotion ? undefined : 'box-shadow 0.5s',
                  }}
                >
                  {/* The divider sits on the content rather than the row, so it stops short of the card's edges */}
                  <div className="flex items-center gap-3 py-2.5" style={{ borderTop: '1px solid var(--app-review-divider)' }}>
                    <div className="min-w-0 flex-1">
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
                      className="shrink-0 font-financial text-sm font-medium tabular-nums"
                      style={{
                        color: amount.sign > 0 ? 'var(--app-positive)' : 'var(--app-text)',
                        textDecoration: amount.isStruckThrough ? 'line-through' : undefined,
                      }}
                    >
                      {amount.text}
                    </span>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {expanded && hasMoreItems && (
        <>
          <div ref={loadMoreSentinelRef} aria-hidden style={{ height: 1 }} />
          {isLoadingMore && (
            <p className="px-4 py-2.5 text-center text-sm sm:px-5" style={{ color: 'var(--app-text-muted)' }}>
              Loading more items…
            </p>
          )}
        </>
      )}

      <AnimatePresence initial={false}>
        {total > COLLAPSED_ITEM_COUNT && (
          <motion.div
            key="toggle"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={rowTransition}
          >
            <div className="mx-4 sm:mx-5" style={{ borderTop: '1px solid var(--app-review-divider)' }} aria-hidden />
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={onToggleExpanded}
              className="w-full px-4 py-2.5 text-center text-sm font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--app-accent)] sm:px-5"
              style={{ color: 'var(--app-warning-text)' }}
            >
              {expanded ? 'Show fewer' : `Show all ${total.toLocaleString()}`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
