import { FieldError } from '@/components/forms/FieldError'
import type { BudgetEditorFieldLabelRowProps } from '@/pages/budgets/types'
import { budgetFieldErrorId } from '@/pages/budgets/utils/form'

/**
 * Renders a form label with animated inline validation text
 */
export default function BudgetEditorFieldLabelRow({ label, htmlFor, error }: BudgetEditorFieldLabelRowProps) {
  return (
    <div className="mb-1.5 flex min-w-0 items-start justify-between gap-3">
      <label htmlFor={htmlFor} className="app-label block min-w-0 text-[0.9375rem] leading-5">
        {label}
      </label>
      <FieldError message={error} id={htmlFor && budgetFieldErrorId(htmlFor)} className="min-w-0 shrink" />
    </div>
  )
}
