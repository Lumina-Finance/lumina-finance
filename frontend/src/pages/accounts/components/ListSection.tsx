import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import AccountRow from '@/pages/accounts/components/Row'
import type { AccountAccent } from '@/pages/accounts/types/accounts'

const ACCOUNT_ROW_EASE = [0.25, 0.1, 0.25, 1] as const

/**
 * Renders one account section with loading, empty-state, and row transition behaviour
 */
export default function AccountListSection({
  title,
  accent,
  accounts,
  subtotal,
  emptyLabel,
  displayCurrency,
  taxAdvantagedCategoryById,
  showCreditLimit = false,
  loading = false,
}: {
  title: string
  accent: AccountAccent
  accounts: AccountsOverview[]
  subtotal: number
  emptyLabel: string
  displayCurrency: string
  taxAdvantagedCategoryById: Map<string, TaxAdvantagedCategory>
  showCreditLimit?: boolean
  loading?: boolean
}) {
  const prefersReducedMotion = useReducedMotion()
  const { formatCurrency } = useMoneyFormatters()
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
          className="font-financial flex min-h-7 min-w-24 shrink-0 items-center justify-end text-xl font-semibold"
          style={{ color: loading ? 'var(--app-text)' : subtotalColor }}
        >
          {loading ? (
            <span className="app-spinner" aria-label={`Loading ${title.toLowerCase()} total`} />
          ) : (
            formatCurrency(subtotal, displayCurrency)
          )}
        </span>
      </div>

      <div className="relative min-h-[4.625rem] overflow-hidden rounded-lg">
        <AnimatePresence initial={false}>
          {loading && (
            <motion.div
              key="loading"
              className="absolute inset-0 flex items-center justify-center"
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: ACCOUNT_ROW_EASE }}
            >
              <div className="app-spinner" aria-label={`Loading ${title.toLowerCase()} accounts`} />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {!loading && accounts.length === 0 && (
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
          {!loading && accounts.map((account) => (
            <motion.div
              key={account.id}
              layout={prefersReducedMotion ? false : 'position'}
              // Without this motion re-measures every row on any re-render, so a change in page
              // coordinates that has nothing to do with the list moves them: opening a modal below
              // the fullscreen breakpoint pins the body at its scroll offset, which shifts every
              // row's page position without moving it on screen, and the rows slide it back. The
              // array is rebuilt whenever the account data, the filters or the search change, which
              // covers every moment a row can be added, removed, reordered, or grow a line and push
              // the rows below it down
              layoutDependency={accounts}
              className="overflow-hidden"
              initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{
                duration: prefersReducedMotion ? 0 : 0.22,
                ease: ACCOUNT_ROW_EASE,
                layout: { duration: prefersReducedMotion ? 0 : 0.22, ease: ACCOUNT_ROW_EASE },
              }}
            >
              <AccountRow
                account={account}
                accent={accent}
                showCreditLimit={showCreditLimit}
                taxAdvantagedCategoryById={taxAdvantagedCategoryById}
                displayCurrency={displayCurrency}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}
