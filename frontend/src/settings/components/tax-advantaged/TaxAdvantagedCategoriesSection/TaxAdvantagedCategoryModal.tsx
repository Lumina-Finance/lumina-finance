import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronRight, LoaderCircle, Plus, Trash2, X } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import {
  useCreateTaxAdvantagedCategoryLimit,
  useDeleteTaxAdvantagedCategoryLimit,
  useTaxAdvantagedCategoryLimits,
  useUpdateTaxAdvantagedCategoryLimit,
  type TaxAdvantagedCategory,
  type TaxAdvantagedCategoryLimit,
} from '@/api/taxAdvantagedCategories'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { formatCurrency } from '@/utils/formatCurrency'
import type {
  AutosaveNotice,
  CategoryModalTab,
  TaxPlanLimitDraftField,
  TaxPlanLimitDraftState,
  TaxPlanLimitFormState,
} from '@/settings/components/tax-advantaged/taxAdvantagedTypes'
import TaxAdvantagedAccountLinksPanel from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedAccountLinksPanel'
import AutosaveStatusIcon from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/AutosaveStatusIcon'
import InfoItem from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/InfoItem'
import OpeningUsageLabel from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/OpeningUsageLabel'
import TaxAdvantagedCategoryDetailsModal from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedCategoryDetailsModal'
import TaxAdvantagedLimitDetailsModal from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedLimitDetailsModal'
import { useTaxAdvantagedAccountLinks } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/hooks/useTaxAdvantagedAccountLinks'
import { useTaxAdvantagedCategoryDetailsForm } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/hooks/useTaxAdvantagedCategoryDetailsForm'
import { autosaveNoticeColor } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedAutosave'
import {
  DEFAULT_NEW_LIMIT_YEAR,
  LIMIT_DELETE_BUTTON_TRANSITION,
  LIMIT_DELETE_FEEDBACK_MS,
  LIMIT_SAVE_FEEDBACK_MS,
  MAX_VISIBLE_LIMIT_ROWS,
} from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryConstants'
import {
  formatTaxTreatment,
  fromMinorUnits,
  isValidMoneyInput,
  nextAvailableLimitYear,
  toMinorUnits,
} from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryUtils'
import { TaxAdvantagedCurrencyWarning } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedFormControls'

