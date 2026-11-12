import { Pencil } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import type { Account } from '@/api/accounts'
import { useBankConnections } from '@/api/bank-sync'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { InstitutionLogo } from '@/pages/accounts/components/InstitutionLogo'
import { isLinkStillUnread } from '@/pages/accounts/detail/components/bank-link/status'
import { SyncFact } from '@/pages/accounts/detail/components/bank-link/SyncFact'
import { SyncNowIconButton } from '@/pages/accounts/detail/components/bank-link/SyncNowIconButton'
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
  const { status, statusError, providers, shown: showsBankSync, syncLabel, ownPersonal } = useAccountBankLink(account)
  const linkedTaxAdvantagedCategoryId = account.group_id === null ? account.tax_advantaged_category_id : null

  // A live link offers Sync now beside its label. Its connection owns the request budget a sync spends
  const link = status?.link ?? null
  const { data: connections } = useBankConnections({ enabled: link !== null })
  const linkConnection = connections?.find((connection) => connection.id === link?.connection_id)

  // An account with no institution of its own names the bank it is linked to once its link is read. While
  // that read could still decide the line, it waits for it rather than naming no institution and then a
  // bank. Where bank sync isn't offered, or the read fails, the line names no linked bank
  const linkUnread = isLinkStillUnread(ownPersonal, providers, status, statusError !== null)
  const institutionName =
    account.institution?.name ?? status?.link?.institution_name ?? (linkUnread ? '' : 'No institution')

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
        {/* A way into the edit modal's Bank link section. Everything about the link is managed there */}
        <AnimatePresence initial={false}>
          {showsBankSync && (
            <SyncFact
              key="bank-sync"
              name="Bank sync"
              sync={syncLabel}
              onOpen={onOpenBankSync}
              fades
              action={link && <SyncNowIconButton link={link} connection={linkConnection} providers={providers} />}
            />
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
