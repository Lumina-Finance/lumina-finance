import type { ReactNode } from 'react'
import { EyeOff } from 'lucide-react'
import { Checkbox } from '@/components/forms/Checkbox'
import { IMPORT_EXCLUDED_ROW_BACKGROUND } from '@/pages/imports/constants'

/**
 * One column of the budget selection table after the checkbox and the budget name
 */
export type ImportBudgetColumn<Budget> = {
  header: string

  /** A width class for the column, such as `w-[15%]` */
  widthClassName: string
  align?: 'right'

  /** Muted text for a description, or tabular figures for an amount, a count or a date */
  tone?: 'muted' | 'figure'
  truncate?: boolean
  render: (budget: Budget) => ReactNode
}

export type ImportBudgetSelectionTableProps<Budget extends { name: string; isArchived: boolean }> = {
  /** The budgets the import can create, each with a box to leave it out */
  budgets: Budget[]
  getKey: (budget: Budget) => string
  columns: ImportBudgetColumn<Budget>[]

  /** A width class for the budget name column */
  nameWidthClassName: string

  /** A minimum width class for the table, past which it scrolls sideways */
  minWidthClassName: string

  /** Whether the import creates the budget, or has created it once the import has finished */
  isChecked: (budget: Budget) => boolean

  /** Selection drives what the import creates, so it locks while an import runs and once one has finished */
  selectionLocked: boolean
  onToggle: (key: string) => void
  onSetAll: (keys: string[], selected: boolean) => void
}

/**
 * Lists the budgets an import can create, each with a box to leave it out and a header box for all
 * of them. A budget left out stays in its place, crossed off and tagged, so the list keeps its order
 */
export function ImportBudgetSelectionTable<Budget extends { name: string; isArchived: boolean }>({
  budgets,
  getKey,
  columns,
  nameWidthClassName,
  minWidthClassName,
  isChecked,
  selectionLocked,
  onToggle,
  onSetAll,
}: ImportBudgetSelectionTableProps<Budget>) {
  const allChecked = budgets.length > 0 && budgets.every(isChecked)
  const someChecked = !allChecked && budgets.some(isChecked)

  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${minWidthClassName} table-fixed text-left text-[0.9375rem]`}>
        <colgroup>
          <col className="w-12" />
          <col className={nameWidthClassName} />
          {columns.map((column) => <col key={column.header} className={column.widthClassName} />)}
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="w-12 px-2 py-2.5 font-medium">
              <span className="flex justify-center">
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  disabled={selectionLocked}
                  label={allChecked ? 'Deselect all budgets' : 'Select all budgets'}
                  onChange={() => onSetAll(budgets.map(getKey), !allChecked)}
                />
              </span>
            </th>
            <th className="px-4 py-2.5 font-medium">Budget</th>
            {columns.map((column) => (
              <th key={column.header} className={`px-4 py-2.5 font-medium ${column.align === 'right' ? 'text-right' : ''}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {budgets.map((budget) => {
            const key = getKey(budget)
            const checked = isChecked(budget)
            const strike = checked ? '' : 'line-through'

            return (
              <tr
                key={key}
                style={checked ? undefined : { background: IMPORT_EXCLUDED_ROW_BACKGROUND, color: 'var(--app-text-muted)' }}
              >
                <td className="px-2 py-2.5 align-middle">
                  <span className="flex justify-center">
                    <Checkbox
                      checked={checked}
                      disabled={selectionLocked}
                      label={`Import ${budget.name}`}
                      onChange={() => onToggle(key)}
                    />
                  </span>
                </td>
                <td className="truncate px-4 py-2.5 align-middle font-medium">
                  <span className="inline-flex max-w-full min-w-0 items-center gap-2">
                    <span className={`truncate ${strike}`}>{budget.name}</span>
                    {!checked && (
                      <span className="shrink-0 text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
                        Not imported
                      </span>
                    )}
                    {budget.isArchived && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          background: 'var(--app-surface-soft)',
                          color: 'var(--app-text-muted)',
                          border: '1px solid var(--app-border)',
                        }}
                      >
                        <EyeOff size={11} aria-hidden />
                        Archived
                      </span>
                    )}
                  </span>
                </td>
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={[
                      'px-4 py-2.5 align-middle',
                      column.align === 'right' ? 'text-right' : '',
                      column.tone === 'figure' ? 'font-financial tabular-nums' : '',
                      column.truncate ? 'truncate' : '',
                      strike,
                    ].filter(Boolean).join(' ')}
                    style={column.tone === 'muted' ? { color: 'var(--app-text-muted)' } : undefined}
                  >
                    {column.render(budget)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
