import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useCreateBaseBudget } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import BudgetEditorModalCadenceSection from '@/pages/budgets/components/budget-editor-modal/sections/CadenceSection'
import BudgetEditorModalCategorySection from '@/pages/budgets/components/budget-editor-modal/sections/CategorySection'
import BudgetEditorModalFooter from '@/pages/budgets/components/budget-editor-modal/layout/Footer'
import BudgetEditorModalScopeSection from '@/pages/budgets/components/budget-editor-modal/sections/ScopeSection'
import BudgetEditorModalShell from '@/pages/budgets/components/budget-editor-modal/layout/Shell'
import type { BudgetEditorModalErrorGetter, BudgetEditorModalFieldIds, BudgetEditorModalHandlers, BudgetEditorModalOptions, BudgetEditorModalViewState } from '@/pages/budgets/components/budget-editor-modal/types'
import { CREATE_BUDGET_MIN_LOADING_MS, MODAL_SURFACE_TRANSITION_MS } from '@/pages/budgets/constants'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import type { BudgetFormState } from '@/pages/budgets/types'
import { recurrenceAnchorsFromStart } from '@/pages/budgets/utils/budgetPeriods'
import { validateBudgetCreateForm } from '@/pages/budgets/utils/budgetCreateValidation'
import { BUDGET_FORM_FIELD_ORDER, getBudgetControlIds } from '@/pages/budgets/utils/form'
import { getTodayYmd } from '@/utils/date'
import { currencySymbol, toMinorUnits } from '@/pages/budgets/utils/money'
import { waitForMilliseconds } from '@/utils/timing'
import { findCurrencyExponent } from '@/utils/moneyInput'

const CREATE_FIELD_IDS: BudgetEditorModalFieldIds = {
  name: 'budget-name',
  currency: 'budget-currency',
  limit: 'budget-limit',
  interval: 'budget-interval',
  recurrenceType: 'budget-recurrence-type',
  frequency: 'budget-frequency',
  periodStart: 'budget-period-start',
  categorySearch: 'budget-category-search',
}

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
  // The fields the user has changed, so leaving one the dialog only focused, such as Name on opening, never flags it
  const [changed, setChanged] = useState<Record<string, boolean>>({})
  const [categorySearch, setCategorySearch] = useState('')
  const [form, setForm] = useState<BudgetFormState>(initialForm)
  const [createInProgress, setCreateInProgress] = useState(false)
  const refusal = useRefusedSubmit(
    validateBudgetCreateForm(form, currencies, expenseCategories),
    BUDGET_FORM_FIELD_ORDER,
    getBudgetControlIds(CREATE_FIELD_IDS),
  )
  const resetRefusal = refusal.reset

  const isPending = createBaseBudget.isPending || createInProgress
  const filteredExpenseCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase()
    if (!query) return expenseCategories
    return expenseCategories.filter((category) => category.name.toLowerCase().includes(query))
  }, [categorySearch, expenseCategories])
  const limitMinorUnits = toMinorUnits(form.limit, currencies, form.currency)
  const isLimitLocked = findCurrencyExponent(currencies, form.currency) === null
  const instanceLength = form.recurs ? Number(form.instanceLength) : 1
  const state: BudgetEditorModalViewState = { form, categorySearch }
  const options: BudgetEditorModalOptions = {
    categories: expenseCategories,
    filteredCategories: filteredExpenseCategories,
    currencies,
  }
  const showError: BudgetEditorModalErrorGetter = (field) => refusal.errors[field]

  /**
   * Restores the create form to the latest default currency and local start date
   */
  const resetFormState = useCallback(() => {
    setForm(initialForm)
    resetRefusal()
    setChanged({})
    setFormError(null)
    setCategorySearch('')
    setCreateInProgress(false)
  }, [initialForm, resetRefusal])

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
   * Updates a form field and clears the failure of an earlier save, which the change may have fixed
   */
  const setField = <K extends keyof BudgetFormState>(key: K, value: BudgetFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setChanged((current) => ({ ...current, [key]: true }))
    setFormError(null)
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
    setFormError(null)
  }

  /**
   * Toggles tracked categories
   */
  const toggleCategory = (categoryId: string) => {
    setForm((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(categoryId)
        ? current.categoryIds.filter((id) => id !== categoryId)
        : [...current.categoryIds, categoryId],
    }))
    setChanged((current) => ({ ...current, categoryIds: true }))
    setFormError(null)
  }

  /**
   * Validates and submits the create-budget workflow while enforcing minimum button feedback timing
   */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    // A limit that reads as nothing is already a problem the guard refuses, this only narrows its type
    if (!refusal.guard() || limitMinorUnits === null) return

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
    onBlur: (field) => {
      if (changed[field]) refusal.touch(field)
    },
  }

  return (
    <BudgetEditorModalShell
      open={open}
      title="Add budget"
      titleId="budget-create-title"
      eyebrow={form.recurs ? 'Recurring budget' : 'One-off budget'}
      sideLabel="Budget"
      formError={formError}
      level="page"
      onClose={closeAndReset}
      onSubmit={handleSubmit}
      footer={(
        <BudgetEditorModalFooter
          level="page"
          isPending={isPending}
          submitDisabled={isPending}
          submitDisabledReason={refusal.blockedReason}
          submitLabel="Create budget"
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
            isLimitLocked={isLimitLocked}
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
