import { memo, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useBankHolds, useDismissBankHold } from '@/api/bank-sync'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import { BankHoldsStrip } from '@/components/transactions/bank-review/HoldsStrip'
import { REVIEW_MOTION } from '@/components/transactions/constants/bankReview'
import { useBankItemScope } from '@/components/transactions/hooks/useBankItemScope'

type BankHoldsSectionProps = {
  /** The accounts the transaction list is filtered or fixed to, empty or absent when it shows every account */
  listAccountIds: string[] | undefined

  /** Set on an account's own page, where every transaction is that account's, so rows leave its name out */
  isFixedAccount: boolean
  prefersReducedMotion: boolean | null
}

/**
 * The bank's records of no amount in the accounts a transaction list shows, in a strip under the
 * review block and the pending strip
 *
 * Shown only while at least one exists, and closed when it comes back. The bank sync heartbeat reads
 * them again whenever a link changes, so a record the bank drops, or that a sync brings, shows on its
 * own. A read that fails leaves the strip out, as a read that has nothing to show does, and the next
 * heartbeat tries again
 */
export const BankHoldsSection = memo(function BankHoldsSection({
  listAccountIds,
  isFixedAccount,
  prefersReducedMotion,
}: BankHoldsSectionProps) {
  const today = useTodayYmd()
  const { accountIds, isInScope, accountById, accountFor } = useBankItemScope(listAccountIds)
  const { data } = useBankHolds(accountIds, isInScope)
  const dismiss = useDismissBankHold()
  const holds = useMemo(() => (data ?? []).filter((hold) => accountById.has(hold.account_id)), [data, accountById])

  // A strip that leaves, once no hold is left, comes back closed as it first showed
  const [open, setOpen] = useState(false)
  if (open && holds.length === 0) setOpen(false)

  const { collapsed, enterTransition, leave } = REVIEW_MOTION[prefersReducedMotion ? 'reduced' : 'full']

  return (
    <AnimatePresence initial={false}>
      {holds.length > 0 && (
        <motion.div
          key="holds"
          className="overflow-hidden"
          initial={collapsed}
          animate={{ height: 'auto', opacity: 1 }}
          exit={leave}
          transition={enterTransition}
        >
          <div className="pb-3 pt-1">
            <BankHoldsStrip
              holds={holds}
              accountFor={accountFor}
              showAccountNames={!isFixedAccount}
              today={today}
              open={open}
              onToggleOpen={() => setOpen(!open)}
              dismissingId={dismiss.isPending ? (dismiss.variables ?? null) : null}
              onDismiss={(holdId) => dismiss.mutate(holdId)}
              prefersReducedMotion={prefersReducedMotion}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
