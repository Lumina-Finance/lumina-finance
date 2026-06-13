import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { Currency } from '@/api/currency'
import {
  useCreateTaxAdvantagedCategoryLimit,
  useDeleteTaxAdvantagedCategoryLimit,
  useTaxAdvantagedCategoryLimits,
  useUpdateTaxAdvantagedCategoryLimit,
  type TaxAdvantagedCategory,
  type TaxAdvantagedCategoryLimit,
} from '@/api/taxAdvantagedCategories'
import type {
  AutosaveNotice,
  TaxPlanLimitDraftField,
  TaxPlanLimitDraftState,
  TaxPlanLimitFormState,
} from '@/settings/components/tax-advantaged/taxAdvantagedTypes'
import {
  DEFAULT_NEW_LIMIT_YEAR,
  LIMIT_DELETE_FEEDBACK_MS,
  LIMIT_SAVE_FEEDBACK_MS,
  MAX_VISIBLE_LIMIT_ROWS,
} from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryConstants'
import {
  delay,
  fromMinorUnits,
  isValidMoneyInput,
  nextAvailableLimitYear,
  toMinorUnits,
} from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryUtils'

interface UseTaxAdvantagedLimitWorkflowParams {
  currencies: Currency[]
  limitDeleteButtonRef: RefObject<HTMLButtonElement | null>
  plan: TaxAdvantagedCategory
  showAutosaveNotice: (notice: AutosaveNotice) => void
}

/**
 * Owns annual TAC limit draft state, validation, autosave feedback, and limit mutations
 */
