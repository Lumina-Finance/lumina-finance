import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useCreateBaseBudget } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import BudgetFormCadenceSection from '@/budgets/components/budget-form/BudgetFormCadenceSection'
import BudgetFormCategorySection from '@/budgets/components/budget-form/BudgetFormCategorySection'
import BudgetFormFooter from '@/budgets/components/budget-form/BudgetFormFooter'
import BudgetFormScopeSection from '@/budgets/components/budget-form/BudgetFormScopeSection'
import BudgetFormShell, { type BudgetFormShellAppearance } from '@/budgets/components/budget-form/BudgetFormShell'
import type { BudgetFormErrorGetter, BudgetFormFieldIds, BudgetFormHandlers, BudgetFormOptions, BudgetFormViewState } from '@/budgets/components/budget-form/budgetFormTypes'
import { CREATE_BUDGET_MIN_LOADING_MS, MODAL_SURFACE_TRANSITION_MS, MODAL_SURFACE_TRANSITION_SECONDS } from '@/budgets/constants'
import type { BudgetFormFieldErrors, BudgetFormState } from '@/budgets/types'
import { recurrenceAnchorsFromStart } from '@/budgets/utils/budgetPeriods'
import { validateBudgetCreateForm } from '@/budgets/utils/budgetCreateValidation'
import { todayYmd } from '@/budgets/utils/date'
import { currencySymbol, toMinorUnits } from '@/budgets/utils/money'

const CREATE_FIELD_IDS: BudgetFormFieldIds = {
  name: 'budget-name',
  currency: 'budget-currency',
  limit: 'budget-limit',
  interval: 'budget-interval',
  periodStart: 'budget-period-start',
  categoryError: 'categoryIds-error',
}

const CREATE_SHELL_APPEARANCE: BudgetFormShellAppearance = {
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

const CREATE_FOOTER_CLASS_NAME = 'grid shrink-0 grid-cols-2 gap-3 px-6 py-5 sm:flex sm:justify-end sm:px-8'

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
    periodStart: todayYmd(timeZone),
    recurs: true,
  }), [defaultCurrency, timeZone])
  const expenseCategories = useMemo(
    // New budgets are personal-only here, so shared/group categories are excluded.
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
  const state: BudgetFormViewState = { form, formError, fieldErrors, touched, categorySearch }
  const options: BudgetFormOptions = {
    categories: expenseCategories,
    filteredCategories: filteredExpenseCategories,
    currencies,
  }
  const showError: BudgetFormErrorGetter = (field) => touched[field] ? fieldErrors[field] : undefined

  const resetFormState = useCallback(() => {
    setForm(initialForm)
    setFieldErrors({})
    setTouched({})
    setFormError(null)
    setCategorySearch('')
    setCreateInProgress(false)
  }, [initialForm])

  const closeAndReset = useCallback(() => {
    onClose()
    // Wait for the exit animation so fields do not visually reset while the modal fades out.
    window.setTimeout(resetFormState, MODAL_SURFACE_TRANSITION_MS)
  }, [onClose, resetFormState])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAndReset() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeAndReset, open])

  const clearError = (field: keyof BudgetFormFieldErrors) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const setField = <K extends keyof BudgetFormState>(key: K, value: BudgetFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (key === 'name') clearError('name')
    if (key === 'currency') clearError('currency')
    if (key === 'limit') clearError('limit')
    if (key === 'instanceLength') clearError('instanceLength')
    if (key === 'periodStart') clearError('periodStart')
    if (key === 'recurs') clearError('instanceLength')
  }

  const setRecurs = (recurs: boolean) => {
    if (recurs) {
      setField('recurs', true)
      return
    }
    // One-off budgets always use a single generated period.
    setForm((current) => ({ ...current, recurs: false, instanceLength: '1' }))
    clearError('instanceLength')
  }

  const toggleCategory = (categoryId: string) => {
    setForm((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(categoryId)
        ? current.categoryIds.filter((id) => id !== categoryId)
        : [...current.categoryIds, categoryId],
    }))
    clearError('categoryIds')
  }

  const handleBlur = (field: keyof BudgetFormFieldErrors) => {
    setTouched((current) => ({ ...current, [field]: true }))
    const errors = validateBudgetCreateForm(form, currencies, expenseCategories)
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
  }

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
    // Keep successful and failed submissions from flashing too quickly.
    const minimumLoading = new Promise((resolve) => window.setTimeout(resolve, CREATE_BUDGET_MIN_LOADING_MS))

    try {
      const createBudgetFlow = async () => {
        await createBaseBudget.mutateAsync({
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
      }

      await Promise.all([
        createBudgetFlow(),
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

  const handlers: BudgetFormHandlers = {
    onClose: closeAndReset,
    onSubmit: handleSubmit,
    setField,
    onRecursChange: setRecurs,
    onCategorySearchChange: setCategorySearch,
    onCategoryToggle: toggleCategory,
    onBlur: handleBlur,
  }

  return (
    <BudgetFormShell
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
        <BudgetFormFooter
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
          <BudgetFormScopeSection
            state={state}
            options={options}
            ids={CREATE_FIELD_IDS}
            selectedCurrencySymbol={currencySymbol(currencies, form.currency)}
            namePlaceholder="e.g. Groceries"
            limitPlaceholder="0.00"
            currencyReadOnly={false}
            currencyTooltip
            limitDisabled={false}
            showError={showError}
            handlers={handlers}
          />

          <BudgetFormCadenceSection
            state={state}
            ids={CREATE_FIELD_IDS}
            periodStartLabel="First period start"
            recurrenceControlsLocked={false}
            showError={showError}
            handlers={handlers}
          />
        </div>

        <BudgetFormCategorySection
          state={state}
          options={options}
          ids={CREATE_FIELD_IDS}
          emptyMessage="Create an expense category before adding a budget."
          animateOptions={false}
          showError={showError}
          handlers={handlers}
        />
      </div>
    </BudgetFormShell>
  )
}
