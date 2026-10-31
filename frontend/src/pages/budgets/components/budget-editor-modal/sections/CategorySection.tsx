import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Check } from 'lucide-react'
import { FieldError } from '@/components/forms/FieldError'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import type { Category } from '@/api/categories'
import type {
  BudgetEditorModalErrorGetter,
  BudgetEditorModalFieldIds,
  BudgetEditorModalHandlers,
  BudgetEditorModalOptions,
  BudgetEditorModalViewState,
} from '@/pages/budgets/components/budget-editor-modal/types'
import { EASE } from '@/pages/budgets/constants'
import { categoryIcon } from '@/pages/budgets/utils/category'
import { budgetFieldErrorId } from '@/pages/budgets/utils/form'

interface BudgetEditorModalCategorySectionProps {
  state: BudgetEditorModalViewState
  options: BudgetEditorModalOptions
  ids: BudgetEditorModalFieldIds
  emptyMessage: string
  animateOptions: boolean

  // The section's number, which follows the sections ahead of it in the dialog
  number?: string

  // Locks category search and selection while the budget is archived so tracked categories cannot change
  fieldsLocked: boolean
  showError: BudgetEditorModalErrorGetter
  handlers: BudgetEditorModalHandlers
}

/**
 * Renders searchable tracked-category selection and category validation feedback
 */
export default function BudgetEditorModalCategorySection({
  state,
  options,
  ids,
  emptyMessage,
  animateOptions,
  number = '03',
  fieldsLocked,
  showError,
  handlers,
}: BudgetEditorModalCategorySectionProps) {
  const { form, categorySearch } = state
  const { categories, filteredCategories } = options
  const categoryIdsError = showError('categoryIds')
  const shouldReduceMotion = useReducedMotion() ?? false
  const errorId = budgetFieldErrorId(ids.categorySearch)
  // False from the moment a message shows until it has finished leaving
  const [messageGone, setMessageGone] = useState(!categoryIdsError)
  const [shownError, setShownError] = useState(categoryIdsError)
  if (categoryIdsError !== shownError) {
    setShownError(categoryIdsError)
    if (categoryIdsError) setMessageGone(false)
  }

  const categoryOptions = filteredCategories.map((category) => (
    <BudgetCategoryOption
      key={category.id}
      category={category}
      selected={form.categoryIds.includes(category.id)}
      animateOptions={animateOptions}
      disabled={fieldsLocked}
      onToggle={handlers.onCategoryToggle}
    />
  ))

  return (
    <div className="flex min-h-0 min-[1050px]:overflow-hidden">
      <div className="grid min-h-0 flex-1 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3 min-[1050px]:overflow-hidden">
        <div className="flex min-h-0 flex-col items-center">
          <span
            className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none"
            style={{ color: 'var(--app-accent)' }}
            aria-hidden
          >
            {number}
          </span>
          <span className="mt-1 w-px flex-1" style={{ backgroundColor: 'var(--app-border-strong)' }} aria-hidden />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex min-h-4 items-start justify-between gap-4">
            <p
              className="shrink-0 whitespace-nowrap text-base font-bold leading-none"
              style={{ color: 'var(--app-accent)' }}
            >
              Tracked categories
            </p>
            {/* The problem takes the count's place on the heading row, so it sits opposite the label like
                every other field's and fits on one line, the count being zero whenever it shows */}
            {/* The message stays mounted so it fades in and out like every other field's, and the count
                waits until it has left so the two never squeeze each other */}
            <FieldError
              message={categoryIdsError}
              id={errorId}
              className="min-w-0 shrink"
              collapse
              onExitComplete={() => setMessageGone(true)}
            />
            {!categoryIdsError && messageGone && (
              <motion.span
                className="shrink-0 text-sm leading-none"
                style={{ color: 'var(--app-text-subtle)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
              >
                {form.categoryIds.length} selected
              </motion.span>
            )}
          </div>

          <div className="mt-4 flex min-h-0 flex-col min-[1050px]:flex-1">
            <p className="min-w-0 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              Pick the categories this budget should track.
            </p>
            <GlassSearchField
              inputId={ids.categorySearch}
              value={categorySearch}
              onValueChange={handlers.onCategorySearchChange}
              placeholder="Search categories..."
              wrapperClassName="mt-3"
              disabled={fieldsLocked}
              invalid={Boolean(categoryIdsError)}
              describedBy={categoryIdsError ? errorId : undefined}
            />
            <div className="relative mb-1 mt-3 min-h-0 min-[1050px]:flex-1">
              <motion.div
                className="app-selection-list m-0 min-[1050px]:absolute min-[1050px]:inset-0 min-[1050px]:max-h-none"
                style={
                  categoryIdsError
                    ? { borderColor: 'var(--app-negative-border)', background: 'var(--app-negative-soft)' }
                    : undefined
                }
                layout={animateOptions && !shouldReduceMotion}
              >
                {categoryOptions}
                {categories.length > 0 && filteredCategories.length === 0 && (
                  <p className="px-3 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                    No matching categories.
                  </p>
                )}
              </motion.div>
            </div>
            {categories.length === 0 && (
              <p className="mt-3 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                {emptyMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Renders one selectable category row with optional layout animation while editing
 */
function BudgetCategoryOption({
  category,
  selected,
  animateOptions,
  disabled,
  onToggle,
}: {
  category: Category
  selected: boolean
  animateOptions: boolean
  disabled: boolean
  onToggle: (categoryId: string) => void
}) {
  const OptionComponent = animateOptions ? motion.button : 'button'
  // Tints under the pointer like a Transactions filter option row. A chosen row already wears its look,
  // and a disabled one must not suggest it can be pressed
  const stateClassName = selected
    ? 'app-selection-option-active'
    : disabled
      ? ''
      : 'hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)]'

  return (
    <OptionComponent
      {...(animateOptions ? { layout: true, transition: { layout: { duration: 0.22, ease: EASE } } } : {})}
      type="button"
      className={`app-selection-option grid-cols-[1.25rem_1.25rem_minmax(0,1fr)] ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${stateClassName}`}
      onClick={() => onToggle(category.id)}
      disabled={disabled}
    >
      <span className={`app-selection-check ${selected ? 'app-selection-check-active' : ''}`}>
        <Check size={13} strokeWidth={3} aria-hidden />
      </span>
      <span className="h-5 w-5 text-center text-base leading-5" aria-hidden>
        {categoryIcon(category)}
      </span>
      <span className="truncate">{category.name}</span>
    </OptionComponent>
  )
}
