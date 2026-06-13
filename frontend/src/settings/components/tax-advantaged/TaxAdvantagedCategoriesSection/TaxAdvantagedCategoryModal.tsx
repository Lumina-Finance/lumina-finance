import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Trash2, X } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import type {
  AutosaveNotice,
  CategoryModalTab,
} from '@/settings/components/tax-advantaged/taxAdvantagedTypes'
import TaxAdvantagedAccountLinksPanel from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedAccountLinksPanel'
import AutosaveStatusIcon from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/AutosaveStatusIcon'
import InfoItem from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/InfoItem'
import TaxAdvantagedCategoryDetailsModal from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedCategoryDetailsModal'
import TaxAdvantagedLimitDetailsModal from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedLimitDetailsModal'
import TaxAdvantagedLimitsPanel from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedLimitsPanel'
import { useTaxAdvantagedAccountLinks } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/hooks/useTaxAdvantagedAccountLinks'
import { useTaxAdvantagedCategoryDetailsForm } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/hooks/useTaxAdvantagedCategoryDetailsForm'
import { useTaxAdvantagedLimitWorkflow } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/hooks/useTaxAdvantagedLimitWorkflow'
import { autosaveNoticeColor } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedAutosave'
import { formatTaxTreatment } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedCategoryUtils'
import { TaxAdvantagedCurrencyWarning } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedFormControls'

/**
 * Renders the TAC management modal shell with details, limit, and account workflows
 */
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
  const planDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const planDeleteIdleLabelRef = useRef<HTMLSpanElement>(null)
  const planDeleteConfirmLabelRef = useRef<HTMLSpanElement>(null)
  const limitDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const limitDeleteIdleLabelRef = useRef<HTMLSpanElement>(null)
  const limitDeleteConfirmLabelRef = useRef<HTMLSpanElement>(null)
  const [planDeleteLabelWidths, setPlanDeleteLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const [limitDeleteLabelWidths, setLimitDeleteLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const [autosaveNotice, setAutosaveNotice] = useState<AutosaveNotice | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)

  /**
   * Shows the floating autosave notice and clears completed notices after a short delay
   */
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
    closeLimitDetailsModal,
    createNewLimit: handleCreateLimit,
    creatingLimit,
    deleteConfirmYear,
    deleteSelectedLimit: handleDeleteLimit,
    hasLifetimePriorActivity,
    hasScrollableLimitRows,
    limitError,
    limitsLoading,
    newLimitForm,
    pendingDeleteLimitYear,
    resetLimitSelection,
    saveLimit: handleSaveLimit,
    selectLimitYear,
    selectedDraft,
    selectedLimit,
    selectedLimitDeleteConfirming,
    selectedLimitDeleting,
    selectedLimitDirty,
    selectedSavingLimit,
    setLimitField,
    setNewLimitField,
    showAddTaxYear,
    sortedLimits,
    startNewLimitForm,
  } = useTaxAdvantagedLimitWorkflow({
    currencies,
    limitDeleteButtonRef,
    plan,
    showAutosaveNotice,
  })
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

  /**
   * Opens category details while closing any active annual limit editor
   */
  const openCategoryDetailsModal = () => {
    if (!openDetails()) return
    resetLimitSelection()
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
                  <TaxAdvantagedLimitsPanel
                    deleteConfirmYear={deleteConfirmYear}
                    hasLifetimePriorActivity={hasLifetimePriorActivity}
                    hasScrollableLimitRows={hasScrollableLimitRows}
                    limitDeleteButtonRef={limitDeleteButtonRef}
                    limitDeleteConfirmLabelRef={limitDeleteConfirmLabelRef}
                    limitDeleteIdleLabelRef={limitDeleteIdleLabelRef}
                    limitDeleteLabelWidths={limitDeleteLabelWidths}
                    limitError={limitError}
                    limitsLoading={limitsLoading}
                    onDeleteLimit={(limit) => { void handleDeleteLimit(limit) }}
                    onSelectLimitYear={selectLimitYear}
                    onStartNewLimitForm={startNewLimitForm}
                    pendingDeleteLimitYear={pendingDeleteLimitYear}
                    plan={plan}
                    selectedLimitYear={selectedLimit?.year ?? null}
                    showAddTaxYear={showAddTaxYear}
                    sortedLimits={sortedLimits}
                  />
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
