import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useUpdateBaseBudget, useUpdateBudget, type BaseBudget, type Budget } from '@/api/budgets'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import BudgetFormCadenceSection from '@/budgets/components/budget-form/BudgetFormCadenceSection'
import BudgetFormCategorySection from '@/budgets/components/budget-form/BudgetFormCategorySection'
import BudgetFormFooter from '@/budgets/components/budget-form/BudgetFormFooter'
import BudgetFormScopeSection from '@/budgets/components/budget-form/BudgetFormScopeSection'
import BudgetFormShell, { type BudgetFormShellAppearance } from '@/budgets/components/budget-form/BudgetFormShell'
import type { BudgetFormErrorGetter, BudgetFormFieldIds, BudgetFormHandlers, BudgetFormOptions, BudgetFormViewState } from '@/budgets/components/budget-form/budgetFormTypes'
import type { BudgetFormFieldErrors, BudgetFormState } from '@/budgets/types'
import { budgetCadenceLabel, formatBudgetPeriod } from '@/budgets/utils/budgetPeriods'
import { sameStringSet } from '@/budgets/utils/form'
import { currencySymbol, formatMinorUnitsInput, toMinorUnits } from '@/budgets/utils/money'

const EDIT_FIELD_IDS: BudgetFormFieldIds = {
  name: 'budget-edit-name',
  currency: 'budget-edit-currency',
  limit: 'budget-edit-limit',
  interval: 'budget-edit-interval',
  periodStart: 'budget-edit-period-start',
  categoryError: 'budget-edit-category-error',
}

const EDIT_SHELL_APPEARANCE: BudgetFormShellAppearance = {
  backdropClassName: 'fixed inset-0 z-[100]',
  backdropStyle: { background: 'rgba(0, 0, 0, 0.22)', backdropFilter: 'blur(6px)' },
  backdropDuration: 0.15,
  stageClassName: 'fixed inset-0 z-[100] flex items-center justify-center p-4',
  panelClassName: 'app-modal-panel flex max-h-[84vh] w-full max-w-5xl overflow-hidden rounded-2xl',
  surfaceInitial: { opacity: 0, scale: 0.94, y: 16 },
  surfaceExit: { opacity: 0, scale: 0.94, y: 16 },
  surfaceDuration: 0.22,
  sideRailClassName: 'app-secondary-modal-rail hidden w-12 shrink-0 flex-col items-center justify-between py-5 sm:flex',
  sideRailStyle: {
    background: 'var(--app-surface-soft)',
    borderRight: '1px solid var(--app-border)',
    color: 'var(--app-accent)',
  },
  sideRailIconSize: 18,
  sideLabelClassName: 'rotate-180 text-[0.6875rem] font-semibold uppercase',
  headerClassName: 'shrink-0 px-6 pb-5 pt-6 sm:px-7',
  bodyClassName: 'min-h-0 flex-1 overflow-y-auto px-6 pb-3 pt-4 sm:px-7',
}

const EDIT_FOOTER_CLASS_NAME = 'flex shrink-0 flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:justify-end sm:px-7'

const EDIT_INITIAL_TOUCHED = {
  name: false,
  limit: false,
  categoryIds: false,
}

function getInitialEditForm(baseBudget: BaseBudget, latestPeriod: Budget | undefined, currencies: Currency[]): BudgetFormState {
  return {
    name: baseBudget.name,
    currency: baseBudget.currency,
    categoryIds: baseBudget.category_ids,
    limit: latestPeriod ? formatMinorUnitsInput(latestPeriod.overall_limit, currencies, baseBudget.currency) : '',
    recurrenceFreq: baseBudget.recurrence_freq,
    instanceLength: String(baseBudget.instance_length),
    periodStart: latestPeriod?.period_start ?? '',
    recurs: baseBudget.recurs,
  }
}

