import { Pencil, Upload } from 'lucide-react'
import type { Account } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { formatCurrency } from '@/utils/formatCurrency'
import { InstitutionLogo } from '@/pages/accounts/components/InstitutionLogo'
import { ACCOUNT_KIND_LABEL } from '@/pages/accounts/detail/constants/accountDetail'
import { humanizeAccountType } from '@/pages/accounts/detail/utils/formatAccountType'
import { useAuth } from '@/hooks/useAuth'
import { DATE_FORMATS, formatDate } from '@/utils/date'
import { IdentityFacts } from './Facts'
import { StandardAccountBand } from './StandardBand'
import { TaxAdvantagedCategoryBand } from './TaxAdvantagedBand'

/**
 * Renders account identity, static account facts, and tax-advantaged context
 *
 * @param onImport - Opens an import that files every row into this account. Absent rather than
 *   disabled on an archived or closed account, the way the edit button already is on a closed one,
 *   since the API refuses an import written to either. It is still offered on an account the user
 *   may only read, which the API also refuses, because nothing the account list carries says which
 *   of them those are
 */
export default function AccountIdentityCard({
  account,
  linkedTaxAdvantagedCategory,
  linkedTaxAdvantagedCategoryError,
  onEdit,
  onImport,
}: {
  account: Account
  linkedTaxAdvantagedCategory: TaxAdvantagedCategory | undefined
  linkedTaxAdvantagedCategoryError: unknown
  onEdit: () => void
  onImport: () => void
}) {
  const { user } = useAuth()
  const linkedTaxAdvantagedCategoryId = account.group_id === null ? account.tax_advantaged_category_id : null

  // closed_at is an instant rather than a calendar day, so it is read in the user's own zone
  const closedLabel = account.closed_at
    ? ' · Closed ' + formatDate(new Date(account.closed_at), DATE_FORMATS.monthDayYear, user?.tz)
    : ''
  const identityFacts = [
    { label: 'Kind', value: ACCOUNT_KIND_LABEL[account.account_kind] ?? account.account_kind },
    { label: 'Type', value: humanizeAccountType(account.account_type) },
    { label: 'Currency', value: account.currency },
    {
      label: 'Credit limit',
      value: account.credit_limit === null ? '—' : formatCurrency(account.credit_limit, account.currency),
    },
  ]

  return (
    <section className="app-card relative flex flex-col min-[750px]:min-h-[440px]">
      {!account.closed_at && (
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {!account.is_archived && (
            <button
              type="button"
              aria-label="Import transactions into this account"
              className="app-icon-button"
              onClick={onImport}
            >
              <Upload size={14} aria-hidden />
            </button>
          )}

          <button
            type="button"
            aria-label="Edit account"
            className="app-icon-button"
            onClick={onEdit}
          >
            <Pencil size={14} aria-hidden />
          </button>
        </div>
      )}

      <InstitutionLogo institution={account.institution} variant="detail" />

      <h1 className="mt-4 font-serif text-[1.375rem] font-semibold leading-tight">{account.name}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {account.institution?.name ?? 'No institution'}
        {closedLabel}
      </p>

      <IdentityFacts facts={identityFacts} />

      {linkedTaxAdvantagedCategoryId ? (
        <TaxAdvantagedCategoryBand
          plan={linkedTaxAdvantagedCategory}
          hasError={!!linkedTaxAdvantagedCategoryError}
        />
      ) : (
        <StandardAccountBand />
      )}
    </section>
  )
}
