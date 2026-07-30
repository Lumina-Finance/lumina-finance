import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useCreateBaseBudget } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import BudgetEditorModalCadenceSection from '@/pages/budgets/components/budget-editor-modal/sections/CadenceSection'
import BudgetEditorModalCategorySection from '@/pages/budgets/components/budget-editor-modal/sections/CategorySection'
import BudgetEditorModalFooter from '@/pages/budgets/components/budget-editor-modal/layout/Footer'
import BudgetEditorModalScopeSection from '@/pages/budgets/components/budget-editor-modal/sections/ScopeSection'
import BudgetEditorModalShell, { type BudgetEditorModalShellAppearance } from '@/pages/budgets/components/budget-editor-modal/layout/Shell'
import type { BudgetEditorModalErrorGetter, BudgetEditorModalFieldIds, BudgetEditorModalHandlers, BudgetEditorModalOptions, BudgetEditorModalViewState } from '@/pages/budgets/components/budget-editor-modal/types'
import { CREATE_BUDGET_MIN_LOADING_MS, MODAL_SURFACE_TRANSITION_MS, MODAL_SURFACE_TRANSITION_SECONDS } from '@/pages/budgets/constants'
import type { BudgetFormFieldErrors, BudgetFormState } from '@/pages/budgets/types'
import { recurrenceAnchorsFromStart } from '@/pages/budgets/utils/budgetPeriods'
import { validateBudgetCreateForm } from '@/pages/budgets/utils/budgetCreateValidation'
import { getTodayYmd } from '@/utils/date'
import { currencySymbol, toMinorUnits } from '@/pages/budgets/utils/money'
import { waitForMilliseconds } from '@/utils/timing'

const CREATE_FIELD_IDS: BudgetEditorModalFieldIds = {
  name: 'budget-name',
  currency: 'budget-currency',
  limit: 'budget-limit',
  interval: 'budget-interval',
  periodStart: 'budget-period-start',
  categorySearch: 'budget-category-search',
  categoryError: 'categoryIds-error',
}

