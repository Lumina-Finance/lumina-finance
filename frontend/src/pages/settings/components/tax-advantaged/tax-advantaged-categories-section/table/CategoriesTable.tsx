import { useTaxAdvantagedCategoryLimits, type TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import {
  formatLimitYears,
  formatTaxTreatment,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'

export default function TaxAdvantagedCategoriesTable({
  currentYear,
  linkedAccountCounts,
  onSelect,
  plans,
}: {
  currentYear: number
  linkedAccountCounts: Map<string, number>
  onSelect: (categoryId: string) => void
  plans: TaxAdvantagedCategory[]
}) {
  return (
    <div className="min-w-0">
      <table className="block w-full text-left text-[0.9375rem] min-[750px]:table min-[750px]:table-fixed">
        <colgroup className="hidden min-[750px]:table-column-group">
          <col style={{ width: '34%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '27%' }} />
          <col style={{ width: '15%' }} />
        </colgroup>
        <thead className="hidden min-[750px]:table-header-group">
          <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
            <th className="app-label px-4 py-3">Category</th>
            <th className="app-label py-3 pr-4">Current year</th>
            <th className="app-label py-3 pr-4">Limit years</th>
            <th className="app-label py-3 pr-4 text-right">Accounts</th>
          </tr>
        </thead>
        <tbody className="block space-y-2 min-[750px]:table-row-group min-[750px]:space-y-0">
          {plans.map((plan, index) => (
            <TaxAdvantagedCategoryRow
              key={plan.id}
              accountCount={linkedAccountCounts.get(plan.id) ?? 0}
              currentYear={currentYear}
              isLast={index === plans.length - 1}
              onSelect={onSelect}
              plan={plan}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TaxAdvantagedCategoryRow({
  accountCount,
  currentYear,
  isLast,
  onSelect,
  plan,
}: {
  accountCount: number
  currentYear: number
  isLast: boolean
  onSelect: (categoryId: string) => void
  plan: TaxAdvantagedCategory
}) {
  const { data: limits = [], isLoading } = useTaxAdvantagedCategoryLimits(plan.id)
  const hasCurrentYearLimit = limits.some((limit) => limit.year === currentYear)
  const limitYearsLabel = formatLimitYears(limits.map((limit) => limit.year))
  const statusLabel = isLoading
    ? 'Loading'
    : hasCurrentYearLimit
      ? `${currentYear} configured`
      : `Missing ${currentYear}`
  const statusStyle = isLoading
    ? { background: 'var(--app-input-bg)', color: 'var(--app-text-muted)' }
    : hasCurrentYearLimit
      ? { background: 'var(--app-positive-soft)', color: 'var(--app-positive)' }
      : { background: 'var(--app-negative-soft)', color: 'var(--app-negative)' }

  return (
    <tr
      className={`block cursor-pointer rounded-xl border p-3 transition-colors duration-150 hover:bg-[var(--app-accent-soft)] min-[750px]:table-row min-[750px]:rounded-none min-[750px]:border-x-0 min-[750px]:border-t-0 min-[750px]:p-0 ${isLast ? 'min-[750px]:border-b-0' : 'min-[750px]:border-b'}`}
      style={{ borderColor: 'var(--app-border)' }}
      tabIndex={0}
      onClick={() => onSelect(plan.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(plan.id)
        }
      }}
    >
      <td className="block min-w-0 px-0 py-0 min-[750px]:table-cell min-[750px]:px-4 min-[750px]:py-4">
        <div className="flex items-start justify-between gap-3 min-[750px]:hidden">
          <span className="min-w-0">
            <span className="block truncate font-serif text-xl font-medium tracking-tight">{plan.name}</span>
            <span className="mt-0.5 block truncate text-sm" style={{ color: 'var(--app-text-muted)' }}>
              {formatTaxTreatment(plan.tax_treatment)} · {plan.currency}
            </span>
          </span>
          <span
            className="mt-1 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
            style={statusStyle}
          >
            {statusLabel}
          </span>
        </div>
        <div className="hidden min-[750px]:block">
          <span className="block truncate font-serif text-xl font-medium tracking-tight">{plan.name}</span>
          <span className="mt-0.5 block truncate text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {formatTaxTreatment(plan.tax_treatment)} · {plan.currency}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 min-[750px]:hidden">
          <span className="min-w-0">
            <span className="app-label mb-1 block">Limit years</span>
            <span
              className="block truncate text-sm"
              style={limitYearsLabel === 'None' ? { color: 'var(--app-text-muted)' } : undefined}
            >
              {isLoading ? 'Loading' : limitYearsLabel}
            </span>
          </span>
          <span className="min-w-0 text-right">
            <span className="app-label mb-1 block">Accounts</span>
            <span className="block truncate text-sm">
              <span className="font-medium">{accountCount}</span>
              <span className="ml-1" style={{ color: 'var(--app-text-muted)' }}>
                linked
              </span>
            </span>
          </span>
        </div>
      </td>
      <td className="hidden py-4 pr-4 font-medium min-[750px]:table-cell">
        {isLoading ? (
          <span style={{ color: 'var(--app-text-muted)' }}>Loading</span>
        ) : hasCurrentYearLimit ? (
          <span>{currentYear} configured</span>
        ) : (
          <span style={{ color: 'var(--app-negative)' }}>Missing {currentYear}</span>
        )}
      </td>
      <td className="hidden py-4 pr-4 min-[750px]:table-cell">
        <span style={limitYearsLabel === 'None' ? { color: 'var(--app-text-muted)' } : undefined}>
          {isLoading ? 'Loading' : limitYearsLabel}
        </span>
      </td>
      <td className="hidden py-4 pr-4 text-right min-[750px]:table-cell">
        <span className="font-medium">{accountCount}</span>
        <span className="ml-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
          linked
        </span>
      </td>
    </tr>
  )
}

