import { useState } from 'react'
import type { Currency } from '@/api/currency'
import {
  useDeleteTaxAdvantagedCategory,
  useUpdateTaxAdvantagedCategory,
  type TaxAdvantagedCategory,
} from '@/api/taxAdvantagedCategories'
import type { TaxPlanFormState } from '@/settings/components/tax-advantaged/taxAdvantagedTypes'
import { DELETE_TAX_CATEGORY_MIN_LOADING_MS } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryConstants'
import {
  delay,
  fromMinorUnits,
  isValidMoneyInput,
  toMinorUnits,
} from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryUtils'

interface UseTaxAdvantagedCategoryDetailsFormParams {
  currencies: Currency[]
  onClose: () => void
  plan: TaxAdvantagedCategory
}

/**
 * Owns TAC details form draft state, validation, save feedback, and category deletion
 */
export function useTaxAdvantagedCategoryDetailsForm({
  currencies,
  onClose,
  plan,
}: UseTaxAdvantagedCategoryDetailsFormParams) {
  const updatePlan = useUpdateTaxAdvantagedCategory(plan.id)
  const deletePlan = useDeleteTaxAdvantagedCategory({ minimumPendingMs: DELETE_TAX_CATEGORY_MIN_LOADING_MS })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planSaveStatus, setPlanSaveStatus] = useState<'idle' | 'loading' | 'success'>('idle')
  const planBase: TaxPlanFormState = {
    name: plan.name,
    tax_treatment: plan.tax_treatment,
    currency: plan.currency,
    lifetime_contribution_limit: fromMinorUnits(plan.lifetime_contribution_limit, currencies, plan.currency),
    accrued_contributions: fromMinorUnits(plan.accrued_contributions, currencies, plan.currency),
  }
  const [planOverrides, setPlanOverrides] = useState<Partial<TaxPlanFormState>>({})
  const planForm: TaxPlanFormState = { ...planBase, ...planOverrides }

  function setPlanField<K extends keyof TaxPlanFormState>(key: K, value: TaxPlanFormState[K]) {
    setPlanOverrides((current) => ({ ...current, [key]: value }))
    setPlanError(null)
  }

  function openDetails() {
    if (planSaveStatus !== 'idle') return false
    setPlanOverrides({})
    setPlanError(null)
    setDetailsOpen(true)

    return true
  }

  function closeDetails() {
    if (updatePlan.isPending || planSaveStatus !== 'idle') return
    setDetailsOpen(false)
    setPlanOverrides({})
    setPlanError(null)
  }

  async function saveDetails() {
    if (updatePlan.isPending || planSaveStatus !== 'idle') return
    const validationError = validatePlanForm(planForm)
    if (validationError) {
      setPlanError(validationError)
      return
    }

    const { dirty, nextAccruedContributions, nextLifetimeLimit } = getPlanUpdateState(planForm, currencies, plan)
    setPlanSaveStatus('loading')
    const minimumLoading = delay(1000)
    try {
      if (dirty) {
        await updatePlan.mutateAsync({
          name: planForm.name.trim(),
          tax_treatment: planForm.tax_treatment,
          lifetime_contribution_limit: nextLifetimeLimit,
          accrued_contributions: nextAccruedContributions,
        })
        setPlanOverrides({})
        setPlanError(null)
      }
      await minimumLoading
      setPlanSaveStatus('success')
      await delay(600)
      setDetailsOpen(false)
      setPlanSaveStatus('idle')
    } catch (error) {
      await minimumLoading
      setPlanSaveStatus('idle')
      setPlanError(error instanceof Error ? error.message : 'Failed to update category.')
    }
  }

  function deleteCategory() {
    setPlanError(null)
    deletePlan.mutate(plan.id, {
      onSuccess: onClose,
      onError: (error) => {
        setConfirmingDelete(false)
        setPlanError(error instanceof Error ? error.message : 'Failed to delete category.')
      },
    })
  }

  return {
    closeDetails,
    confirmingDelete,
    deleteCategory,
    deletePending: deletePlan.isPending,
    detailsOpen,
    openDetails,
    planError,
    planForm,
    planSaveStatus,
    saveDetails,
    setConfirmingDelete,
    setPlanField,
    updatePending: updatePlan.isPending,
  }
}

/**
 * Compares the draft against the persisted category using backend minor-unit values
 */
function getPlanUpdateState(
  form: TaxPlanFormState,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
) {
  const nextLifetimeLimit = toMinorUnits(form.lifetime_contribution_limit, currencies, plan.currency)
  const nextAccruedContributions = toMinorUnits(form.accrued_contributions, currencies, plan.currency) ?? 0
  const dirty = form.name.trim() !== plan.name
    || form.tax_treatment !== plan.tax_treatment
    || nextLifetimeLimit !== plan.lifetime_contribution_limit
    || nextAccruedContributions !== plan.accrued_contributions

  return { dirty, nextAccruedContributions, nextLifetimeLimit }
}

/**
 * Validates TAC details before sending values that the backend stores as minor units
 */
function validatePlanForm(form: TaxPlanFormState) {
  if (!form.name.trim()) {
    return 'Name is required.'
  }
  if (!isValidMoneyInput(form.lifetime_contribution_limit)) {
    return 'Lifetime limit must be zero or higher.'
  }
  if (!isValidMoneyInput(form.accrued_contributions)) {
    return 'Opening usage must be zero or higher.'
  }

  return null
}
