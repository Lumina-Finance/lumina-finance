import type { FireflyBudgetDraft } from '@/pages/imports/firefly/types'
import { FireflySkippedTable, type FireflySkippedTableRow } from './FireflySkippedTable'

const SKIPPED_BUDGET_HEADERS = [
  'Status',
  'Currencies',
  'Periods',
  'Cadence',
  'First Period',
  'Last Period',
  'Latest Amount',
]

/**
 * Collapsible panel listing the budgets the commit will not import, freezing
 * the budget name and skip reason on the left while the facts read off the
 * export scroll horizontally beside them
 */
export function FireflySkippedBudgetsTable({ drafts }: { drafts: FireflyBudgetDraft[] }) {
  const rows: FireflySkippedTableRow[] = drafts.map((draft) => ({
    key: draft.name,
    lead: draft.name,
    reason: draft.disabledReason ?? '',
    cells: {
      'Status': draft.isArchived ? 'Archived' : 'Active',
      'Currencies': draft.currencyCodes.join(', '),
      'Periods': draft.limits.length > 0 ? String(draft.limits.length) : '',
      'Cadence': draft.periodLabel ?? '',
      'First Period': draft.firstPeriodStart ?? '',
      'Last Period': draft.lastPeriodEnd ?? '',
      'Latest Amount': draft.amount ? `${draft.amount} ${draft.currencyCode}` : '',
    },
  }))

  return (
    <FireflySkippedTable
      title={`${drafts.length} budget${drafts.length === 1 ? '' : 's'} skipped`}
      toggleLabel="skipped budgets"
      leadHeader="Budget"
      leadColumnWidth="10rem"
      leadCellClassName="font-medium"
      headers={SKIPPED_BUDGET_HEADERS}
      rows={rows}
      totalCount={drafts.length}
    />
  )
}
