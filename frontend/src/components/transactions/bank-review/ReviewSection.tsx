import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useAccounts } from '@/api/accounts'
import { useReviewBacklogs, useReviewItems } from '@/api/bank-sync'
import LoadFailure from '@/components/errors/LoadFailure'
import { useAuth } from '@/hooks/useAuth'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import BankReviewBlock, { type ReviewItemAccount } from '@/components/transactions/bank-review/ReviewBlock'
import { useInfiniteScrollTrigger } from '@/components/transactions/hooks/useInfiniteScrollTrigger'
import { useSkipAppendedEnter } from '@/components/transactions/hooks/useSkipAppendedEnter'
import {
  describeBacklogNotice,
  getReviewAccountIds,
  isOwnPersonalAccount,
} from '@/components/transactions/utils/bankReview'

const SECTION_EASE = [0.22, 1, 0.36, 1] as const

interface BankReviewSectionProps {
  /** The accounts the transaction list is filtered or fixed to, empty or absent when it shows every account */
  listAccountIds: string[] | undefined

  /** Set on an account's own page, where every item is that account's, so rows leave its name out */
  isFixedAccount: boolean
  prefersReducedMotion: boolean | null
}

/**
 * The bank items waiting for review in the accounts a transaction list shows, read a page at a time,
 * with the notice for any of them paused or close to pausing for its backlog
 *
 * Hidden while nothing in scope waits, and replaced by a failure while the items can't load, so an
 * empty space never reads as nothing waiting
 */
export default function BankReviewSection({ listAccountIds, isFixedAccount, prefersReducedMotion }: BankReviewSectionProps) {
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

  // The notice names accounts in the order the accounts list shows them
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
                prefersReducedMotion={prefersReducedMotion}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
