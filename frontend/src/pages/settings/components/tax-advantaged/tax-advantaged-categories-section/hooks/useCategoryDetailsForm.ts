import { useState } from 'react'
import type { Currency } from '@/api/currency'
import {
  useDeleteTaxAdvantagedCategory,
  useUpdateTaxAdvantagedCategory,
  type TaxAdvantagedCategory,
} from '@/api/tax-advantaged-categories'
import type { TaxPlanFormState } from '@/pages/settings/components/tax-advantaged/types'
import { DELETE_TAX_CATEGORY_MIN_LOADING_MS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import {
  CATEGORY_DETAILS_CONTROL_IDS,
  CATEGORY_DETAILS_VALIDATED_FIELDS,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'
import { getCategoryDetailsProblems } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryFormProblems'
import {
  fromMinorUnits,
  toMinorUnits,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { ACTION_LOADING_MIN_MS, waitForMilliseconds } from '@/utils/timing'

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
    counts_internal_transfers: plan.counts_internal_transfers,
  }
  const [planOverrides, setPlanOverrides] = useState<Partial<TaxPlanFormState>>({})
  const planForm: TaxPlanFormState = { ...planBase, ...planOverrides }
  const refusal = useRefusedSubmit(
    getCategoryDetailsProblems(planForm),
    CATEGORY_DETAILS_VALIDATED_FIELDS,
    CATEGORY_DETAILS_CONTROL_IDS,
  )

  /**
   * Updates a TAC details draft field and clears the failure of the previous attempt
   */
  function setPlanField<K extends keyof TaxPlanFormState>(key: K, value: TaxPlanFormState[K]) {
    setPlanOverrides((current) => ({ ...current, [key]: value }))
    setPlanError(null)
  }

  /**
   * Opens the TAC details editor with a fresh draft from the persisted category
   */
  function openDetails() {
    if (planSaveStatus !== 'idle') return false
    setPlanOverrides({})
    setPlanError(null)
    refusal.reset()
    setDetailsOpen(true)

    return true
  }

  /**
   * Closes the TAC details editor when no save operation is active
   */
  function closeDetails() {
    if (updatePlan.isPending || planSaveStatus !== 'idle') return
    setDetailsOpen(false)
    setPlanOverrides({})
    setPlanError(null)
    refusal.reset()
  }

  /**
   * Saves TAC identity and lifetime contribution room edits once the form has nothing missing or wrong
   */
  async function saveDetails() {
    if (updatePlan.isPending || planSaveStatus !== 'idle' || !refusal.guard()) return

    const { dirty, nextAccruedContributions, nextLifetimeLimit } = getPlanUpdateState(planForm, currencies, plan)
    setPlanSaveStatus('loading')
    const minimumLoading = waitForMilliseconds(ACTION_LOADING_MIN_MS)
    try {
      if (dirty) {
        await updatePlan.mutateAsync({
          name: planForm.name.trim(),
          tax_treatment: planForm.tax_treatment,
          lifetime_contribution_limit: nextLifetimeLimit,
          accrued_contributions: nextAccruedContributions,
          counts_internal_transfers: planForm.counts_internal_transfers,
        })
        setPlanOverrides({})
        setPlanError(null)
      }
      await minimumLoading
      setPlanSaveStatus('success')
      await waitForMilliseconds(600)
      setDetailsOpen(false)
      setPlanSaveStatus('idle')
    } catch (error) {
      await minimumLoading
      setPlanSaveStatus('idle')
      setPlanError(error instanceof Error ? error.message : 'Failed to update category.')
    }
  }

  /**
   * Deletes the TAC after the confirmation button enters its second-click state
   */
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
    detailsBlockedReason: refusal.blockedReason,
    detailsOpen,
    detailsProblems: refusal.errors,
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
    || form.counts_internal_transfers !== plan.counts_internal_transfers

  return { dirty, nextAccruedContributions, nextLifetimeLimit }
}
