import { useMemo, useState, type FormEvent } from 'react'
import type { Currency } from '@/api/currency'
import { useCreateTaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import type { TaxPlanFormState } from '@/pages/settings/components/tax-advantaged/types'
import { CREATE_TAX_CATEGORY_MIN_LOADING_MS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import {
  CREATE_CATEGORY_CONTROL_IDS,
  CREATE_CATEGORY_VALIDATED_FIELDS,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'
import {
  currencyOptions,
  toMinorUnits,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'
import { getCreateCategoryProblems } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryFormProblems'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { waitForMilliseconds } from '@/utils/timing'

interface UseCreateTaxAdvantagedCategoryFormParams {
  currencies: Currency[]
  onClose: () => void
  userBaseCurrency?: string
}

/**
 * Owns the create TAC form draft, validation, submit mutation, and loading feedback
 */
export function useCreateTaxAdvantagedCategoryForm({
  currencies,
  onClose,
  userBaseCurrency,
}: UseCreateTaxAdvantagedCategoryFormParams) {
  const createPlan = useCreateTaxAdvantagedCategory()
  const [form, setForm] = useState<TaxPlanFormState>({
    name: '',
    tax_treatment: 'tax_free',
    currency: userBaseCurrency ?? '',
    lifetime_contribution_limit: '',
    accrued_contributions: '',
    counts_internal_transfers: false,
  })
  const [createError, setCreateError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const selectedCurrency = form.currency || userBaseCurrency || ''
  const options = useMemo(() => currencyOptions(currencies), [currencies])
  const isCreating = createPlan.isPending || createInProgress
  const refusal = useRefusedSubmit(
    getCreateCategoryProblems(form, selectedCurrency),
    CREATE_CATEGORY_VALIDATED_FIELDS,
    CREATE_CATEGORY_CONTROL_IDS,
  )

  /**
   * Updates a create-form field and clears the failure of the previous attempt
   */
  function setField<K extends keyof TaxPlanFormState>(key: K, value: TaxPlanFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setCreateError(null)
  }

  /**
   * Validates and submits the create TAC form while preserving minimum loading feedback
   */
  function handleCreatePlan(event: FormEvent) {
    event.preventDefault()
    if (isCreating) return

    if (!refusal.guard()) return

    setCreateInProgress(true)
    const minimumLoading = waitForMilliseconds(CREATE_TAX_CATEGORY_MIN_LOADING_MS)

    void createPlan.mutateAsync(
      {
        name: form.name.trim(),
        tax_treatment: form.tax_treatment,
        currency: selectedCurrency,
        lifetime_contribution_limit: toMinorUnits(form.lifetime_contribution_limit, currencies, selectedCurrency),
        accrued_contributions: toMinorUnits(form.accrued_contributions, currencies, selectedCurrency) ?? 0,
        counts_internal_transfers: form.counts_internal_transfers,
        group_id: null,
      },
    ).then(async () => {
      await minimumLoading
      onClose()
    }).catch(async (error) => {
      await minimumLoading
      setCreateError(error instanceof Error ? error.message : 'Failed to create category.')
      setCreateInProgress(false)
    })
  }

  return {
    blockedReason: refusal.blockedReason,
    createError,
    errors: refusal.errors,
    form,
    handleCreatePlan,
    isCreating,
    options,
    selectedCurrency,
    setField,
  }
}
