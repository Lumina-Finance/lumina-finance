import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedPlan } from '@/api/taxAdvantagedPlans'
import { formatCurrency } from '@/utils/formatCurrency'
import AccountRow from '@/accounts/components/AccountRow'
import type { AccountAccent } from '@/accounts/types/accounts'

const ACCOUNT_ROW_EASE = [0.25, 0.1, 0.25, 1] as const

export default function AccountListSection({
  title,
  accent,
  accounts,
  subtotal,
  emptyLabel,
  displayCurrency,
  taxAdvantagedPlanById,
  showCreditLimit = false,
}: {
  title: string
  accent: AccountAccent
  accounts: AccountsOverview[]
  subtotal: number
  emptyLabel: string
  displayCurrency: string
  taxAdvantagedPlanById: Map<string, TaxAdvantagedPlan>
  showCreditLimit?: boolean
}) {
  const prefersReducedMotion = useReducedMotion()
  const titleColor = accent === 'positive' ? 'var(--app-positive)' : 'var(--app-negative)'
  const subtotalColor = accent === 'positive'
    ? subtotal >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
    : subtotal < 0 ? 'var(--app-negative)' : 'var(--app-text)'

  return (
    <section>
      <div className="mb-2 flex items-center gap-4">
        <h3 className="shrink-0 font-serif text-2xl font-semibold" style={{ color: titleColor }}>
          {title}
        </h3>
        <div
          className="h-px flex-1"
          style={{
            background:
              'linear-gradient(to right, var(--app-border-strong), var(--app-border), transparent)',
          }}
        />
        <span
          className="font-financial shrink-0 text-xl font-semibold"
          style={{ color: subtotalColor }}
        >
          {formatCurrency(subtotal, displayCurrency)}
        </span>
      </div>

      <div className="relative min-h-[4.625rem]">
        <AnimatePresence initial={false}>
          {accounts.length === 0 && (
            <motion.p
              key="empty"
              className="pointer-events-none absolute inset-x-0 top-0 flex overflow-hidden text-center text-sm italic"
              style={{ color: 'var(--app-text-subtle)' }}
              initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 74 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: ACCOUNT_ROW_EASE }}
            >
              <span className="m-auto">{emptyLabel}</span>
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {accounts.map((account) => (
            <motion.div
              key={account.id}
              className="overflow-hidden"
              initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: ACCOUNT_ROW_EASE }}
            >
              <AccountRow
                account={account}
                accent={accent}
                showCreditLimit={showCreditLimit}
                displayCurrency={displayCurrency}
                taxAdvantagedPlanById={taxAdvantagedPlanById}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}
