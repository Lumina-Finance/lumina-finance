import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useAccounts } from '@/api/accounts'
import { useReviewBacklogs, useReviewItems } from '@/api/bank-sync'
import LoadFailure from '@/components/errors/LoadFailure'
import { useAuth } from '@/hooks/useAuth'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import BankReviewBlock, {
  COLLAPSED_ITEM_COUNT,
  type ReviewItemAccount,
} from '@/components/transactions/bank-review/ReviewBlock'
import { useInfiniteScrollTrigger } from '@/components/transactions/hooks/useInfiniteScrollTrigger'
import { useSkipAppendedEnter } from '@/components/transactions/hooks/useSkipAppendedEnter'
import {
  describeBacklogNotice,
  getReviewAccountIds,
  isOwnPersonalAccount,
} from '@/components/transactions/utils/bankReview'

const SECTION_EASE = [0.22, 1, 0.36, 1] as const

// How long a row stays ringed after a Needs review marker went to it
const JUMP_HIGHLIGHT_MS = 1800

// Animation frames a row must hold its place and size for before the block scrolls to it, which is
// how long it takes to be sure the rows growing in above it have stopped
const SETTLED_FRAMES = 2

/**
 * A request from a Needs review marker to go to its item
 */
export interface ReviewFocusRequest {
  itemId: string

  // Changes on every request, so asking for the same item twice still goes to it
  nonce: number
}

interface BankReviewSectionProps {
  /** The accounts the transaction list is filtered or fixed to, empty or absent when it shows every account */
  listAccountIds: string[] | undefined

  /** Set on an account's own page, where every item is that account's, so rows leave its name out */
  isFixedAccount: boolean
  focusRequest: ReviewFocusRequest | null
  prefersReducedMotion: boolean | null
}

/**
 * Calls back once an element has stopped moving and changing size, which it does for a moment while
 * rows grow in above it as the block opens. Returns what cancels the wait
 */
function whenSettled(element: HTMLElement, onSettled: () => void): () => void {
  let frame = 0
  let previous = ''
  let steadyFrames = 0
  const check = () => {
    const box = element.getBoundingClientRect()

    // Measured against the page rather than the window, so a scroll under way doesn't count as moving
    const current = `${box.top + window.scrollY}:${box.height}`
    steadyFrames = current === previous ? steadyFrames + 1 : 0
    previous = current
    if (steadyFrames >= SETTLED_FRAMES) onSettled()
    else frame = window.requestAnimationFrame(check)
  }
  frame = window.requestAnimationFrame(check)
  return () => window.cancelAnimationFrame(frame)
}

/**
 * The bank items waiting for review in the accounts a transaction list shows, read a page at a time,
 * with the notice for any of them paused or close to pausing for its backlog
 *
 * Hidden while nothing in scope waits, and replaced by a failure while the items can't load, so an
 * empty space never reads as nothing waiting. A Needs review marker's request opens the block when its
 * item is past the first few, loads pages until the item is among them, then scrolls to it, focuses
 * it and rings it for a moment. A page that fails to load ends the request where it is
 */
