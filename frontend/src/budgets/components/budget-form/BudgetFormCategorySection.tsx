import { AnimatePresence, motion } from 'motion/react'
import { Check, Search } from 'lucide-react'
import type { Category } from '@/api/categories'
import type { BudgetFormErrorGetter, BudgetFormFieldIds, BudgetFormHandlers, BudgetFormOptions, BudgetFormViewState } from '@/budgets/components/budget-form/budgetFormTypes'
import { EASE } from '@/budgets/constants'
import { categoryIcon } from '@/budgets/utils/category'

interface BudgetFormCategorySectionProps {
  state: BudgetFormViewState
  options: BudgetFormOptions
  ids: BudgetFormFieldIds
  emptyMessage: string
  animateOptions: boolean
  showError: BudgetFormErrorGetter
  handlers: BudgetFormHandlers
}

export default function BudgetFormCategorySection({
  state,
  options,
  ids,
  emptyMessage,
  animateOptions,
  showError,
  handlers,
}: BudgetFormCategorySectionProps) {
  const { form, categorySearch } = state
  const { categories, filteredCategories } = options
  const categoryIdsError = showError('categoryIds')

  const categoryOptions = filteredCategories.map((category) => (
    <BudgetCategoryOption
      key={category.id}
      category={category}
      selected={form.categoryIds.includes(category.id)}
      animateOptions={animateOptions}
      onToggle={handlers.onCategoryToggle}
    />
  ))

  return (
    <div className="flex min-h-0 min-[1050px]:overflow-hidden">
      <div className="grid min-h-0 flex-1 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3 min-[1050px]:overflow-hidden">
        <div className="flex min-h-0 flex-col items-center">
          <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
            03
          </span>
          <span
            className="mt-1 w-px flex-1"
            style={{ backgroundColor: 'var(--app-border-strong)' }}
            aria-hidden
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-4 items-center justify-between gap-4">
            <p className="text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Tracked categories</p>
            <span className="shrink-0 text-sm leading-none" style={{ color: 'var(--app-text-subtle)' }}>
              {form.categoryIds.length} selected
            </span>
          </div>

          <div className="mt-4 flex min-h-0 flex-col min-[1050px]:flex-1">
            <div className="flex items-start">
              <div className="min-w-0 flex-1">
                <AnimatePresence initial={false}>
                  {categoryIdsError && (
                    <motion.div
                      key={ids.categoryError}
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: EASE }}
                    >
                      <p className="mb-1.5 text-xs font-medium leading-5" style={{ color: 'var(--app-negative)' }}>
                        {categoryIdsError}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  Pick the categories this budget should track.
                </p>
              </div>
            </div>
            <div className="relative mt-3">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
              <input
                className="app-input pl-9"
                value={categorySearch}
                onChange={(event) => handlers.onCategorySearchChange(event.target.value)}
                placeholder="Search categories..."
              />
            </div>
            <div className="relative mb-1 mt-3 min-h-0 min-[1050px]:flex-1">
              <motion.div
                className="app-selection-list m-0 min-[1050px]:absolute min-[1050px]:inset-0 min-[1050px]:max-h-none"
                style={categoryIdsError ? { borderColor: 'var(--app-negative-border)', background: 'var(--app-negative-soft)' } : undefined}
                layout={animateOptions}
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

function BudgetCategoryOption({
  category,
  selected,
  animateOptions,
  onToggle,
}: {
  category: Category
  selected: boolean
  animateOptions: boolean
  onToggle: (categoryId: string) => void
}) {
  const OptionComponent = animateOptions ? motion.button : 'button'

  return (
    <OptionComponent
      {...(animateOptions ? { layout: true, transition: { layout: { duration: 0.22, ease: EASE } } } : {})}
      type="button"
      className={`app-selection-option grid-cols-[1.25rem_1.25rem_minmax(0,1fr)] ${selected ? 'app-selection-option-active' : ''}`}
      onClick={() => onToggle(category.id)}
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
