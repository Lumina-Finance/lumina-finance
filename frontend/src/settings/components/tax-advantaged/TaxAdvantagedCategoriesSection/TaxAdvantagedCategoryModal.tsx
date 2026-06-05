import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, LoaderCircle, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useUpdateAccount, type AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import {
  useCreateTaxAdvantagedPlanLimit,
  useDeleteTaxAdvantagedPlan,
  useDeleteTaxAdvantagedPlanLimit,
  useTaxAdvantagedPlanLimits,
  useUpdateTaxAdvantagedPlan,
  useUpdateTaxAdvantagedPlanLimit,
  type TaxAdvantagedPlan,
  type TaxAdvantagedPlanLimit,
} from '@/api/taxAdvantagedPlans'
import ActionFeedbackButton from '@/components/ActionFeedbackButton'
import { formatCurrency } from '@/utils/formatCurrency'
import type { AutosaveNotice, CategoryModalTab, TaxPlanFormState, TaxPlanLimitFormState } from '@/settings/components/tax-advantaged/taxAdvantagedTypes'
import AutosaveStatusIcon from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/AutosaveStatusIcon'
import InfoItem from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/InfoItem'
import { autosaveNoticeColor } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedAutosave'
import {
  ACCOUNT_LINK_SAVE_MIN_LOADING_MS,
  ACCOUNT_LINK_SAVE_NOTICE_DELAY_MS,
  CATEGORY_FIELD_TRANSITION,
  CATEGORY_SUMMARY_LABEL_CLASS,
  CATEGORY_SUMMARY_VALUE_CLASS,
  DEFAULT_NEW_LIMIT_YEAR,
  DELETE_TAX_CATEGORY_MIN_LOADING_MS,
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
import {
  CompactCurrencyInput,
  InlineCurrencyInput,
  InlineTaxTreatmentSelect,
  TaxAdvantagedCurrencyWarning,
} from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedFormControls'

const LIMIT_FIELD_ACTION_TRANSITION = {
  duration: 0.18,
  ease: [0.25, 0.1, 0.25, 1] as const,
}

type LimitDraftField = keyof Pick<TaxPlanLimitFormState, 'contribution_limit' | 'withdrawal_limit'>

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function LimitInputShell({
  children,
  dirty,
  discardLabel,
  disabled,
  onDiscard,
  onSave,
  saveLabel,
  saving,
}: {
  children: React.ReactNode
  dirty: boolean
  discardLabel: string
  disabled: boolean
  onDiscard: () => void
  onSave: () => void
  saveLabel: string
  saving: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="min-w-0 flex-1">
        {children}
      </div>
      <AnimatePresence initial={false}>
        {dirty && (
          <motion.div
            className="flex shrink-0 items-center gap-1 overflow-hidden"
            initial={{ opacity: 0, width: 0, x: -4, filter: 'blur(3px)' }}
            animate={{ opacity: 1, width: 68, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, width: 0, x: -4, filter: 'blur(3px)' }}
            transition={LIMIT_FIELD_ACTION_TRANSITION}
          >
            <button
              type="button"
              className="app-icon-button h-8 w-8 shrink-0 disabled:cursor-wait disabled:opacity-60"
              onClick={onSave}
              disabled={disabled}
              aria-label={saveLabel}
              title="Save"
              style={{ color: 'var(--app-accent)' }}
            >
              {saving ? (
                <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Check size={14} aria-hidden />
              )}
            </button>
            <button
              type="button"
              className="app-icon-button h-8 w-8 shrink-0 disabled:cursor-wait disabled:opacity-60"
              onClick={onDiscard}
              disabled={disabled}
              aria-label={discardLabel}
              title="Discard"
            >
              <X size={14} aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function TaxAdvantagedCategoryModal({
  accounts,
  onClose,
  plan,
  currencies,
}: {
  accounts: AccountsOverview[]
  onClose: () => void
  plan: TaxAdvantagedPlan
  currencies: Currency[]
}) {
  const updatePlan = useUpdateTaxAdvantagedPlan(plan.id)
  const deletePlan = useDeleteTaxAdvantagedPlan({ minimumPendingMs: DELETE_TAX_CATEGORY_MIN_LOADING_MS })
  const updateAccount = useUpdateAccount()
  const { data: limits = [], isLoading: limitsLoading } = useTaxAdvantagedPlanLimits(plan.id)
  const createLimit = useCreateTaxAdvantagedPlanLimit()
  const updateLimit = useUpdateTaxAdvantagedPlanLimit()
  const deleteLimit = useDeleteTaxAdvantagedPlanLimit()
  const [activeTab, setActiveTab] = useState<CategoryModalTab>('limits')
  const [categoryEditOpen, setCategoryEditOpen] = useState(false)
  const [showAddTaxYear, setShowAddTaxYear] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [confirmingPlanDelete, setConfirmingPlanDelete] = useState(false)
  const planDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const planDeleteIdleLabelRef = useRef<HTMLSpanElement>(null)
  const planDeleteConfirmLabelRef = useRef<HTMLSpanElement>(null)
  const limitDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const limitDeleteIdleLabelRef = useRef<HTMLSpanElement>(null)
  const limitDeleteConfirmLabelRef = useRef<HTMLSpanElement>(null)
  const [planDeleteLabelWidths, setPlanDeleteLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const [limitDeleteLabelWidths, setLimitDeleteLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const planBase: TaxPlanFormState = {
    name: plan.name,
    tax_treatment: plan.tax_treatment,
    currency: plan.currency,
    lifetime_contribution_limit: fromMinorUnits(plan.lifetime_contribution_limit, currencies, plan.currency),
  }
  const [planOverrides, setPlanOverrides] = useState<Partial<TaxPlanFormState>>({})
  const planForm: TaxPlanFormState = { ...planBase, ...planOverrides }
  const [limitDrafts, setLimitDrafts] = useState<Record<number, Partial<Pick<TaxPlanLimitFormState, 'contribution_limit' | 'withdrawal_limit'>>>>({})
  const [newLimitForm, setNewLimitForm] = useState<TaxPlanLimitFormState>({
    year: String(DEFAULT_NEW_LIMIT_YEAR),
    contribution_limit: '',
    withdrawal_limit: '',
  })
  const [pendingCreateLimitYear, setPendingCreateLimitYear] = useState<number | null>(null)
  const [deleteConfirmYear, setDeleteConfirmYear] = useState<number | null>(null)
  const [pendingDeleteLimitYear, setPendingDeleteLimitYear] = useState<number | null>(null)
  const [pendingDeletedLimit, setPendingDeletedLimit] = useState<TaxAdvantagedPlanLimit | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [limitError, setLimitError] = useState<string | null>(null)
  const [planSaveStatus, setPlanSaveStatus] = useState<'idle' | 'loading' | 'success'>('idle')
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

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
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
    if (!confirmingPlanDelete || deletePlan.isPending) return
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
  }, [confirmingPlanDelete, deletePlan.isPending])

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

  const setPlanField = <K extends keyof TaxPlanFormState>(key: K, value: TaxPlanFormState[K]) => {
    setPlanOverrides((current) => ({ ...current, [key]: value }))
    setPlanError(null)
  }

  const setNewLimitField = <K extends keyof TaxPlanLimitFormState>(key: K, value: TaxPlanLimitFormState[K]) => {
    setNewLimitForm((current) => ({ ...current, [key]: value }))
    setLimitError(null)
  }

  const resetNewLimitForm = () => {
    setNewLimitForm({
      year: String(nextAvailableLimitYear(limits)),
      contribution_limit: '',
      withdrawal_limit: '',
    })
    setShowAddTaxYear(false)
    setLimitError(null)
  }

  const startNewLimitForm = () => {
    setNewLimitForm({
      year: String(nextAvailableLimitYear(limits)),
      contribution_limit: '',
      withdrawal_limit: '',
    })
    setShowAddTaxYear(true)
    setLimitError(null)
  }

  const setLimitField = (
    year: number,
    key: keyof Pick<TaxPlanLimitFormState, 'contribution_limit' | 'withdrawal_limit'>,
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

  const getPlanUpdateState = (form: TaxPlanFormState) => {
    const nextLifetimeLimit = toMinorUnits(form.lifetime_contribution_limit, currencies, plan.currency)
    const dirty = form.name.trim() !== plan.name
      || form.tax_treatment !== plan.tax_treatment
      || nextLifetimeLimit !== plan.lifetime_contribution_limit
    return { dirty, nextLifetimeLimit }
  }

  const validatePlanForm = (form: TaxPlanFormState) => {
    if (!form.name.trim()) {
      return 'Name is required.'
    }
    if (!isValidMoneyInput(form.lifetime_contribution_limit)) {
      return 'Lifetime contribution limit must be zero or higher.'
    }
    return null
  }

  const handleCategoryEditClick = async () => {
    if (updatePlan.isPending || planSaveStatus !== 'idle') return
    if (!categoryEditOpen) {
      setCategoryEditOpen(true)
      return
    }

    const validationError = validatePlanForm(planForm)
    if (validationError) {
      setPlanError(validationError)
      return
    }

    const { dirty, nextLifetimeLimit } = getPlanUpdateState(planForm)
    setPlanSaveStatus('loading')
    const minimumLoading = new Promise((resolve) => window.setTimeout(resolve, 1000))
    try {
      if (dirty) {
        await updatePlan.mutateAsync({
          name: planForm.name.trim(),
          tax_treatment: planForm.tax_treatment,
          lifetime_contribution_limit: nextLifetimeLimit,
        })
        setPlanOverrides({})
        setPlanError(null)
      }
      await minimumLoading
      setPlanSaveStatus('success')
      setCategoryEditOpen(false)
      await new Promise((resolve) => window.setTimeout(resolve, 1200))
      setPlanSaveStatus('idle')
    } catch (error) {
      await minimumLoading
      setPlanSaveStatus('idle')
      setPlanError(error instanceof Error ? error.message : 'Failed to update plan.')
    }
  }

  const handleDeletePlan = () => {
    setPlanError(null)
    deletePlan.mutate(plan.id, {
      onSuccess: onClose,
      onError: (error) => {
        setConfirmingPlanDelete(false)
        setPlanError(error instanceof Error ? error.message : 'Failed to delete plan.')
      },
    })
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
  const mobileTaxTreatmentLabel = categoryEditOpen
    ? formatTaxTreatment(planForm.tax_treatment)
    : formatTaxTreatment(plan.tax_treatment)
  const bindableAccounts = accounts.filter(
    (account) =>
      account.closed_at === null
      && account.account_kind === 'asset'
      && account.currency === plan.currency,
  )

  const limitDraft = (year: number) => {
    const limit = limits.find((row) => row.year === year)
      ?? (pendingDeletedLimit?.year === year ? pendingDeletedLimit : undefined)
    return {
      contribution_limit: limitDrafts[year]?.contribution_limit
        ?? fromMinorUnits(limit?.contribution_limit ?? null, currencies, plan.currency),
      withdrawal_limit: limitDrafts[year]?.withdrawal_limit
        ?? fromMinorUnits(limit?.withdrawal_limit ?? null, currencies, plan.currency),
    }
  }

  const limitDirty = (year: number) => {
    const limit = limits.find((row) => row.year === year)
    if (!limit) return false
    const draft = limitDraft(year)
    return toMinorUnits(draft.contribution_limit, currencies, plan.currency) !== limit.contribution_limit
      || toMinorUnits(draft.withdrawal_limit, currencies, plan.currency) !== limit.withdrawal_limit
  }

  const limitFieldDirty = (year: number, key: LimitDraftField) => {
    const limit = limits.find((row) => row.year === year)
    if (!limit) return false
    const draft = limitDraft(year)
    const baseline = key === 'contribution_limit' ? limit.contribution_limit : limit.withdrawal_limit
    return toMinorUnits(draft[key], currencies, plan.currency) !== baseline
  }

  const discardLimitField = (year: number, key: LimitDraftField) => {
    setLimitDrafts((current) => {
      const draft = current[year]
      if (!draft || !(key in draft)) return current

      const nextDraft = { ...draft }
      delete nextDraft[key]

      const next = { ...current }
      if (Object.keys(nextDraft).length === 0) delete next[year]
      else next[year] = nextDraft
      return next
    })
    setLimitError(null)
    setDeleteConfirmYear(null)
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

    showAutosaveNotice({ status: 'saving', message: 'Saving limits...' })
    updateLimit.mutate(
      {
        planId: plan.id,
        year,
        contribution_limit: toMinorUnits(draft.contribution_limit, currencies, plan.currency) ?? 0,
        withdrawal_limit: toMinorUnits(draft.withdrawal_limit, currencies, plan.currency),
      },
      {
        onSuccess: () => {
          setLimitDrafts((current) => {
            const next = { ...current }
            delete next[year]
            return next
          })
          setLimitError(null)
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

    setPendingCreateLimitYear(year)
    showAutosaveNotice({ status: 'saving', message: 'Saving limits...' })
    const minimumFeedback = new Promise((resolve) => window.setTimeout(resolve, LIMIT_SAVE_FEEDBACK_MS))

    let createError: unknown = null
    try {
      await createLimit.mutateAsync({
        planId: plan.id,
        year,
        contribution_limit: toMinorUnits(newLimitForm.contribution_limit, currencies, plan.currency) ?? 0,
        withdrawal_limit: toMinorUnits(newLimitForm.withdrawal_limit, currencies, plan.currency),
      })
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

  const handleDeleteLimit = async (limit: TaxAdvantagedPlanLimit) => {
    if (deleteConfirmYear !== limit.year) {
      setDeleteConfirmYear(limit.year)
      return
    }
    if (pendingDeleteLimitYear !== null) return

    setPendingDeleteLimitYear(limit.year)
    setPendingDeletedLimit(limit)
    const minimumFeedback = new Promise((resolve) => window.setTimeout(resolve, LIMIT_DELETE_FEEDBACK_MS))

    let deleteError: unknown = null
    try {
      await deleteLimit.mutateAsync({ planId: plan.id, year: limit.year })
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

  const handleToggleAccount = async (account: AccountsOverview) => {
    if (account.is_archived) return

    const isLinked = account.tax_advantaged_plan_id === plan.id
    let savingNoticeShown = false
    const savingNoticeTimer = window.setTimeout(() => {
      savingNoticeShown = true
      showAutosaveNotice({ status: 'saving', message: 'Saving account link...' })
    }, ACCOUNT_LINK_SAVE_NOTICE_DELAY_MS)

    try {
      await updateAccount.mutateAsync({
        accountId: account.id,
        payload: { tax_advantaged_plan_id: isLinked ? null : plan.id },
      })
      window.clearTimeout(savingNoticeTimer)

      if (savingNoticeShown) await delay(ACCOUNT_LINK_SAVE_MIN_LOADING_MS)

      setAccountError(null)
      showAutosaveNotice({ status: 'saved', message: 'Account link saved.' })
    } catch (error) {
      window.clearTimeout(savingNoticeTimer)
      const message = error instanceof Error ? error.message : 'Failed to update account binding.'
      setAccountError(message)
      showAutosaveNotice({ status: 'error', message })
    }
  }

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
          className="app-modal-panel flex max-h-[86vh] w-full max-w-[64rem] overflow-hidden rounded-2xl"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex h-full min-h-0 w-full flex-col min-[1050px]:grid min-[1050px]:max-h-[86vh] min-[1050px]:min-h-[580px] min-[1050px]:grid-cols-[280px_minmax(0,1fr)]">
            <aside
              className="flex shrink-0 min-w-0 flex-col gap-5 border-b p-5 min-[750px]:gap-6 min-[750px]:p-7 min-[1050px]:min-h-0 min-[1050px]:shrink min-[1050px]:border-b-0 min-[1050px]:border-r"
              style={{ background: 'var(--app-surface-soft)', borderColor: 'var(--app-border)' }}
            >
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="h-10 min-w-0 flex-1 overflow-hidden">
                  <h3 id="tax-advantaged-category-title" className="h-10 font-serif text-3xl font-medium leading-10 tracking-tight">
                    <div className="relative h-10 min-w-0">
                      <motion.div
                        className={`absolute inset-0 group flex h-10 min-w-0 items-center gap-2 ${categoryEditOpen ? '' : 'pointer-events-none'}`}
                        style={{ borderBottom: '1px solid var(--app-border-strong)' }}
                        animate={{ opacity: categoryEditOpen ? 1 : 0 }}
                        initial={false}
                        transition={CATEGORY_FIELD_TRANSITION}
                        aria-hidden={!categoryEditOpen}
                      >
                        <input
                          aria-label="Category name"
                          className="block h-10 min-w-0 flex-1 bg-transparent font-serif text-3xl font-medium leading-10 tracking-tight outline-none"
                          maxLength={256}
                          onChange={(event) => setPlanField('name', event.target.value)}
                          required
                          style={{ color: 'var(--app-text)' }}
                          tabIndex={categoryEditOpen ? undefined : -1}
                          value={planForm.name}
                        />
                        <Pencil
                          size={15}
                          className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
                          style={{ color: 'var(--app-text-subtle)' }}
                          aria-hidden
                        />
                      </motion.div>
                      <motion.span
                        className={`absolute inset-0 block h-10 truncate leading-10 ${categoryEditOpen ? 'pointer-events-none' : ''}`}
                        animate={{ opacity: categoryEditOpen ? 0 : 1 }}
                        initial={false}
                        transition={CATEGORY_FIELD_TRANSITION}
                        aria-hidden={categoryEditOpen}
                      >
                        {planForm.name.trim() || plan.name}
                      </motion.span>
                    </div>
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

              <div className="space-y-3 min-[750px]:hidden">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] font-medium">
                  <span className="relative inline-block h-6 min-w-0 max-w-[8rem] align-bottom">
                    <span className={`invisible flex h-6 items-center leading-6 ${categoryEditOpen ? 'gap-1' : ''}`} aria-hidden>
                      <span className="truncate">{mobileTaxTreatmentLabel}</span>
                      {categoryEditOpen && <Pencil size={13} className="shrink-0" />}
                    </span>
                    <motion.span
                      className={`absolute inset-0 ${categoryEditOpen ? '' : 'pointer-events-none'}`}
                      animate={{ opacity: categoryEditOpen ? 1 : 0 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={!categoryEditOpen}
                    >
                      <InlineTaxTreatmentSelect
                        value={planForm.tax_treatment}
                        onChange={(value) => setPlanField('tax_treatment', value)}
                      />
                    </motion.span>
                    <motion.span
                      className={`absolute inset-0 flex h-6 items-center truncate leading-6 ${categoryEditOpen ? 'pointer-events-none' : ''}`}
                      animate={{ opacity: categoryEditOpen ? 0 : 1 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={categoryEditOpen}
                    >
                      {formatTaxTreatment(plan.tax_treatment)}
                    </motion.span>
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
                </div>

                <div className="flex min-w-0 items-center justify-between gap-4 border-t pt-3" style={{ borderColor: 'var(--app-border)' }}>
                  <span className="app-label min-w-0">Lifetime Contribution Limit</span>
                  <span className="relative block h-6 min-w-[7rem] flex-1">
                    <motion.span
                      className={`absolute inset-y-0 right-0 w-full max-w-[10rem] ${categoryEditOpen ? '' : 'pointer-events-none'}`}
                      animate={{ opacity: categoryEditOpen ? 1 : 0 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={!categoryEditOpen}
                    >
                      <InlineCurrencyInput
                        ariaLabel="Lifetime contribution limit"
                        currencies={currencies}
                        currency={plan.currency}
                        value={planForm.lifetime_contribution_limit}
                        onChange={(value) => setPlanField('lifetime_contribution_limit', value)}
                        placeholder="Optional"
                      />
                    </motion.span>
                    <motion.span
                      className={`flex h-6 items-center justify-end truncate text-right text-[0.9375rem] font-medium leading-6 ${categoryEditOpen ? 'pointer-events-none' : ''}`}
                      animate={{ opacity: categoryEditOpen ? 0 : 1 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={categoryEditOpen}
                    >
                      {plan.lifetime_contribution_limit === null ? 'Not set' : formatCurrency(plan.lifetime_contribution_limit, plan.currency)}
                    </motion.span>
                  </span>
                </div>
              </div>

              <div className="hidden min-[750px]:grid min-[750px]:grid-cols-4 min-[750px]:gap-x-4 min-[750px]:gap-y-3 min-[1050px]:block min-[1050px]:space-y-4">
                <div className="relative h-14 min-w-0 overflow-hidden">
                  <p className={CATEGORY_SUMMARY_LABEL_CLASS}>Type</p>
                  <div className="relative h-6 min-w-0">
                    <motion.div
                      className={`absolute inset-0 ${categoryEditOpen ? '' : 'pointer-events-none'}`}
                      animate={{ opacity: categoryEditOpen ? 1 : 0 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={!categoryEditOpen}
                    >
                      <InlineTaxTreatmentSelect
                        value={planForm.tax_treatment}
                        onChange={(value) => setPlanField('tax_treatment', value)}
                      />
                    </motion.div>
                    <motion.p
                      className={`absolute inset-0 ${CATEGORY_SUMMARY_VALUE_CLASS} ${categoryEditOpen ? 'pointer-events-none' : ''}`}
                      animate={{ opacity: categoryEditOpen ? 0 : 1 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={categoryEditOpen}
                    >
                      {formatTaxTreatment(plan.tax_treatment)}
                    </motion.p>
                  </div>
                </div>

                <InfoItem
                  label="Currency"
                  labelAccessory={<TaxAdvantagedCurrencyWarning />}
                  value={plan.currency}
                />
                <InfoItem label="Scope" value={plan.group_id ? 'Group' : 'Personal'} />

                <div className="relative h-14 min-w-0 overflow-hidden">
                  <p className={CATEGORY_SUMMARY_LABEL_CLASS}>Lifetime Contribution Limit</p>
                  <div className="relative h-6 min-w-0">
                    <motion.div
                      className={`absolute inset-0 ${categoryEditOpen ? '' : 'pointer-events-none'}`}
                      animate={{ opacity: categoryEditOpen ? 1 : 0 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={!categoryEditOpen}
                    >
                      <InlineCurrencyInput
                        ariaLabel="Lifetime contribution limit"
                        currencies={currencies}
                        currency={plan.currency}
                        value={planForm.lifetime_contribution_limit}
                        onChange={(value) => setPlanField('lifetime_contribution_limit', value)}
                        placeholder="Optional"
                      />
                    </motion.div>
                    <motion.p
                      className={`absolute inset-0 font-financial ${CATEGORY_SUMMARY_VALUE_CLASS} ${categoryEditOpen ? 'pointer-events-none' : ''}`}
                      animate={{ opacity: categoryEditOpen ? 0 : 1 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={categoryEditOpen}
                    >
                      {plan.lifetime_contribution_limit === null ? 'Not set' : formatCurrency(plan.lifetime_contribution_limit, plan.currency)}
                    </motion.p>
                  </div>
                </div>
              </div>

              {planError && (
                <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                  {planError}
                </p>
              )}

              <div className="flex items-center justify-between border-t pt-4 min-[1050px]:mt-auto" style={{ borderColor: 'var(--app-border)' }}>
                <ActionFeedbackButton
                  type="button"
                  className="app-secondary-button w-[72px]"
                  disabled={planSaveStatus !== 'idle'}
                  loadingLabel="Saving"
                  onClick={() => { void handleCategoryEditClick() }}
                  status={planSaveStatus}
                >
                  {categoryEditOpen ? 'Done' : 'Edit'}
                </ActionFeedbackButton>
                <button
                  ref={planDeleteButtonRef}
                  type="button"
                  className={`app-danger-button ${deletePlan.isPending && confirmingPlanDelete ? 'app-primary-button-loading' : ''}`}
                  onClick={() => {
                    if (deletePlan.isPending) return
                    if (confirmingPlanDelete) handleDeletePlan()
                    else setConfirmingPlanDelete(true)
                  }}
                  disabled={deletePlan.isPending}
                >
                  {deletePlan.isPending && confirmingPlanDelete ? (
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
                      className="border-b-2 px-0 py-4 text-sm font-medium transition-colors duration-150"
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

              <div className="min-h-0 flex-1 overflow-y-auto p-5 min-[750px]:p-6">
                {activeTab === 'limits' ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 min-[750px]:flex-row min-[750px]:items-center min-[750px]:justify-between">
                      <p className="text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
                        Configure annual contribution and withdrawal limits.
                      </p>
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

                    <div className={hasScrollableLimitRows ? 'max-h-[22rem] overflow-y-auto overflow-x-hidden pr-1' : 'overflow-hidden'}>
                      <table className="block w-full text-left text-[0.9375rem] min-[750px]:table min-[750px]:table-fixed">
                        <colgroup className="hidden min-[750px]:table-column-group">
                          <col style={{ width: '6.5rem' }} />
                          <col style={{ width: 'calc((100% - 11.5rem) / 2)' }} />
                          <col style={{ width: 'calc((100% - 11.5rem) / 2)' }} />
                          <col style={{ width: '5rem' }} />
                        </colgroup>
                        <thead className="hidden min-[750px]:table-header-group">
                          <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
                            <th
                              className="sticky top-0 z-10 py-2 pr-4 font-medium"
                              style={{ background: 'var(--app-bg)' }}
                            >
                              Year
                            </th>
                            <th
                              className="sticky top-0 z-10 py-2 pl-0 pr-4 font-medium"
                              style={{ background: 'var(--app-bg)' }}
                            >
                              Contribution limit
                            </th>
                            <th
                              className="sticky top-0 z-10 py-2 pl-4 pr-0 font-medium"
                              style={{ background: 'var(--app-bg)' }}
                            >
                              Withdrawal limit
                            </th>
                            <th
                              className="sticky top-0 z-10 py-2 pl-2 font-medium"
                              style={{ background: 'var(--app-bg)' }}
                              aria-label="Actions"
                            />
                          </tr>
                        </thead>
                        <tbody className="block space-y-3 min-[750px]:table-row-group min-[750px]:space-y-0">
                          {showAddTaxYear && (
                            <tr
                              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 rounded-xl border p-3 min-[750px]:table-row min-[750px]:rounded-none min-[750px]:border-x-0 min-[750px]:border-t-0 min-[750px]:p-0"
                              style={{ borderColor: 'var(--app-border)' }}
                            >
                              <td className="col-start-1 row-start-1 min-w-0 py-0 pr-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pr-5">
                                <span className="app-label mb-1 block min-[750px]:hidden">Year</span>
                                <div
                                  className="group flex h-9 w-full items-center gap-1.5 rounded-md border border-transparent px-2 transition-colors duration-150 hover:border-[var(--app-border)] focus-within:border-[var(--app-accent-border)] min-[750px]:w-20"
                                  style={{ background: 'color-mix(in srgb, var(--app-input-bg) 55%, var(--app-bg))' }}
                                >
                                  <input
                                    aria-label="New tax year"
                                    className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    type="text"
                                    value={newLimitForm.year}
                                    onChange={(event) => setNewLimitField('year', event.target.value.replace(/\D/g, '').slice(0, 4))}
                                    style={{ color: 'var(--app-text)' }}
                                  />
                                  <Pencil
                                    size={13}
                                    className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
                                    style={{ color: 'var(--app-text-subtle)' }}
                                    aria-hidden
                                  />
                                </div>
                              </td>
                              <td className="col-span-2 min-w-0 py-0 pl-0 pr-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-0 min-[750px]:pr-4">
                                <span className="app-label mb-1 block min-[750px]:hidden">Contribution limit</span>
                                <CompactCurrencyInput
                                  ariaLabel="New tax-year contribution limit"
                                  currencies={currencies}
                                  currency={plan.currency}
                                  value={newLimitForm.contribution_limit}
                                  onChange={(value) => setNewLimitField('contribution_limit', value)}
                                  placeholder="Contribution limit"
                                />
                              </td>
                              <td className="col-span-2 min-w-0 py-0 pl-0 pr-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-4 min-[750px]:pr-0">
                                <span className="app-label mb-1 block min-[750px]:hidden">Withdrawal limit</span>
                                <CompactCurrencyInput
                                  ariaLabel="New tax-year withdrawal limit"
                                  currencies={currencies}
                                  currency={plan.currency}
                                  value={newLimitForm.withdrawal_limit}
                                  onChange={(value) => setNewLimitField('withdrawal_limit', value)}
                                  placeholder="Optional"
                                />
                              </td>
                              <td className="col-start-2 row-start-1 py-0 pl-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-2">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    className="app-icon-button shrink-0"
                                    onClick={() => { void handleCreateLimit() }}
                                    disabled={creatingLimit}
                                    aria-label="Save new tax year"
                                  >
                                    {creatingLimit ? (
                                      <LoaderCircle size={14} className="animate-spin" aria-hidden />
                                    ) : (
                                      <Check size={14} aria-hidden />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="app-icon-button shrink-0"
                                    onClick={resetNewLimitForm}
                                    disabled={creatingLimit}
                                    aria-label="Cancel new tax year"
                                  >
                                    <X size={14} aria-hidden />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {limitsLoading ? null : sortedLimits.length === 0 && !showAddTaxYear ? (
                            <tr className="block min-[750px]:table-row">
                              <td className="block py-4 text-sm italic min-[750px]:table-cell" colSpan={4} style={{ color: 'var(--app-text-subtle)' }}>
                                No limit entries yet.
                              </td>
                            </tr>
                          ) : (
                            sortedLimits.map((limit, index) => {
                              const draft = limitDraft(limit.year)
                              const confirmingDelete = deleteConfirmYear === limit.year
                              const deletingLimit = pendingDeleteLimitYear === limit.year
                              const savingLimit = updateLimit.isPending && updateLimit.variables?.year === limit.year
                              const contributionDirty = limitFieldDirty(limit.year, 'contribution_limit')
                              const withdrawalDirty = limitFieldDirty(limit.year, 'withdrawal_limit')
                              return (
                                <tr
                                  key={limit.year}
                                  className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 rounded-xl border p-3 min-[750px]:table-row min-[750px]:rounded-none min-[750px]:border-x-0 min-[750px]:border-t-0 min-[750px]:p-0 ${index === sortedLimits.length - 1 ? 'min-[750px]:border-b-0' : 'min-[750px]:border-b'}`}
                                  style={{ borderColor: 'var(--app-border)' }}
                                >
                                  <td className="col-start-1 row-start-1 py-0 pr-0 font-medium min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pr-4">
                                    <span className="app-label mb-1 block min-[750px]:hidden">Year</span>
                                    {limit.year}
                                  </td>
                                  <td className="col-span-2 min-w-0 py-0 pl-0 pr-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-0 min-[750px]:pr-4">
                                    <span className="app-label mb-1 block min-[750px]:hidden">Contribution limit</span>
                                    <LimitInputShell
                                      dirty={contributionDirty}
                                      disabled={updateLimit.isPending}
                                      saving={savingLimit}
                                      onSave={() => handleSaveLimit(limit.year)}
                                      onDiscard={() => discardLimitField(limit.year, 'contribution_limit')}
                                      saveLabel={`Save ${limit.year} contribution limit`}
                                      discardLabel={`Discard ${limit.year} contribution limit changes`}
                                    >
                                      <CompactCurrencyInput
                                        ariaLabel={`${limit.year} contribution limit`}
                                        currencies={currencies}
                                        currency={plan.currency}
                                        value={draft.contribution_limit}
                                        onChange={(value) => setLimitField(limit.year, 'contribution_limit', value)}
                                      />
                                    </LimitInputShell>
                                  </td>
                                  <td className="col-span-2 min-w-0 py-0 pl-0 pr-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-4 min-[750px]:pr-0">
                                    <span className="app-label mb-1 block min-[750px]:hidden">Withdrawal limit</span>
                                    <LimitInputShell
                                      dirty={withdrawalDirty}
                                      disabled={updateLimit.isPending}
                                      saving={savingLimit}
                                      onSave={() => handleSaveLimit(limit.year)}
                                      onDiscard={() => discardLimitField(limit.year, 'withdrawal_limit')}
                                      saveLabel={`Save ${limit.year} withdrawal limit`}
                                      discardLabel={`Discard ${limit.year} withdrawal limit changes`}
                                    >
                                      <CompactCurrencyInput
                                        ariaLabel={`${limit.year} withdrawal limit`}
                                        currencies={currencies}
                                        currency={plan.currency}
                                        value={draft.withdrawal_limit}
                                        onChange={(value) => setLimitField(limit.year, 'withdrawal_limit', value)}
                                        placeholder="Optional"
                                      />
                                    </LimitInputShell>
                                  </td>
                                  <td className="col-start-2 row-start-1 py-0 pl-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-2">
                                    <div className="flex items-center justify-center">
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
                                          <span
                                            ref={limitDeleteIdleLabelRef}
                                            className="invisible absolute inline-flex items-center whitespace-nowrap"
                                            aria-hidden
                                          >
                                            <Trash2 size={14} aria-hidden />
                                          </span>
                                          <span
                                            ref={limitDeleteConfirmLabelRef}
                                            className="invisible absolute inline-flex items-center whitespace-nowrap"
                                            aria-hidden
                                          >
                                            Confirm
                                          </span>
                                          <motion.span
                                            className="absolute inset-0 inline-flex items-center justify-center"
                                            animate={{ opacity: deletingLimit ? 1 : 0 }}
                                            initial={false}
                                            transition={LIMIT_DELETE_BUTTON_TRANSITION}
                                            aria-hidden={!deletingLimit}
                                          >
                                            <LoaderCircle size={14} className="animate-spin" aria-hidden />
                                          </motion.span>
                                          <motion.span
                                            className="absolute inset-0 inline-flex items-center justify-center"
                                            animate={{ opacity: confirmingDelete && !deletingLimit ? 1 : 0 }}
                                            initial={false}
                                            transition={LIMIT_DELETE_BUTTON_TRANSITION}
                                            aria-hidden={!confirmingDelete || deletingLimit}
                                          >
                                            Confirm
                                          </motion.span>
                                          <motion.span
                                            className="absolute inset-0 inline-flex items-center justify-center"
                                            animate={{ opacity: confirmingDelete || deletingLimit ? 0 : 1 }}
                                            initial={false}
                                            transition={LIMIT_DELETE_BUTTON_TRANSITION}
                                            aria-hidden={confirmingDelete || deletingLimit}
                                          >
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

                    {limitError && (
                      <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                        {limitError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <p className="text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
                        Choose eligible {plan.currency} accounts for this category. Archived accounts stay visible for history but cannot be linked or unlinked until unarchived.
                      </p>
                      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                        {bindableAccounts.filter((account) => account.tax_advantaged_plan_id === plan.id).length} of {bindableAccounts.length} linked
                      </p>
                    </div>

                    {accountError && (
                      <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                        {accountError}
                      </p>
                    )}

                    {bindableAccounts.length === 0 ? (
                      <p className="py-3 text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
                        No eligible {plan.currency} asset accounts.
                      </p>
                    ) : (
                      <div
                        className="overflow-hidden rounded-xl border"
                        style={{ borderColor: 'var(--app-border)' }}
                      >
                        {bindableAccounts.map((account, index) => {
                          const linked = account.tax_advantaged_plan_id === plan.id
                          const linkedElsewhere = account.tax_advantaged_plan_id !== null && !linked
                          const pending = updateAccount.isPending && updateAccount.variables?.accountId === account.id
                          const disabled = account.is_archived || linkedElsewhere || pending
                          const statusParts = [
                            account.institution?.name ?? 'Cash',
                            account.is_archived ? 'Archived' : null,
                            linkedElsewhere ? 'Linked elsewhere' : null,
                          ].filter((part): part is string => part !== null)
                          return (
                            <label
                              key={account.id}
                              className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm transition-colors duration-150 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--app-accent-soft)]'}`}
                              style={{
                                borderTop: index === 0 ? 'none' : '1px solid var(--app-border)',
                                opacity: account.is_archived || linkedElsewhere ? 0.55 : 1,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={linked}
                                onChange={() => handleToggleAccount(account)}
                                disabled={disabled}
                                aria-label={`${linked ? 'Unlink' : 'Link'} ${account.name}`}
                                className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                                style={{ accentColor: 'var(--app-accent)' }}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{account.name}</span>
                                <span className="block truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
                                  {statusParts.join(' · ')}
                                </span>
                              </span>
                              <span className="font-financial text-sm">
                                {formatCurrency(account.current_balance, account.currency)}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}