export function useTaxAdvantagedLimitWorkflow({
  currencies,
  limitDeleteButtonRef,
  plan,
  showAutosaveNotice,
}: UseTaxAdvantagedLimitWorkflowParams) {
  const { data: limits = [], isLoading: limitsLoading } = useTaxAdvantagedCategoryLimits(plan.id)
  const createLimit = useCreateTaxAdvantagedCategoryLimit()
  const updateLimit = useUpdateTaxAdvantagedCategoryLimit()
  const deleteLimit = useDeleteTaxAdvantagedCategoryLimit()
  const [showAddTaxYear, setShowAddTaxYear] = useState(false)
  const [selectedLimitYear, setSelectedLimitYear] = useState<number | null>(null)
  const [limitDrafts, setLimitDrafts] = useState<Record<number, Partial<TaxPlanLimitDraftState>>>({})
  const [newLimitForm, setNewLimitForm] = useState<TaxPlanLimitFormState>({
    year: String(DEFAULT_NEW_LIMIT_YEAR),
    contribution_limit: '',
    withdrawal_limit: '',
    accrued_contributions: '',
    accrued_withdrawals: '',
  })
  const [pendingCreateLimitYear, setPendingCreateLimitYear] = useState<number | null>(null)
  const [deleteConfirmYear, setDeleteConfirmYear] = useState<number | null>(null)
  const [pendingDeleteLimitYear, setPendingDeleteLimitYear] = useState<number | null>(null)
  const [pendingDeletedLimit, setPendingDeletedLimit] = useState<TaxAdvantagedCategoryLimit | null>(null)
  const [limitError, setLimitError] = useState<string | null>(null)
  const sortedLimits = useMemo(() => {
    const nextLimits = limits.filter((limit) => limit.year !== pendingCreateLimitYear)
    if (pendingDeletedLimit && !nextLimits.some((limit) => limit.year === pendingDeletedLimit.year)) {
      nextLimits.push(pendingDeletedLimit)
    }

    return nextLimits.sort((a, b) => b.year - a.year)
  }, [limits, pendingCreateLimitYear, pendingDeletedLimit])
  const hasScrollableLimitRows = sortedLimits.length > MAX_VISIBLE_LIMIT_ROWS
  const creatingLimit = pendingCreateLimitYear !== null || createLimit.isPending
  const hasLifetimePriorActivity = plan.accrued_contributions > 0
  const selectedLimit = showAddTaxYear
    ? null
    : selectedLimitYear === null
      ? null
      : sortedLimits.find((limit) => limit.year === selectedLimitYear) ?? null
  const selectedDraft = selectedLimit ? getLimitDraft(
    selectedLimit.year,
    limits,
    pendingDeletedLimit,
    limitDrafts,
    currencies,
    plan,
  ) : null
  const selectedSavingLimit = selectedLimit !== null
    && updateLimit.isPending
    && updateLimit.variables?.year === selectedLimit.year
  const selectedLimitDirty = selectedLimit ? isLimitDirty(
    selectedLimit.year,
    limits,
    pendingDeletedLimit,
    limitDrafts,
    currencies,
    plan,
  ) : false
  const selectedLimitDeleteConfirming = selectedLimit !== null && deleteConfirmYear === selectedLimit.year
  const selectedLimitDeleting = selectedLimit !== null && pendingDeleteLimitYear === selectedLimit.year

  useEffect(() => {
    if (deleteConfirmYear === null || pendingDeleteLimitYear !== null) return
    const onPointerDown = (event: PointerEvent) => {
      if (limitDeleteButtonRef.current && !limitDeleteButtonRef.current.contains(event.target as Node)) {
        setDeleteConfirmYear(null)
      }
    }
    const timer = window.setTimeout(() => window.addEventListener('pointerdown', onPointerDown), 0)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [deleteConfirmYear, limitDeleteButtonRef, pendingDeleteLimitYear])

  /**
   * Updates the add-year draft while clearing validation feedback tied to the old value
   */
  function setNewLimitField<K extends keyof TaxPlanLimitFormState>(key: K, value: TaxPlanLimitFormState[K]) {
    setNewLimitForm((current) => ({ ...current, [key]: value }))
    setLimitError(null)
  }

  /**
   * Starts a new annual limit using the next available tax year as the initial value
   */
  function startNewLimitForm() {
    setNewLimitForm(createEmptyLimitForm(nextAvailableLimitYear(limits)))
    setShowAddTaxYear(true)
    setSelectedLimitYear(null)
    setLimitError(null)
  }

  /**
   * Updates a selected annual limit draft and exits delete confirmation mode
   */
  function setLimitField(year: number, key: TaxPlanLimitDraftField, value: string) {
    setLimitDrafts((current) => ({
      ...current,
      [year]: {
        ...current[year],
        [key]: value,
      },
    }))
    setLimitError(null)
    setDeleteConfirmYear(null)
  }

  /**
   * Selects an existing annual limit row and closes the add-year editor
   */
  function selectLimitYear(year: number) {
    setSelectedLimitYear(year)
    setShowAddTaxYear(false)
    setDeleteConfirmYear(null)
  }

  /**
   * Closes the annual limit editor and discards the selected row's unsaved draft
   */
  function closeLimitDetailsModal() {
    if (creatingLimit || updateLimit.isPending) return
    if (selectedLimitYear !== null) {
      setLimitDrafts((current) => {
        if (!(selectedLimitYear in current)) return current
        const next = { ...current }
        delete next[selectedLimitYear]

        return next
      })
    }
    setShowAddTaxYear(false)
    setSelectedLimitYear(null)
    setLimitError(null)
    setDeleteConfirmYear(null)
  }

  /**
   * Clears any open annual limit editor before another TAC modal workflow opens
   */
  function resetLimitSelection() {
    setShowAddTaxYear(false)
    setSelectedLimitYear(null)
    setDeleteConfirmYear(null)
  }

  /**
   * Validates and saves an existing annual limit draft
   */
  function saveLimit(year: number) {
    if (!isLimitDirty(year, limits, pendingDeletedLimit, limitDrafts, currencies, plan) || updateLimit.isPending) return
    const draft = getLimitDraft(year, limits, pendingDeletedLimit, limitDrafts, currencies, plan)
    const validationError = validateExistingLimitDraft(year, draft)
    if (validationError) {
      setLimitError(validationError)
      showAutosaveNotice({ status: 'error', message: validationError })
      return
    }

    showAutosaveNotice({ status: 'saving', message: 'Saving limits...' })
    updateLimit.mutate(
      {
        categoryId: plan.id,
        year,
        contribution_limit: toMinorUnits(draft.contribution_limit, currencies, plan.currency) ?? 0,
        withdrawal_limit: toMinorUnits(draft.withdrawal_limit, currencies, plan.currency),
        accrued_contributions: toMinorUnits(draft.accrued_contributions, currencies, plan.currency) ?? 0,
        accrued_withdrawals: toMinorUnits(draft.accrued_withdrawals, currencies, plan.currency) ?? 0,
      },
      {
        onSuccess: () => {
          setLimitDrafts((current) => {
            const next = { ...current }
            delete next[year]

            return next
          })
          setLimitError(null)
          setDeleteConfirmYear(null)
          setSelectedLimitYear(null)
          showAutosaveNotice({ status: 'saved', message: 'Limits saved.' })
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : `Failed to save ${year} limits.`
          setLimitError(message)
          showAutosaveNotice({ status: 'error', message })
        },
      },
    )
  }

  /**
   * Validates and creates a new annual limit while preserving feedback timing
   */
  async function createNewLimit() {
    if (!showAddTaxYear || createLimit.isPending || pendingCreateLimitYear !== null) return
    const year = Number.parseInt(newLimitForm.year, 10)
    const validationError = validateNewLimitForm(newLimitForm, limits, year)
    if (validationError) {
      setLimitError(validationError)
      showAutosaveNotice({ status: 'error', message: validationError })
      return
    }

    setPendingCreateLimitYear(year)
    showAutosaveNotice({ status: 'saving', message: 'Saving limits...' })
    const minimumFeedback = delay(LIMIT_SAVE_FEEDBACK_MS)

    let createError: unknown = null
    try {
      const createdLimit = await createLimit.mutateAsync({
        categoryId: plan.id,
        year,
        contribution_limit: toMinorUnits(newLimitForm.contribution_limit, currencies, plan.currency) ?? 0,
        withdrawal_limit: toMinorUnits(newLimitForm.withdrawal_limit, currencies, plan.currency),
        accrued_contributions: toMinorUnits(newLimitForm.accrued_contributions, currencies, plan.currency) ?? 0,
        accrued_withdrawals: toMinorUnits(newLimitForm.accrued_withdrawals, currencies, plan.currency) ?? 0,
      })
      setSelectedLimitYear(createdLimit.year)
    } catch (error) {
      createError = error
    }

    await minimumFeedback
    setPendingCreateLimitYear(null)

    if (createError) {
      const message = createError instanceof Error ? createError.message : 'Failed to add tax-year limits.'
      setLimitError(message)
      showAutosaveNotice({ status: 'error', message })
      return
    }

    setNewLimitForm(createEmptyLimitForm(nextAvailableLimitYear(limits)))
    setShowAddTaxYear(false)
    setLimitError(null)
    showAutosaveNotice({ status: 'saved', message: 'Limits saved.' })
  }

  /**
   * Confirms and deletes an annual limit while keeping the row visible during feedback
   */
  async function deleteSelectedLimit(limit: TaxAdvantagedCategoryLimit) {
    if (deleteConfirmYear !== limit.year) {
      setDeleteConfirmYear(limit.year)
      return
    }
    if (pendingDeleteLimitYear !== null) return

    setPendingDeleteLimitYear(limit.year)
    setPendingDeletedLimit(limit)
    setSelectedLimitYear((current) => (current === limit.year ? null : current))
    const minimumFeedback = delay(LIMIT_DELETE_FEEDBACK_MS)

    let deleteError: unknown = null
    try {
      await deleteLimit.mutateAsync({ categoryId: plan.id, year: limit.year })
    } catch (error) {
      deleteError = error
    }

    await minimumFeedback

    setPendingDeleteLimitYear(null)
    setPendingDeletedLimit(null)
    setDeleteConfirmYear(null)

    if (deleteError) {
      setLimitError(deleteError instanceof Error ? deleteError.message : 'Failed to delete limit.')
      return
    }

    setLimitError(null)
  }

  return {
    closeLimitDetailsModal,
    createNewLimit,
    creatingLimit,
    deleteConfirmYear,
    deleteSelectedLimit,
    hasLifetimePriorActivity,
    hasScrollableLimitRows,
    limitError,
    limitsLoading,
    newLimitForm,
    pendingDeleteLimitYear,
    resetLimitSelection,
    saveLimit,
    selectLimitYear,
    selectedDraft,
    selectedLimit,
    selectedLimitDeleteConfirming,
    selectedLimitDeleting,
    selectedLimitDirty,
    selectedLimitYear,
    selectedSavingLimit,
    setLimitField,
    setNewLimitField,
    showAddTaxYear,
    sortedLimits,
    startNewLimitForm,
  }
}

/**
 * Creates a blank annual limit form for the supplied tax year
 */
function createEmptyLimitForm(year: number): TaxPlanLimitFormState {
  return {
    year: String(year),
    contribution_limit: '',
    withdrawal_limit: '',
    accrued_contributions: '',
    accrued_withdrawals: '',
  }
}

/**
 * Builds the visible annual limit draft from saved data plus local edits
 */
function getLimitDraft(
  year: number,
  limits: TaxAdvantagedCategoryLimit[],
  pendingDeletedLimit: TaxAdvantagedCategoryLimit | null,
  limitDrafts: Record<number, Partial<TaxPlanLimitDraftState>>,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
): TaxPlanLimitDraftState {
  const limit = limits.find((row) => row.year === year)
    ?? (pendingDeletedLimit?.year === year ? pendingDeletedLimit : undefined)

  return {
    contribution_limit: limitDrafts[year]?.contribution_limit
      ?? fromMinorUnits(limit?.contribution_limit ?? null, currencies, plan.currency),
    withdrawal_limit: limitDrafts[year]?.withdrawal_limit
      ?? fromMinorUnits(limit?.withdrawal_limit ?? null, currencies, plan.currency),
    accrued_contributions: limitDrafts[year]?.accrued_contributions
      ?? fromMinorUnits(limit?.accrued_contributions ?? null, currencies, plan.currency),
    accrued_withdrawals: limitDrafts[year]?.accrued_withdrawals
      ?? fromMinorUnits(limit?.accrued_withdrawals ?? null, currencies, plan.currency),
  }
}

/**
 * Compares the annual limit draft against the persisted minor-unit values
 */
function isLimitDirty(
  year: number,
  limits: TaxAdvantagedCategoryLimit[],
  pendingDeletedLimit: TaxAdvantagedCategoryLimit | null,
  limitDrafts: Record<number, Partial<TaxPlanLimitDraftState>>,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
) {
  const limit = limits.find((row) => row.year === year)
    ?? (pendingDeletedLimit?.year === year ? pendingDeletedLimit : undefined)
  if (!limit) return false

  const draft = getLimitDraft(year, limits, pendingDeletedLimit, limitDrafts, currencies, plan)

  return toMinorUnits(draft.contribution_limit, currencies, plan.currency) !== limit.contribution_limit
    || toMinorUnits(draft.withdrawal_limit, currencies, plan.currency) !== limit.withdrawal_limit
    || (toMinorUnits(draft.accrued_contributions, currencies, plan.currency) ?? 0) !== limit.accrued_contributions
    || (toMinorUnits(draft.accrued_withdrawals, currencies, plan.currency) ?? 0) !== limit.accrued_withdrawals
}

/**
 * Validates an existing annual limit draft before autosaving
 */
function validateExistingLimitDraft(year: number, draft: TaxPlanLimitDraftState) {
  if (!isValidMoneyInput(draft.contribution_limit, true)) {
    return `${year} contribution limit is required.`
  }
  if (!isValidMoneyInput(draft.withdrawal_limit)) {
    return `${year} withdrawal limit must be zero or higher.`
  }
  if (!isValidMoneyInput(draft.accrued_contributions)) {
    return `${year} opening contributions must be zero or higher.`
  }
  if (!isValidMoneyInput(draft.accrued_withdrawals)) {
    return `${year} opening withdrawals must be zero or higher.`
  }

  return null
}

/**
 * Validates the add-year draft before creating a new annual limit
 */
function validateNewLimitForm(
  form: TaxPlanLimitFormState,
  limits: TaxAdvantagedCategoryLimit[],
  year: number,
) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return 'Year must be between 1900 and 2100.'
  }
  if (limits.some((limit) => limit.year === year)) {
    return `A limit for ${year} already exists.`
  }
  if (!isValidMoneyInput(form.contribution_limit, true)) {
    return 'Contribution limit is required.'
  }
  if (!isValidMoneyInput(form.withdrawal_limit)) {
    return 'Withdrawal limit must be zero or higher.'
  }
  if (!isValidMoneyInput(form.accrued_contributions)) {
    return 'Opening contributions must be zero or higher.'
  }
  if (!isValidMoneyInput(form.accrued_withdrawals)) {
    return 'Opening withdrawals must be zero or higher.'
  }

  return null
}
