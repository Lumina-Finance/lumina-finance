import { Pencil } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Account } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { InstitutionLogo } from '@/pages/accounts/components/InstitutionLogo'
import { SyncFact } from '@/pages/accounts/detail/components/bank-link/SyncFact'
import { useAccountBankLink } from '@/pages/accounts/detail/components/bank-link/useAccountBankLink'
import { ACCOUNT_KIND_LABEL } from '@/pages/accounts/detail/constants/accountDetail'
import { humanizeAccountType } from '@/utils/formatAccountType'
import { IdentityFacts } from './Facts'
import { IdentityNotes } from './Notes'
import { StandardAccountBand } from './StandardBand'
import { TaxAdvantagedCategoryBand } from './TaxAdvantagedBand'

/**
 * Renders account identity, static account facts, and tax-advantaged context
 */
export default function AccountIdentityCard({
  account,
  linkedTaxAdvantagedCategory,
  linkedTaxAdvantagedCategoryError,
  onEdit,
  onOpenBankSync,
}: {
  account: Account
  linkedTaxAdvantagedCategory: TaxAdvantagedCategory | undefined
  linkedTaxAdvantagedCategoryError: unknown
  onEdit: () => void

  /** Opens the edit modal at its Bank link section */
  onOpenBankSync: () => void
}) {
  const { formatCurrency } = useMoneyFormatters()
  const prefersReducedMotion = useReducedMotion()
  const { ownPersonal, status, statusError, shown: showsBankSync, syncLabel } = useAccountBankLink(account)
  const linkedTaxAdvantagedCategoryId = account.group_id === null ? account.tax_advantaged_category_id : null

  // An account with no institution of its own names the bank it is linked to. Until its link is read,
  // the line stays empty rather than saying it has none
  const linkUnread = ownPersonal && status === undefined && statusError === null
  const institutionName =
    account.institution?.name ?? status?.link?.institution_name ?? (linkUnread ? null : 'No institution')

  const identityFacts = [
    { label: 'Kind', value: ACCOUNT_KIND_LABEL[account.account_kind] ?? account.account_kind },
    { label: 'Type', value: humanizeAccountType(account.account_type) },
    { label: 'Currency', value: account.currency },
    {
      label: 'Credit limit',
      value: account.credit_limit === null ? 'Not set' : formatCurrency(account.credit_limit, account.currency),
    },
  ]

  return (
    <section className="app-card relative flex flex-col min-[750px]:min-h-[440px]">
      <button
        type="button"
        aria-label="Edit account"
        className="app-icon-button absolute right-2 top-2"
        onClick={onEdit}
      >
        <Pencil size={14} aria-hidden />
      </button>

      <InstitutionLogo institution={account.institution} variant="detail" />

      <h1 className="mt-4 font-serif text-[1.375rem] font-semibold leading-tight">{account.name}</h1>
      <p className="mt-1 min-h-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {institutionName}
      </p>

      <IdentityFacts facts={identityFacts}>
        {/* A way into the edit modal's Bank link section, where everything about the link is managed */}
        <AnimatePresence initial={false}>
          {showsBankSync && (
            <motion.div
              key="bank-sync"
              className="col-span-2 min-w-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
            >
              <SyncFact name="Bank sync" sync={syncLabel} onOpen={onOpenBankSync} />
            </motion.div>
          )}
        </AnimatePresence>
      </IdentityFacts>
      {account.notes && <IdentityNotes notes={account.notes} />}

      {linkedTaxAdvantagedCategoryId ? (
        <TaxAdvantagedCategoryBand plan={linkedTaxAdvantagedCategory} hasError={!!linkedTaxAdvantagedCategoryError} />
      ) : (
        <StandardAccountBand />
      )}
    </section>
  )
}