export default function TaxAdvantagedCategoryModal({
  accounts,
  onClose,
  plan,
  currencies,
}: {
  accounts: AccountsOverview[]
  onClose: () => void
  plan: TaxAdvantagedCategory
  currencies: Currency[]
}) {
  const { data: limits = [], isLoading: limitsLoading } = useTaxAdvantagedCategoryLimits(plan.id)
  const createLimit = useCreateTaxAdvantagedCategoryLimit()
  const updateLimit = useUpdateTaxAdvantagedCategoryLimit()
  const deleteLimit = useDeleteTaxAdvantagedCategoryLimit()
  const {
    closeDetails: closeCategoryDetailsModal,
    confirmingDelete: confirmingPlanDelete,
    deleteCategory: handleDeletePlan,
    deletePending: deletePlanPending,
    detailsOpen: categoryEditOpen,
    openDetails,
    planError,
    planForm,
    planSaveStatus,
    saveDetails: handleSaveCategoryDetails,
    setConfirmingDelete: setConfirmingPlanDelete,
    setPlanField,
    updatePending: updatePlanPending,
  } = useTaxAdvantagedCategoryDetailsForm({ currencies, onClose, plan })
  const [activeTab, setActiveTab] = useState<CategoryModalTab>('limits')
  const [showAddTaxYear, setShowAddTaxYear] = useState(false)
  const [selectedLimitYear, setSelectedLimitYear] = useState<number | null>(null)
  const planDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const planDeleteIdleLabelRef = useRef<HTMLSpanElement>(null)
  const planDeleteConfirmLabelRef = useRef<HTMLSpanElement>(null)
  const limitDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const limitDeleteIdleLabelRef = useRef<HTMLSpanElement>(null)
  const limitDeleteConfirmLabelRef = useRef<HTMLSpanElement>(null)
  const [planDeleteLabelWidths, setPlanDeleteLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const [limitDeleteLabelWidths, setLimitDeleteLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
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
  const [autosaveNotice, setAutosaveNotice] = useState<AutosaveNotice | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)

  const showAutosaveNotice = (notice: AutosaveNotice) => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
    }
    setAutosaveNotice(notice)
    if (notice.status !== 'saving') {
      autosaveTimerRef.current = window.setTimeout(() => {
        setAutosaveNotice(null)
        autosaveTimerRef.current = null
      }, 2400)
    }
  }
  const {
    accountError,
    bindableAccounts,
    linkedAccountsCount,
    linkedAccountsMobileSummary,
    linkedAccountsSummary,
    pendingAccountId,
    toggleAccount,
  } = useTaxAdvantagedAccountLinks({ accounts, plan, showAutosaveNotice })

  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useEffect(() => () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    if (planDeleteIdleLabelRef.current && planDeleteConfirmLabelRef.current) {
      setPlanDeleteLabelWidths({
        idle: planDeleteIdleLabelRef.current.offsetWidth,
        confirm: planDeleteConfirmLabelRef.current.offsetWidth,
      })
    }
    if (limitDeleteIdleLabelRef.current && limitDeleteConfirmLabelRef.current) {
      setLimitDeleteLabelWidths({
        idle: limitDeleteIdleLabelRef.current.offsetWidth,
        confirm: limitDeleteConfirmLabelRef.current.offsetWidth,
      })
    }
  }, [])

  useEffect(() => {
    if (!confirmingPlanDelete || deletePlanPending) return
    const onPointerDown = (event: PointerEvent) => {
      if (planDeleteButtonRef.current && !planDeleteButtonRef.current.contains(event.target as Node)) {
        setConfirmingPlanDelete(false)
      }
    }
    const timer = window.setTimeout(() => window.addEventListener('pointerdown', onPointerDown), 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [confirmingPlanDelete, deletePlanPending, setConfirmingPlanDelete])

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
  }, [deleteConfirmYear, pendingDeleteLimitYear])

  const setNewLimitField = <K extends keyof TaxPlanLimitFormState>(key: K, value: TaxPlanLimitFormState[K]) => {
    setNewLimitForm((current) => ({ ...current, [key]: value }))
    setLimitError(null)
  }

  const resetNewLimitForm = () => {
    setNewLimitForm({
      year: String(nextAvailableLimitYear(limits)),
      contribution_limit: '',
      withdrawal_limit: '',
      accrued_contributions: '',
      accrued_withdrawals: '',
    })
    setShowAddTaxYear(false)
    setLimitError(null)
  }

  const startNewLimitForm = () => {
    setNewLimitForm({
      year: String(nextAvailableLimitYear(limits)),
      contribution_limit: '',
      withdrawal_limit: '',
      accrued_contributions: '',
      accrued_withdrawals: '',
    })
    setShowAddTaxYear(true)
    setSelectedLimitYear(null)
    setLimitError(null)
  }

  const setLimitField = (
    year: number,
    key: TaxPlanLimitDraftField,
    value: string,
  ) => {
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

  const selectLimitYear = (year: number) => {
    setSelectedLimitYear(year)
    setShowAddTaxYear(false)
    setDeleteConfirmYear(null)
  }

  const closeLimitDetailsModal = () => {
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

  const openCategoryDetailsModal = () => {
    if (!openDetails()) return
    setShowAddTaxYear(false)
    setSelectedLimitYear(null)
    setDeleteConfirmYear(null)
  }

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
  const limitDraft = (year: number) => {
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

  const limitDirty = (year: number) => {
    const limit = limits.find((row) => row.year === year)
    if (!limit) return false
    const draft = limitDraft(year)
    return toMinorUnits(draft.contribution_limit, currencies, plan.currency) !== limit.contribution_limit
      || toMinorUnits(draft.withdrawal_limit, currencies, plan.currency) !== limit.withdrawal_limit
      || (toMinorUnits(draft.accrued_contributions, currencies, plan.currency) ?? 0) !== limit.accrued_contributions
      || (toMinorUnits(draft.accrued_withdrawals, currencies, plan.currency) ?? 0) !== limit.accrued_withdrawals
  }

  const handleSaveLimit = (year: number) => {
    if (!limitDirty(year) || updateLimit.isPending) return
    const draft = limitDraft(year)
    if (!isValidMoneyInput(draft.contribution_limit, true)) {
      setLimitError(`${year} contribution limit is required.`)
      showAutosaveNotice({ status: 'error', message: `${year} contribution limit is required.` })
      return
    }
    if (!isValidMoneyInput(draft.withdrawal_limit)) {
      setLimitError(`${year} withdrawal limit must be zero or higher.`)
      showAutosaveNotice({ status: 'error', message: `${year} withdrawal limit must be zero or higher.` })
      return
    }
    if (!isValidMoneyInput(draft.accrued_contributions)) {
      setLimitError(`${year} opening contributions must be zero or higher.`)
      showAutosaveNotice({ status: 'error', message: `${year} opening contributions must be zero or higher.` })
      return
    }
    if (!isValidMoneyInput(draft.accrued_withdrawals)) {
      setLimitError(`${year} opening withdrawals must be zero or higher.`)
      showAutosaveNotice({ status: 'error', message: `${year} opening withdrawals must be zero or higher.` })
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

  const handleCreateLimit = async () => {
    if (!showAddTaxYear || createLimit.isPending || pendingCreateLimitYear !== null) return
    const year = Number.parseInt(newLimitForm.year, 10)
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      setLimitError('Year must be between 1900 and 2100.')
      showAutosaveNotice({ status: 'error', message: 'Year must be between 1900 and 2100.' })
      return
    }
    if (limits.some((limit) => limit.year === year)) {
      setLimitError(`A limit for ${year} already exists.`)
      showAutosaveNotice({ status: 'error', message: `A limit for ${year} already exists.` })
      return
    }
    if (!isValidMoneyInput(newLimitForm.contribution_limit, true)) {
      setLimitError('Contribution limit is required.')
      showAutosaveNotice({ status: 'error', message: 'Contribution limit is required.' })
      return
    }
    if (!isValidMoneyInput(newLimitForm.withdrawal_limit)) {
      setLimitError('Withdrawal limit must be zero or higher.')
      showAutosaveNotice({ status: 'error', message: 'Withdrawal limit must be zero or higher.' })
      return
    }
    if (!isValidMoneyInput(newLimitForm.accrued_contributions)) {
      setLimitError('Opening contributions must be zero or higher.')
      showAutosaveNotice({ status: 'error', message: 'Opening contributions must be zero or higher.' })
      return
    }
    if (!isValidMoneyInput(newLimitForm.accrued_withdrawals)) {
      setLimitError('Opening withdrawals must be zero or higher.')
      showAutosaveNotice({ status: 'error', message: 'Opening withdrawals must be zero or higher.' })
      return
    }

    setPendingCreateLimitYear(year)
    showAutosaveNotice({ status: 'saving', message: 'Saving limits...' })
    const minimumFeedback = new Promise((resolve) => window.setTimeout(resolve, LIMIT_SAVE_FEEDBACK_MS))

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

    resetNewLimitForm()
    setLimitError(null)
    showAutosaveNotice({ status: 'saved', message: 'Limits saved.' })
  }

  const handleDeleteLimit = async (limit: TaxAdvantagedCategoryLimit) => {
    if (deleteConfirmYear !== limit.year) {
      setDeleteConfirmYear(limit.year)
      return
    }
    if (pendingDeleteLimitYear !== null) return

    setPendingDeleteLimitYear(limit.year)
    setPendingDeletedLimit(limit)
    setSelectedLimitYear((current) => (current === limit.year ? null : current))
    const minimumFeedback = new Promise((resolve) => window.setTimeout(resolve, LIMIT_DELETE_FEEDBACK_MS))

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

  const selectedLimit = showAddTaxYear
    ? null
    : selectedLimitYear === null
      ? null
      : sortedLimits.find((limit) => limit.year === selectedLimitYear) ?? null
  const selectedDraft = selectedLimit ? limitDraft(selectedLimit.year) : null
  const selectedSavingLimit = selectedLimit !== null
    && updateLimit.isPending
    && updateLimit.variables?.year === selectedLimit.year
  const selectedLimitDirty = selectedLimit ? limitDirty(selectedLimit.year) : false
  const selectedLimitDeleteConfirming = selectedLimit !== null && deleteConfirmYear === selectedLimit.year
  const selectedLimitDeleting = selectedLimit !== null && pendingDeleteLimitYear === selectedLimit.year

  return (
    <>
      <AnimatePresence>
        {autosaveNotice && (
          <motion.div
            role={autosaveNotice.status === 'error' ? 'alert' : 'status'}
            aria-live={autosaveNotice.status === 'error' ? 'assertive' : 'polite'}
            className="fixed bottom-5 right-5 z-[70] flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg"
            style={{
              background: 'var(--app-bg)',
              border: '1px solid var(--app-border-strong)',
              color: autosaveNoticeColor(autosaveNotice.status),
            }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
          >
            <AutosaveStatusIcon status={autosaveNotice.status} />
            <span>{autosaveNotice.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden
      />

      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tax-advantaged-category-title"
          data-tooltip-bounds
          className="app-modal-panel flex max-h-[86vh] w-full max-w-[64rem] overflow-hidden rounded-2xl"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex h-full min-h-0 w-full flex-col min-[1050px]:grid min-[1050px]:h-[580px] min-[1050px]:max-h-[86vh] min-[1050px]:grid-cols-[280px_minmax(0,1fr)]">
            <aside
              className="flex shrink-0 min-w-0 flex-col gap-3 border-b p-4 min-[750px]:gap-6 min-[750px]:p-7 min-[1050px]:min-h-0 min-[1050px]:shrink min-[1050px]:border-b-0 min-[1050px]:border-r"
              style={{ background: 'var(--app-surface-soft)', borderColor: 'var(--app-border)' }}
            >
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <h3 id="tax-advantaged-category-title" className="truncate font-serif text-2xl font-medium leading-8 tracking-tight min-[750px]:text-3xl min-[750px]:leading-10">
                    {plan.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="app-icon-button shrink-0 min-[1050px]:hidden"
                  aria-label="Close"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>

              <div className="space-y-2.5 min-[750px]:hidden">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
                  <span className="truncate">
                    {formatTaxTreatment(plan.tax_treatment)}
                  </span>
                  <span aria-hidden style={{ color: 'var(--app-text-subtle)' }}>·</span>
                  <span className="inline-flex min-w-0 items-center gap-1">
                    {plan.currency}
                    <TaxAdvantagedCurrencyWarning />
                  </span>
                  <span aria-hidden style={{ color: 'var(--app-text-subtle)' }}>·</span>
                  <span className="truncate">
                    {plan.group_id ? 'Group' : 'Personal'}
                  </span>
                  <span aria-hidden style={{ color: 'var(--app-text-subtle)' }}>·</span>
                  <span className="truncate">
                    {linkedAccountsMobileSummary}
                  </span>
                </div>
              </div>

              <div className="hidden min-[750px]:grid min-[750px]:grid-cols-4 min-[750px]:gap-x-4 min-[750px]:gap-y-3 min-[1050px]:block min-[1050px]:space-y-4">
                <InfoItem label="Type" value={formatTaxTreatment(plan.tax_treatment)} />
                <InfoItem
                  label="Currency"
                  labelAccessory={<TaxAdvantagedCurrencyWarning />}
                  value={plan.currency}
                />
                <InfoItem label="Scope" value={plan.group_id ? 'Group' : 'Personal'} />
                <InfoItem label="Linked Accounts" value={linkedAccountsSummary} />
              </div>

              {planError && (
                <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                  {planError}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 border-t pt-3 min-[750px]:flex min-[750px]:items-center min-[750px]:justify-between min-[750px]:pt-4 min-[1050px]:mt-auto" style={{ borderColor: 'var(--app-border)' }}>
                <button
                  type="button"
                  className="app-secondary-button w-full justify-center min-[750px]:w-[72px]"
                  disabled={planSaveStatus !== 'idle'}
                  onClick={openCategoryDetailsModal}
                >
                  Edit
                </button>
                <button
                  ref={planDeleteButtonRef}
                  type="button"
                  className={`app-danger-button w-full justify-center min-[750px]:w-auto ${deletePlanPending && confirmingPlanDelete ? 'app-primary-button-loading' : ''}`}
                  onClick={() => {
                    if (deletePlanPending) return
                    if (confirmingPlanDelete) handleDeletePlan()
                    else setConfirmingPlanDelete(true)
                  }}
                  disabled={deletePlanPending}
                >
                  {deletePlanPending && confirmingPlanDelete ? (
                    <div className="app-spinner" />
                  ) : (
                    <span
                      className="relative block"
                      style={{
                        width: planDeleteLabelWidths
                          ? `${confirmingPlanDelete ? planDeleteLabelWidths.confirm : planDeleteLabelWidths.idle}px`
                          : 'auto',
                        height: '1.25rem',
                        transition: 'width 220ms cubic-bezier(0.25, 0.1, 0.25, 1)',
                      }}
                    >
                      <span
                        ref={planDeleteIdleLabelRef}
                        className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                        aria-hidden
                      >
                        <Trash2 size={16} aria-hidden />
                        Delete
                      </span>
                      <span
                        ref={planDeleteConfirmLabelRef}
                        className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                        aria-hidden
                      >
                        <Check size={16} aria-hidden />
                        Yes, delete
                      </span>
                      <span
                        className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-150"
                        style={{ opacity: confirmingPlanDelete ? 0 : 1 }}
                      >
                        <Trash2 size={16} aria-hidden />
                        Delete
                      </span>
                      <span
                        className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-150"
                        style={{ opacity: confirmingPlanDelete ? 1 : 0 }}
                      >
                        <Check size={16} aria-hidden />
                        Yes, delete
                      </span>
                    </span>
                  )}
                </button>
              </div>

            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className="flex shrink-0 items-stretch justify-between gap-3 border-b px-5 min-[750px]:px-6"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <div
                  className="flex items-stretch gap-6"
                  role="tablist"
                  aria-label="Category settings"
                >
                  {([
                    ['limits', 'Limits'],
                    ['accounts', 'Accounts'],
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab}
                      className="border-b-2 px-0 pb-2 pt-4 text-sm font-medium transition-colors duration-150"
                      onClick={() => setActiveTab(tab)}
                      style={{
                        color: activeTab === tab ? 'var(--app-text)' : 'var(--app-text-muted)',
                        borderColor: activeTab === tab ? 'var(--app-accent)' : 'transparent',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="app-icon-button my-3 hidden shrink-0 min-[1050px]:inline-flex"
                  aria-label="Close"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>

              <div className={`min-h-0 flex-1 p-5 min-[750px]:p-6 ${activeTab === 'accounts' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                {activeTab === 'limits' ? (
                  <div className="space-y-5">
                    <div className="space-y-2 border-b pb-4" style={{ borderColor: 'var(--app-border)' }}>
                      <p className="text-sm font-medium">Lifetime Contribution Room</p>
                      <div className="grid grid-cols-2 gap-3 min-[750px]:gap-x-8">
                        <div className="grid min-w-0 gap-1 min-[750px]:grid-cols-[auto_minmax(0,1fr)] min-[750px]:items-baseline min-[750px]:gap-4">
                          <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>Limit</span>
                          <span className="min-w-0 truncate font-financial text-sm font-medium">
                            {plan.lifetime_contribution_limit === null ? 'Not set' : formatCurrency(plan.lifetime_contribution_limit, plan.currency)}
                          </span>
                        </div>
                        <div className="grid min-w-0 gap-1 min-[750px]:grid-cols-[auto_minmax(0,1fr)] min-[750px]:items-baseline min-[750px]:gap-4">
                          <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                            <OpeningUsageLabel />
                          </span>
                          <span className="min-w-0 truncate text-sm font-medium">
                            {hasLifetimePriorActivity ? 'Noted' : 'None'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 min-[750px]:flex-row min-[750px]:items-center min-[750px]:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Annual Limits</p>
                        <p className="text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
                          Configure annual contribution and withdrawal limits.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="app-secondary-button w-full shrink-0 justify-center min-[750px]:w-auto"
                        onClick={startNewLimitForm}
                        disabled={showAddTaxYear}
                      >
                        <Plus size={15} aria-hidden />
                        Add year
                      </button>
                    </div>

                    <div>
                      <div className="hidden min-[750px]:block">
                        <table className="w-full table-fixed text-left text-[0.9375rem]">
                          <colgroup>
                            <col style={{ width: '5rem' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: 'auto' }} />
                            <col style={{ width: '3.5rem' }} />
                          </colgroup>
                          <thead>
                            <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
                              <th className="py-2 pr-4 font-medium" style={{ background: 'var(--app-bg)' }}>Year</th>
                              <th className="py-2 pl-0 pr-4 font-medium" style={{ background: 'var(--app-bg)' }}>Contribution limit</th>
                              <th className="py-2 pl-4 pr-0 font-medium" style={{ background: 'var(--app-bg)' }}>Withdrawal limit</th>
                              <th className="py-2 pl-4 pr-0 font-medium" style={{ background: 'var(--app-bg)' }}>
                                <OpeningUsageLabel />
                              </th>
                              <th className="py-2 pl-2 font-medium" style={{ background: 'var(--app-bg)' }} aria-label="Actions" />
                            </tr>
                          </thead>
                        </table>
                      </div>

                      <div className={hasScrollableLimitRows ? 'hidden max-h-[22rem] overflow-y-auto overflow-x-hidden pr-1 min-[750px]:block' : 'hidden overflow-hidden min-[750px]:block'}>
                        <table className="w-full table-fixed text-left text-[0.9375rem]">
                          <colgroup>
                            <col style={{ width: '5rem' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: 'auto' }} />
                            <col style={{ width: '3.5rem' }} />
                          </colgroup>
                          <tbody>
                            {limitsLoading ? null : sortedLimits.length === 0 ? (
                              <tr className="block min-[750px]:table-row">
                                <td className="block py-4 text-sm italic min-[750px]:table-cell" colSpan={5} style={{ color: 'var(--app-text-subtle)' }}>
                                  No limit entries yet.
                                </td>
                              </tr>
                            ) : (
                              sortedLimits.map((limit, index) => {
                                const isSelected = selectedLimit?.year === limit.year && !showAddTaxYear
                                const confirmingDelete = deleteConfirmYear === limit.year
                                const deletingLimit = pendingDeleteLimitYear === limit.year
                                const hasPriorActivity = limit.accrued_contributions > 0 || limit.accrued_withdrawals > 0
                                return (
                                  <tr
                                    key={limit.year}
                                    className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-xl border px-3.5 py-3 transition-colors duration-150 hover:bg-[var(--app-accent-soft)] min-[750px]:table-row min-[750px]:rounded-none min-[750px]:border-x-0 min-[750px]:border-t-0 min-[750px]:p-0 ${index === sortedLimits.length - 1 ? 'min-[750px]:border-b-0' : 'min-[750px]:border-b'}`}
                                    style={{
                                      borderColor: isSelected ? 'var(--app-accent-border)' : 'var(--app-border)',
                                      background: isSelected ? 'var(--app-accent-soft)' : undefined,
                                    }}
                                    tabIndex={0}
                                    aria-selected={isSelected}
                                    onClick={() => selectLimitYear(limit.year)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        selectLimitYear(limit.year)
                                      }
                                    }}
                                  >
                                    <td className="col-start-1 row-start-1 min-w-0 py-0 pr-0 text-base font-medium min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pr-4 min-[750px]:text-[0.9375rem]">
                                      {limit.year}
                                    </td>
                                    <td className="col-span-2 row-start-2 mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t pt-3 text-sm min-[750px]:table-cell min-[750px]:mt-0 min-[750px]:border-t-0 min-[750px]:py-3 min-[750px]:pl-0 min-[750px]:pr-4">
                                      <span className="font-medium min-[750px]:hidden" style={{ color: 'var(--app-text-muted)' }}>
                                        Contribution
                                      </span>
                                      <span className="min-w-0 truncate font-financial font-medium min-[750px]:font-normal">
                                        {formatCurrency(limit.contribution_limit, plan.currency)}
                                      </span>
                                    </td>
                                    <td className="col-span-2 row-start-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-2 text-sm min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-4 min-[750px]:pr-0">
                                      <span className="font-medium min-[750px]:hidden" style={{ color: 'var(--app-text-muted)' }}>
                                        Withdrawal
                                      </span>
                                      <span className="min-w-0 truncate font-financial font-medium min-[750px]:font-normal">
                                        {limit.withdrawal_limit === null ? (
                                          <span className="font-sans text-sm font-normal" style={{ color: 'var(--app-text-muted)' }}>No limit</span>
                                        ) : (
                                          formatCurrency(limit.withdrawal_limit, plan.currency)
                                        )}
                                      </span>
                                    </td>
                                    <td className="col-span-2 row-start-4 min-w-0 pt-2 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-4 min-[750px]:pr-0">
                                      {hasPriorActivity ? (
                                        <span className="block truncate text-sm font-medium">
                                          Noted
                                        </span>
                                      ) : (
                                        <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>No opening usage</span>
                                      )}
                                    </td>
                                    <td
                                      className="col-start-2 row-start-1 flex items-center justify-end py-0 pl-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-2"
                                    >
                                      <ChevronRight size={16} className="min-[750px]:hidden" style={{ color: 'var(--app-text-subtle)' }} aria-hidden />
                                      <div
                                        className="hidden items-center justify-center min-[750px]:flex"
                                        onClick={(event) => event.stopPropagation()}
                                        onKeyDown={(event) => event.stopPropagation()}
                                      >
                                        <button
                                          ref={confirmingDelete ? limitDeleteButtonRef : undefined}
                                          type="button"
                                          className="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors duration-150 hover:bg-[var(--app-negative-soft)]"
                                          onClick={() => { void handleDeleteLimit(limit) }}
                                          disabled={pendingDeleteLimitYear !== null}
                                          style={{ color: confirmingDelete || deletingLimit ? 'var(--app-negative)' : 'var(--app-text-subtle)' }}
                                          aria-label={confirmingDelete ? `Confirm deleting ${limit.year} limits` : `Delete ${limit.year} limits`}
                                        >
                                          <span
                                            className="relative block"
                                            style={{
                                              width: limitDeleteLabelWidths
                                                ? `${confirmingDelete || deletingLimit ? limitDeleteLabelWidths.confirm : limitDeleteLabelWidths.idle}px`
                                                : 'auto',
                                              height: '1rem',
                                              transition: 'width 150ms ease-out',
                                            }}
                                          >
                                            <span ref={limitDeleteIdleLabelRef} className="invisible absolute inline-flex items-center whitespace-nowrap" aria-hidden>
                                              <Trash2 size={14} aria-hidden />
                                            </span>
                                            <span ref={limitDeleteConfirmLabelRef} className="invisible absolute inline-flex items-center whitespace-nowrap" aria-hidden>
                                              Confirm
                                            </span>
                                            <motion.span className="absolute inset-0 inline-flex items-center justify-center" animate={{ opacity: deletingLimit ? 1 : 0 }} initial={false} transition={LIMIT_DELETE_BUTTON_TRANSITION} aria-hidden={!deletingLimit}>
                                              <LoaderCircle size={14} className="animate-spin" aria-hidden />
                                            </motion.span>
                                            <motion.span className="absolute inset-0 inline-flex items-center justify-center" animate={{ opacity: confirmingDelete && !deletingLimit ? 1 : 0 }} initial={false} transition={LIMIT_DELETE_BUTTON_TRANSITION} aria-hidden={!confirmingDelete || deletingLimit}>
                                              Confirm
                                            </motion.span>
                                            <motion.span className="absolute inset-0 inline-flex items-center justify-center" animate={{ opacity: confirmingDelete || deletingLimit ? 0 : 1 }} initial={false} transition={LIMIT_DELETE_BUTTON_TRANSITION} aria-hidden={confirmingDelete || deletingLimit}>
                                              <Trash2 size={14} aria-hidden />
                                            </motion.span>
                                          </span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="space-y-3 min-[750px]:hidden">
                        {limitsLoading ? null : sortedLimits.length === 0 ? (
                          <p className="py-4 text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
                            No limit entries yet.
                          </p>
                        ) : (
                          sortedLimits.map((limit) => {
                            const isSelected = selectedLimit?.year === limit.year && !showAddTaxYear
                            const hasPriorActivity = limit.accrued_contributions > 0 || limit.accrued_withdrawals > 0
                            return (
                              <button
                                key={limit.year}
                                type="button"
                                className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-xl border bg-transparent px-3.5 py-3 text-left transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
                                style={{
                                  borderColor: isSelected ? 'var(--app-accent-border)' : 'var(--app-border)',
                                  background: isSelected ? 'var(--app-accent-soft)' : undefined,
                                  color: 'var(--app-text)',
                                }}
                                aria-label={`Edit ${limit.year} limits`}
                                onClick={() => selectLimitYear(limit.year)}
                              >
                                <span className="col-start-1 row-start-1 min-w-0 truncate text-base font-medium">
                                  {limit.year}
                                </span>
                                <ChevronRight size={16} className="col-start-2 row-start-1 self-center" style={{ color: 'var(--app-text-subtle)' }} aria-hidden />
                                <span className="col-span-2 row-start-2 mt-3 grid min-w-0 grid-cols-2 items-center gap-3 border-t pt-3 text-sm">
                                  <span className="min-w-0 truncate font-medium" style={{ color: 'var(--app-text-muted)' }}>
                                    Contribution
                                  </span>
                                  <span className="min-w-0 justify-self-end truncate text-right font-financial font-medium">
                                    {formatCurrency(limit.contribution_limit, plan.currency)}
                                  </span>
                                </span>
                                <span className="col-span-2 row-start-3 grid min-w-0 grid-cols-2 items-center gap-3 pt-2 text-sm">
                                  <span className="min-w-0 truncate font-medium" style={{ color: 'var(--app-text-muted)' }}>
                                    Withdrawal
                                  </span>
                                  <span className="min-w-0 justify-self-end truncate text-right font-financial font-medium">
                                    {limit.withdrawal_limit === null ? (
                                      <span className="font-sans text-sm font-normal" style={{ color: 'var(--app-text-muted)' }}>No limit</span>
                                    ) : (
                                      formatCurrency(limit.withdrawal_limit, plan.currency)
                                    )}
                                  </span>
                                </span>
                                <span className="col-span-2 row-start-4 grid min-w-0 grid-cols-2 items-center gap-3 pt-2 text-sm">
                                  <span className="min-w-0 truncate font-medium" style={{ color: 'var(--app-text-muted)' }}>
                                    Opening usage
                                  </span>
                                  {hasPriorActivity ? (
                                    <span className="min-w-0 justify-self-end truncate text-right font-medium">
                                      Noted
                                    </span>
                                  ) : (
                                    <span className="min-w-0 justify-self-end truncate text-right" style={{ color: 'var(--app-text-muted)' }}>No opening usage</span>
                                  )}
                                </span>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </div>

                    {limitError && (
                      <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                        {limitError}
                      </p>
                    )}
                  </div>
                ) : (
                  <TaxAdvantagedAccountLinksPanel
                    accountError={accountError}
                    bindableAccounts={bindableAccounts}
                    linkedAccountsCount={linkedAccountsCount}
                    onToggleAccount={(account) => { void toggleAccount(account) }}
                    pendingAccountId={pendingAccountId}
                    plan={plan}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <TaxAdvantagedCategoryDetailsModal
        currencies={currencies}
        onClose={closeCategoryDetailsModal}
        onPlanFieldChange={setPlanField}
        onSave={() => { void handleSaveCategoryDetails() }}
        open={categoryEditOpen}
        plan={plan}
        planError={planError}
        planForm={planForm}
        planSaveStatus={planSaveStatus}
        updatePending={updatePlanPending}
      />

      <TaxAdvantagedLimitDetailsModal
        creatingLimit={creatingLimit}
        currencies={currencies}
        limitError={limitError}
        newLimitForm={newLimitForm}
        onClose={closeLimitDetailsModal}
        onCreateLimit={() => { void handleCreateLimit() }}
        onDeleteLimit={(limit) => { void handleDeleteLimit(limit) }}
        onLimitFieldChange={setLimitField}
        onNewLimitFieldChange={setNewLimitField}
        onSaveLimit={handleSaveLimit}
        plan={plan}
        selectedDraft={selectedDraft}
        selectedLimit={selectedLimit}
        selectedLimitDeleteConfirming={selectedLimitDeleteConfirming}
        selectedLimitDeleting={selectedLimitDeleting}
        selectedLimitDirty={selectedLimitDirty}
        selectedSavingLimit={selectedSavingLimit}
        showAddTaxYear={showAddTaxYear}
      />
    </>
  )
}