export default function BankReviewSection({
  listAccountIds,
  isFixedAccount,
  focusRequest,
  prefersReducedMotion,
}: BankReviewSectionProps) {
  const { user } = useAuth()
  const { data: accounts } = useAccounts()
  const today = useTodayYmd()

  // Read once the accounts are, since only the user's own personal accounts have items, and each
  // item's amount is written in its account's currency
  const accountIds = accounts && user ? getReviewAccountIds(accounts, user.id, listAccountIds) : []
  const isInScope = accountIds === undefined || accountIds.length > 0
  const {
    data: pages,
    error: itemsError,
    hasNextPage,
    fetchNextPage,
    isFetching,
    isFetchingNextPage,
  } = useReviewItems(accountIds, isInScope)
  const { data: backlogs, error: backlogsError } = useReviewBacklogs(accountIds, isInScope)

  const accountById = useMemo(() => new Map((accounts ?? []).map((account) => [account.id, account])), [accounts])
  const items = useMemo(
    () => (pages?.pages ?? []).flatMap((page) => page.items).filter((item) => accountById.has(item.account_id)),
    [pages, accountById],
  )
  const counts = pages?.pages[0]?.counts
  const total = isInScope && counts ? counts.new + counts.correction + counts.removal : 0

  // The notice names accounts in the order the server lists them, which is the order they were created
  const scopedAccounts = (accounts ?? []).filter((account) =>
    accountIds === undefined ? user !== null && isOwnPersonalAccount(account, user.id) : accountIds.includes(account.id))
  const backlogNotice = backlogs ? describeBacklogNotice(backlogs, scopedAccounts) : null

  const accountFor = useCallback((accountId: string): ReviewItemAccount => {
    const account = accountById.get(accountId)
    if (!account) throw new Error(`Account ${accountId} is not loaded, so its bank items cannot be shown`)
    return { name: account.name, currency: account.currency }
  }, [accountById])

  // A block that empties closes, so it comes back showing only its first items
  const [expanded, setExpanded] = useState(false)
  if (total === 0 && expanded) setExpanded(false)

  // Each marker request is taken up once, and held until its row is on screen
  const [jump, setJump] = useState<ReviewFocusRequest | null>(null)
  const [takenNonce, setTakenNonce] = useState<number | null>(null)
  if (focusRequest && focusRequest.nonce !== takenNonce) {
    setTakenNonce(focusRequest.nonce)
    setJump(focusRequest)
  }
  const jumpIndex = jump ? items.findIndex((item) => item.id === jump.itemId) : -1

  // An item past the first few, or not loaded yet, opens the block, so there is a row to go to
  if (jump && total > 0 && !expanded && (jumpIndex === -1 || jumpIndex >= COLLAPSED_ITEM_COUNT)) setExpanded(true)

  // An item no page holds once every page has loaded was decided elsewhere, leaving nothing to go to
  if (jump && jumpIndex === -1 && pages && !hasNextPage && !isFetching) setJump(null)

  useEffect(() => {
    if (!jump || jumpIndex !== -1 || !hasNextPage || isFetchingNextPage) return
    void fetchNextPage().then((result) => {
      // A page that still fails once its retry has run ends the jump, rather than being asked for
      // again for as long as the page stays open
      if (result.isError) setJump((current) => (current === jump ? null : current))
    })
  }, [jump, jumpIndex, hasNextPage, isFetchingNextPage, fetchNextPage])

  const rows = useRef(new Map<string, HTMLDivElement>())
  const registerRow = useCallback((itemId: string, row: HTMLDivElement | null) => {
    if (row) rows.current.set(itemId, row)
    else rows.current.delete(itemId)
  }, [])
  const [highlight, setHighlight] = useState<ReviewFocusRequest | null>(null)
  const isJumpRowShown = jumpIndex !== -1 && (expanded || jumpIndex < COLLAPSED_ITEM_COUNT)

  useEffect(() => {
    const row = jump && isJumpRowShown ? rows.current.get(jump.itemId) : undefined
    if (!jump || !row) return
    return whenSettled(row, () => {
      row.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' })
      row.focus({ preventScroll: true })
      setHighlight(jump)
      setJump(null)
    })
  }, [jump, isJumpRowShown, prefersReducedMotion])

  useEffect(() => {
    if (!highlight) return
    const timer = window.setTimeout(() => setHighlight(null), JUMP_HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [highlight])

  const { sentinelRef, showPendingFetch } = useInfiniteScrollTrigger({
    hasNextPage,
    isFetchingNextPage,
    disabled: !expanded,
    fetchNextPage: () => { void fetchNextPage() },
  })
  const skipAppendedEnter = useSkipAppendedEnter(isFetchingNextPage)

  const blockTransition = { duration: prefersReducedMotion ? 0 : 0.28, ease: SECTION_EASE }
  const collapsed = prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }

  return (
    <>
      {isInScope && itemsError && !pages && <LoadFailure error={itemsError} subject="Bank items to review" />}
      <AnimatePresence initial={false}>
        {total > 0 && (
          <motion.div
            key="review"
            className="overflow-hidden"
            initial={collapsed}
            animate={{ height: 'auto', opacity: 1 }}
            exit={collapsed}
            transition={blockTransition}
          >
            <div className="pb-3 pt-1">
              <BankReviewBlock
                items={items}
                total={total}
                accountFor={accountFor}
                showAccountNames={!isFixedAccount}
                today={today}
                backlogNotice={backlogNotice}
                backlogError={backlogsError && !backlogs ? backlogsError : null}
                expanded={expanded}
                onToggleExpanded={() => setExpanded((current) => !current)}
                hasMoreItems={hasNextPage}
                isLoadingMore={isFetchingNextPage || Boolean(showPendingFetch)}
                loadMoreSentinelRef={sentinelRef}
                skipEnterAnimation={skipAppendedEnter}
                highlightedId={highlight?.itemId ?? null}
                registerRow={registerRow}
                prefersReducedMotion={prefersReducedMotion}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
