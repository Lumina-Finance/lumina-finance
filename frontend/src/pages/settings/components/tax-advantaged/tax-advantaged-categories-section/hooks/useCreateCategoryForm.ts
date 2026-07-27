import { useMemo, useState, type FormEvent } from 'react'
import type { Currency } from '@/api/currency'
import { useCreateTaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import type { TaxPlanFormState } from '@/pages/settings/components/tax-advantaged/types'
import { CREATE_TAX_CATEGORY_MIN_LOADING_MS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import {
  currencyOptions,
  isValidMoneyInput,
  toMinorUnits,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'
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
  })
  const [createError, setCreateError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const selectedCurrency = form.currency || userBaseCurrency || ''
  const options = useMemo(() => currencyOptions(currencies), [currencies])
  const isCreating = createPlan.isPending || createInProgress

  /**
   * Updates a create-form field and clears validation tied to the previous value
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

    const validationError = validateCreateCategoryForm(form, selectedCurrency)
    if (validationError) {
      setCreateError(validationError)
      return
    }

    setCreateInProgress(true)
    const minimumLoading = waitForMilliseconds(CREATE_TAX_CATEGORY_MIN_LOADING_MS)

    void createPlan.mutateAsync(
      {
        name: form.name.trim(),
        tax_treatment: form.tax_treatment,
        currency: selectedCurrency,
        lifetime_contribution_limit: toMinorUnits(form.lifetime_contribution_limit, currencies, selectedCurrency),
        accrued_contributions: toMinorUnits(form.accrued_contributions, currencies, selectedCurrency) ?? 0,
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
    createError,
    form,
    handleCreatePlan,
    isCreating,
    options,
    selectedCurrency,
    setField,
  }
}

/**
 * Validates required create TAC fields before values are converted to minor units
 */
function validateCreateCategoryForm(form: TaxPlanFormState, selectedCurrency: string) {
  if (!form.name.trim()) {
    return 'Name is required.'
  }
  if (!selectedCurrency) {
    return 'Currency is required.'
  }
  if (!isValidMoneyInput(form.lifetime_contribution_limit)) {
    return 'Lifetime contribution limit must be zero or higher.'
  }
  if (!isValidMoneyInput(form.accrued_contributions)) {
    return 'Accrued contributions must be zero or higher.'
  }

  return null
}
