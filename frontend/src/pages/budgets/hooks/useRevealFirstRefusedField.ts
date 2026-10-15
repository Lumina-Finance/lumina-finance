import { useCallback } from 'react'
import { useReducedMotion } from 'motion/react'
import type { BudgetEditorModalFieldIds } from '@/pages/budgets/components/budget-editor-modal/types'
import type { BudgetFormFieldErrors } from '@/pages/budgets/types'

// Each field the editor can refuse, in the order the dialog shows them, with the control that takes focus
// for it. A missing category is fixed from the category list, which its search field leads into
const REFUSABLE_FIELDS: [keyof BudgetFormFieldErrors, keyof BudgetEditorModalFieldIds][] = [
  ['name', 'name'],
  ['currency', 'currency'],
  ['limit', 'limit'],
  ['instanceLength', 'interval'],
  ['periodStart', 'periodStart'],
  ['categoryIds', 'categorySearch'],
]

/**
 * Shows why the budget editor refused a save, since its message can sit below what the dialog's scrolling
 * body shows, most of all on a phone, where the press would otherwise look like it did nothing
 *
 * The first refused field takes focus and is brought to the middle of the body, so the message on the row
 * above it shows too
 */
export function useRevealFirstRefusedField(ids: BudgetEditorModalFieldIds) {
  const shouldReduceMotion = useReducedMotion()

  return useCallback((errors: BudgetFormFieldErrors) => {
    const refused = REFUSABLE_FIELDS.find(([field]) => errors[field])
    if (!refused) return

    // Waits a frame so the messages the refusal shows are on the page before the body scrolls
    window.requestAnimationFrame(() => {
      const control = document.getElementById(ids[refused[1]])
      if (!control) return
      control.focus({ preventScroll: true, focusVisible: true })
      control.scrollIntoView({ behavior: shouldReduceMotion ? 'auto' : 'smooth', block: 'center' })
    })
  }, [ids, shouldReduceMotion])
}