const CREATE_SHELL_APPEARANCE: BudgetEditorModalShellAppearance = {
  backdropClassName: 'fixed inset-0 z-50',
  backdropStyle: { background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' },
  backdropDuration: 0.2,
  stageClassName: 'fixed inset-0 z-50 flex items-center justify-center p-4',
  panelClassName: 'app-modal-panel flex max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-2xl',
  surfaceInitial: { opacity: 0, scale: 0.96, y: 12 },
  surfaceExit: { opacity: 0, scale: 0.96, y: 12 },
  surfaceDuration: MODAL_SURFACE_TRANSITION_SECONDS,
  sideRailClassName: 'hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex',
  sideRailStyle: {
    background: 'var(--app-button-primary-bg)',
    color: 'var(--app-button-primary-text)',
  },
  sideRailIconSize: 20,
  sideLabelClassName: 'rotate-180 text-xs font-semibold uppercase',
  headerClassName: 'shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8',
  bodyClassName: 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-8',
}

const CREATE_FOOTER_CLASS_NAME = 'grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-8 min-[1050px]:py-5'

/**
 * Manages create-budget form state, validation, and submission through the shared editor modal shell
 */
export default function BudgetCreateModal({
  open,
  categories,
  currencies,
  defaultCurrency,
  timeZone,
  onClose,
  onCreated,
}: {
  open: boolean
  categories: Category[]
  currencies: Currency[]
  defaultCurrency: string
  timeZone: string
  onClose: () => void
  onCreated: () => void
}) {
  const createBaseBudget = useCreateBaseBudget()
  useBodyScrollLock(open)

  const initialForm = useMemo<BudgetFormState>(() => ({
    name: '',
    currency: defaultCurrency,
    categoryIds: [],
    limit: '',
    recurrenceFreq: 'monthly',
    instanceLength: '1',
    periodStart: getTodayYmd(timeZone),
    recurs: true,
  }), [defaultCurrency, timeZone])

  // New budgets are personal-only here, so shared and group categories are excluded
  const expenseCategories = useMemo(
    () => categories.filter((category) => category.kind === 'expense' && category.group_id === null),
    [categories],
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<BudgetFormFieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [categorySearch, setCategorySearch] = useState('')
  const [form, setForm] = useState<BudgetFormState>(initialForm)
  const [createInProgress, setCreateInProgress] = useState(false)

  const isPending = createBaseBudget.isPending || createInProgress
  const filteredExpenseCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase()
    if (!query) return expenseCategories
    return expenseCategories.filter((category) => category.name.toLowerCase().includes(query))
  }, [categorySearch, expenseCategories])
  const limitMinorUnits = toMinorUnits(form.limit, currencies, form.currency)
  const instanceLength = form.recurs ? Number(form.instanceLength) : 1
  const hasSelectedExpenseCategory = form.categoryIds.some((categoryId) =>
    expenseCategories.some((category) => category.id === categoryId),
  )
  const state: BudgetEditorModalViewState = { form, formError, fieldErrors, touched, categorySearch }
  const options: BudgetEditorModalOptions = {
    categories: expenseCategories,
    filteredCategories: filteredExpenseCategories,
    currencies,
  }
  const showError: BudgetEditorModalErrorGetter = (field) => touched[field] ? fieldErrors[field] : undefined

  /**
   * Restores the create form to the latest default currency and local start date
   */
  const resetFormState = useCallback(() => {
    setForm(initialForm)
    setFieldErrors({})
    setTouched({})
    setFormError(null)
    setCategorySearch('')
    setCreateInProgress(false)
  }, [initialForm])

  /**
   * Delays reset until the modal exit animation finishes so fields do not flash
   */
  const closeAndReset = useCallback(() => {
    onClose()
    window.setTimeout(resetFormState, MODAL_SURFACE_TRANSITION_MS)
  }, [onClose, resetFormState])

  useEffect(() => {
    if (!open) return

    /**
     * Closes the modal from global Escape because focus can sit inside nested controls
     */
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndReset()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeAndReset, open])

  /**
   * Clears field and form-level errors after a user changes the related input
   */
  const clearError = (field: keyof BudgetFormFieldErrors) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  /**
   * Updates a form field and clears validation errors tied to that field
   */
  const setField = <K extends keyof BudgetFormState>(key: K, value: BudgetFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (key === 'name') clearError('name')
    if (key === 'currency') clearError('currency')
    if (key === 'limit') clearError('limit')
    if (key === 'instanceLength') clearError('instanceLength')
    if (key === 'periodStart') clearError('periodStart')
    if (key === 'recurs') clearError('instanceLength')
  }

  /**
   * Keeps one-off budgets at a single generated period while preserving recurring settings
   */
  const setRecurs = (recurs: boolean) => {
    if (recurs) {
      setField('recurs', true)
      return
    }
    setForm((current) => ({ ...current, recurs: false, instanceLength: '1' }))
    clearError('instanceLength')
  }

  /**
   * Toggles tracked categories and clears category validation once the user acts
   */
  const toggleCategory = (categoryId: string) => {
    setForm((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(categoryId)
        ? current.categoryIds.filter((id) => id !== categoryId)
        : [...current.categoryIds, categoryId],
    }))
    clearError('categoryIds')
  }

  /**
   * Validates touched fields without surfacing untouched form errors
   */
  const handleBlur = (field: keyof BudgetFormFieldErrors) => {
    setTouched((current) => ({ ...current, [field]: true }))
    const errors = validateBudgetCreateForm(form, currencies, expenseCategories)
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
  }

  /**
   * Validates and submits the create-budget workflow while enforcing minimum button feedback timing
   */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const errors = validateBudgetCreateForm(form, currencies, expenseCategories)
    setFieldErrors(errors)
    setTouched({
      name: true,
      currency: true,
      limit: true,
      instanceLength: true,
      periodStart: true,
      categoryIds: true,
    })
    if (Object.keys(errors).length > 0 || limitMinorUnits === null || !hasSelectedExpenseCategory) {
      return
    }

    setCreateInProgress(true)

    const minimumLoading = waitForMilliseconds(CREATE_BUDGET_MIN_LOADING_MS)

    try {
      const createBudget = createBaseBudget.mutateAsync({
        name: form.name.trim(),
        currency: form.currency,
        recurrence_freq: form.recurrenceFreq,
        instance_length: instanceLength,
        ...recurrenceAnchorsFromStart(form.recurrenceFreq, form.periodStart),
        recurs: form.recurs,
        category_ids: form.categoryIds,
        period_start: form.periodStart,
        overall_limit: limitMinorUnits,
      })

      await Promise.all([
        createBudget,
        minimumLoading,
      ])
      onCreated()
      closeAndReset()
    } catch (error) {
      await minimumLoading
      setFormError(error instanceof Error ? error.message : 'Could not create budget.')
      setCreateInProgress(false)
    }
  }

  const handlers: BudgetEditorModalHandlers = {
    onClose: closeAndReset,
    onSubmit: handleSubmit,
    setField,
    onRecursChange: setRecurs,
    onCategorySearchChange: setCategorySearch,
    onCategoryToggle: toggleCategory,
    onBlur: handleBlur,
  }

  return (
    <BudgetEditorModalShell
      open={open}
      title="Add Budget"
      titleId="budget-create-title"
      eyebrow={form.recurs ? 'Recurring budget' : 'One-off budget'}
      sideLabel="Budget"
      formError={formError}
      appearance={CREATE_SHELL_APPEARANCE}
      onClose={closeAndReset}
      onSubmit={handleSubmit}
      footer={(
        <BudgetEditorModalFooter
          className={CREATE_FOOTER_CLASS_NAME}
          isPending={isPending}
          submitDisabled={isPending}
          submitLabel="Create Budget"
          onClose={closeAndReset}
        />
      )}
    >
      <div className="grid min-h-0 items-stretch gap-7 min-[1050px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-h-0 flex-col gap-5">
          <BudgetEditorModalScopeSection
            state={state}
            options={options}
            ids={CREATE_FIELD_IDS}
            selectedCurrencySymbol={currencySymbol(currencies, form.currency)}
            namePlaceholder="e.g. Groceries"
            currencyReadOnly={false}
            currencyState="ready"
            currencyTooltip
            limitDisabled={false}
            fieldsLocked={false}
            showError={showError}
            handlers={handlers}
          />

          <BudgetEditorModalCadenceSection
            state={state}
            ids={CREATE_FIELD_IDS}
            periodStartLabel="First period start"
            recurrenceControlsLocked={false}
            fieldsLocked={false}
            showError={showError}
            handlers={handlers}
          />
        </div>

        <BudgetEditorModalCategorySection
          state={state}
          options={options}
          ids={CREATE_FIELD_IDS}
          emptyMessage="Create an expense category before adding a budget."
          animateOptions={false}
          fieldsLocked={false}
          showError={showError}
          handlers={handlers}
        />
      </div>
    </BudgetEditorModalShell>
  )
}