export default function BudgetEditModal({
  open,
  baseBudget,
  latestPeriod,
  categories,
  currencies,
  onClose,
  onSaved,
}: {
  open: boolean
  baseBudget: BaseBudget
  latestPeriod: Budget | undefined
  categories: Category[]
  currencies: Currency[]
  onClose: () => void
  onSaved: () => void
}) {
  const updateBaseBudget = useUpdateBaseBudget()
  const updateBudget = useUpdateBudget()
  const initialForm = useMemo(
    () => getInitialEditForm(baseBudget, latestPeriod, currencies),
    [baseBudget, currencies, latestPeriod],
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<BudgetFormFieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>(EDIT_INITIAL_TOUCHED)
  const [saveInProgress, setSaveInProgress] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [form, setForm] = useState<BudgetFormState>(initialForm)
  const categoryOptions = useMemo(
    // Preserve the budget's ownership scope: shared budgets can only use group
    // categories; personal budgets can only use personal categories.
    () => categories.filter((category) => (
      category.kind === 'expense'
      && (baseBudget.group_id ? category.group_id === baseBudget.group_id : category.group_id === null)
    )),
    [baseBudget.group_id, categories],
  )
  const filteredCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase()
    const selectedCategoryIds = new Set(form.categoryIds)
    // Keep selected categories at the top while editing so they remain visible
    // after search text changes or the category list rerenders.
    return categoryOptions
      .filter((category) => !query || category.name.toLowerCase().includes(query))
      .sort((a, b) => {
        const aSelected = selectedCategoryIds.has(a.id)
        const bSelected = selectedCategoryIds.has(b.id)
        if (aSelected !== bSelected) return aSelected ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [categoryOptions, categorySearch, form.categoryIds])
  const isPending = updateBaseBudget.isPending || updateBudget.isPending || saveInProgress
  const limitMinorUnits = latestPeriod ? toMinorUnits(form.limit, currencies, baseBudget.currency) : null
  const hasCategory = form.categoryIds.some((categoryId) =>
    categoryOptions.some((category) => category.id === categoryId),
  )
  const baseChanged =
    form.name.trim() !== baseBudget.name
    || form.recurs !== baseBudget.recurs
    || !sameStringSet(form.categoryIds, baseBudget.category_ids)
  const periodChanged = Boolean(latestPeriod && limitMinorUnits !== null && limitMinorUnits !== latestPeriod.overall_limit)
  const canSave =
    !isPending
    && form.name.trim().length > 0
    && hasCategory
    && (!latestPeriod || limitMinorUnits !== null)
    && (baseChanged || periodChanged)
  const state: BudgetFormViewState = { form, formError, fieldErrors, touched, categorySearch }
  const options: BudgetFormOptions = { categories: categoryOptions, filteredCategories, currencies }
  const showError: BudgetFormErrorGetter = (field) => touched[field] ? fieldErrors[field] : undefined
  const resetEditState = useCallback(() => {
    setForm(initialForm)
    setFieldErrors({})
    setTouched(EDIT_INITIAL_TOUCHED)
    setFormError(null)
    setCategorySearch('')
    setSaveInProgress(false)
  }, [initialForm])
  const closeAndReset = useCallback(() => {
    onClose()
    resetEditState()
  }, [onClose, resetEditState])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndReset()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeAndReset, open])

  const validateEditForm = () => {
    const errors: BudgetFormFieldErrors = {}
    if (!form.name.trim()) errors.name = 'Name is required'
    if (!hasCategory) errors.categoryIds = 'Select at least one category'
    if (latestPeriod && limitMinorUnits === null) errors.limit = 'Limit must be greater than zero'
    return errors
  }

  const clearError = (field: keyof BudgetFormFieldErrors) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const setField = <K extends keyof BudgetFormState>(field: K, value: BudgetFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'name') clearError('name')
    if (field === 'limit') clearError('limit')
  }

  const handleBlur = (field: keyof BudgetFormFieldErrors) => {
    setTouched((current) => ({ ...current, [field]: true }))
    const errors = validateEditForm()
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const errors = validateEditForm()
    setFieldErrors(errors)
    setTouched({ name: true, limit: true, categoryIds: true })
    if (Object.keys(errors).length > 0) {
      return
    }

    // Base-budget fields and current-period fields are persisted through different endpoints.
    const basePatch: {
      name?: string
      recurs?: boolean
      category_ids?: string[]
    } = {}
    if (form.name.trim() !== baseBudget.name) basePatch.name = form.name.trim()
    if (form.recurs !== baseBudget.recurs) basePatch.recurs = form.recurs
    if (!sameStringSet(form.categoryIds, baseBudget.category_ids)) basePatch.category_ids = form.categoryIds

    setSaveInProgress(true)

    try {
      const saveChanges = async () => {
        if (Object.keys(basePatch).length > 0) {
          await updateBaseBudget.mutateAsync({ id: baseBudget.id, patch: basePatch })
        }
        if (latestPeriod && limitMinorUnits !== null && limitMinorUnits !== latestPeriod.overall_limit) {
          await updateBudget.mutateAsync({ id: latestPeriod.id, patch: { overall_limit: limitMinorUnits } })
        }
      }

      await Promise.all([
        saveChanges(),
        // Match the existing save-button feedback timing.
        new Promise((resolve) => window.setTimeout(resolve, 1000)),
      ])
      closeAndReset()
      onSaved()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save budget.')
      setSaveInProgress(false)
    }
  }

  const handlers: BudgetFormHandlers = {
    onClose: closeAndReset,
    onSubmit: handleSubmit,
    setField,
    onRecursChange: (recurs) => setField('recurs', recurs),
    onCategorySearchChange: setCategorySearch,
    onCategoryToggle: toggleCategory,
    onBlur: handleBlur,
  }

  return (
    <BudgetFormShell
      open={open}
      title="Edit Budget"
      titleId="budget-edit-title"
      eyebrow={form.recurs ? 'Recurring budget' : 'One-off budget'}
      sideLabel="Edit"
      formError={formError}
      warning="Changes apply from now forward. Past periods stay unchanged. To back propagate changes, create a new budget instead."
      appearance={EDIT_SHELL_APPEARANCE}
      onClose={closeAndReset}
      onSubmit={handleSubmit}
      footer={(
        <BudgetFormFooter
          className={EDIT_FOOTER_CLASS_NAME}
          isPending={isPending}
          submitDisabled={!canSave}
          submitLabel="Save Changes"
          onClose={closeAndReset}
        />
      )}
    >
      <div className="grid min-h-0 items-stretch gap-7 min-[1050px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-h-0 flex-col gap-5">
          <BudgetFormScopeSection
            state={state}
            options={options}
            ids={EDIT_FIELD_IDS}
            selectedCurrencySymbol={currencySymbol(currencies, form.currency)}
            limitPlaceholder={latestPeriod ? '0.00' : 'No period yet'}
            currencyReadOnly
            currencyTooltip={false}
            limitDisabled={!latestPeriod}
            showError={showError}
            handlers={handlers}
          />

          <BudgetFormCadenceSection
            state={state}
            ids={EDIT_FIELD_IDS}
            periodStartLabel="Period start"
            cadenceSummaryText={`${budgetCadenceLabel(baseBudget)}${latestPeriod ? ` · ${formatBudgetPeriod(latestPeriod)}` : ''}`}
            recurrenceControlsLocked
            showError={showError}
            handlers={handlers}
          />
        </div>

        <BudgetFormCategorySection
          state={state}
          options={options}
          ids={EDIT_FIELD_IDS}
          emptyMessage="Create an expense category before editing this budget."
          animateOptions
          showError={showError}
          handlers={handlers}
        />
      </div>
    </BudgetFormShell>
  )
}
