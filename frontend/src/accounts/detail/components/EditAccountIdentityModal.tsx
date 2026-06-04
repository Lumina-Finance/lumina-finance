import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, EyeOff, Pencil, Trash2, X } from 'lucide-react'
import {
  useDeleteAccount,
  useUpdateAccount,
  type Account,
} from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useInstitutions } from '@/api/institutions'
import { useTaxAdvantagedPlans } from '@/api/taxAdvantagedPlans'
import CreateInstitutionModal from '@/components/CreateInstitutionModal'
import Dropdown from '@/components/Dropdown'
import { EASE } from '@/accounts/detail/constants/accountDetail'
import { humanizeAccountType } from '@/accounts/detail/utils/formatAccountType'
import {
  formatMoneyInputLive,
  fromMinorUnits,
  isValidMoneyInput,
  sanitizeMoneyInput,
  toMinorUnits,
} from '@/accounts/detail/utils/moneyInput'
import { formatCurrency } from '@/utils/formatCurrency'

function FieldLabelRow({
  label,
  htmlFor,
  error,
}: {
  label: ReactNode
  htmlFor?: string
  error?: string
}) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <label htmlFor={htmlFor} className="app-label block shrink-0 text-[0.9375rem] leading-5">
        {label}
      </label>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key={error}
            className="text-right text-xs font-medium leading-5"
            style={{ color: 'var(--app-negative)' }}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.15 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

interface AccountIdentityForm {
  name: string
  institution_id: string
  tax_advantaged_plan_id: string
  credit_limit: string
  is_archived: boolean
}

type DeleteAccountStage = 'idle' | 'confirm' | 'type-name'
const MIN_SAVE_SPINNER_MS = 800
const MIN_DELETE_SPINNER_MS = 1000

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function ArchiveBalanceWarning({
  balance,
  currency,
}: {
  balance: number
  currency: string
}) {
  const adjustmentAmount = -balance
  const hasBalance = balance !== 0

  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        background: 'var(--app-warning-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      <div className="flex gap-2.5">
        <div
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ background: 'var(--app-bg)', color: 'var(--app-warning)' }}
        >
          <AlertTriangle size={13} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-5">Balance will be set to zero</p>
          <p className="mt-0.5 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
            {hasBalance
              ? `${formatCurrency(adjustmentAmount, currency)} will be recorded as a Balance Adjustment with note "Account archived". Unarchiving will not restore the previous balance.`
              : 'This account already has a zero balance, so no balance adjustment will be recorded.'}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function EditAccountIdentityModal({
  account,
  onClose,
  onDeleteStarted,
  onDeleted,
  onDeleteFailed,
}: {
  account: Account
  onClose: () => void
  onDeleteStarted: (account: Account) => void
  onDeleted: (account: Account) => void
  onDeleteFailed: () => void
}) {
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount({ minimumPendingMs: MIN_DELETE_SPINNER_MS })
  const { data: currencies = [] } = useCurrencies()
  const { data: institutions = [] } = useInstitutions()
  const { data: taxAdvantagedPlans = [] } = useTaxAdvantagedPlans()
  const [form, setForm] = useState<AccountIdentityForm>({
    name: account.name,
    institution_id: account.institution?.id ?? '',
    tax_advantaged_plan_id: account.tax_advantaged_plan_id ?? '',
    credit_limit: fromMinorUnits(account.credit_limit, currencies, account.currency),
    is_archived: account.is_archived,
  })
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof AccountIdentityForm, string>>>({})
  const [deleteStage, setDeleteStage] = useState<DeleteAccountStage>('idle')
  const [deleteNameInput, setDeleteNameInput] = useState('')
  const [saveDelayPending, setSaveDelayPending] = useState(false)
  const [institutionModalName, setInstitutionModalName] = useState('')
  const [showInstitutionModal, setShowInstitutionModal] = useState(false)
  const [institutionModalKey, setInstitutionModalKey] = useState(0)

  const isRevolving = account.account_kind === 'revolving'
  const canLinkTaxAdvantagedCategory = account.account_kind === 'asset' && account.group_id === null && !account.is_archived
  const selectedCurrencySymbol = currencies.find((currency) => currency.id === account.currency)?.symbol ?? ''

  const institutionOptions = useMemo(
    () => [
      { value: '', label: 'None' },
      ...institutions.map((institution) => ({ value: institution.id, label: institution.name })),
    ],
    [institutions],
  )

  const taxAdvantagedCategoryOptions = useMemo(
    () => [
      { value: '', label: 'None' },
      ...taxAdvantagedPlans
        .filter((plan) => plan.group_id === null && plan.currency === account.currency)
        .map((plan) => ({ value: plan.id, label: plan.name })),
    ],
    [account.currency, taxAdvantagedPlans],
  )

  const setField = <K extends keyof AccountIdentityForm>(field: K, value: AccountIdentityForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError(null)
  }

  const handleCreateInstitution = (name: string) => {
    setInstitutionModalName(name)
    setInstitutionModalKey((key) => key + 1)
    setShowInstitutionModal(true)
  }

  const handleInstitutionCreated = (institution: { id: string }) => {
    setField('institution_id', institution.id)
    setShowInstitutionModal(false)
  }

  const validate = () => {
    const errors: Partial<Record<keyof AccountIdentityForm, string>> = {}
    if (!form.name.trim()) errors.name = 'Name is required.'
    else if (form.name.trim().length > 256) errors.name = 'Name must be 256 characters or less.'
    if (isRevolving && !isValidMoneyInput(form.credit_limit)) {
      errors.credit_limit = 'Credit limit must be zero or higher.'
    }
    return errors
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy || deleteStage !== 'idle') return
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitError(null)
    setSaveDelayPending(true)
    const minimumDelay = wait(MIN_SAVE_SPINNER_MS)

    try {
      await updateAccount.mutateAsync({
        accountId: account.id,
        payload: {
          name: form.name.trim(),
          institution_id: form.institution_id || null,
          is_archived: form.is_archived,
          ...(isRevolving
            ? { credit_limit: toMinorUnits(form.credit_limit, currencies, account.currency) }
            : {}),
          ...(canLinkTaxAdvantagedCategory
            ? { tax_advantaged_plan_id: form.tax_advantaged_plan_id || null }
            : {}),
        },
      })
      await minimumDelay
      onClose()
    } catch (error) {
      await minimumDelay
      setSubmitError(error instanceof Error ? error.message : 'Failed to update account.')
      setSaveDelayPending(false)
    }
  }

  const handleStartDeleteAccount = () => {
    setField('is_archived', account.is_archived)
    setDeleteError(null)
    setDeleteStage('confirm')
  }

  const handleArchiveInstead = () => {
    setDeleteError(null)
    setDeleteNameInput('')
    setDeleteStage('idle')
    setField('is_archived', true)
  }

  const handleArchiveToggle = (checked: boolean) => {
    if (deleteStage !== 'idle') {
      setDeleteError(null)
      setDeleteNameInput('')
      setDeleteStage('idle')
    }
    setField('is_archived', checked)
  }

  const handleDeleteAccount = async () => {
    if (deleteNameInput !== account.name || isBusy) return
    setDeleteError(null)
    onDeleteStarted(account)

    try {
      await deleteAccount.mutateAsync(account.id)
      onDeleted(account)
    } catch (error) {
      onDeleteFailed()
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete account.')
    }
  }

  const deleteLoading = deleteAccount.isPending
  const saveLoading = (updateAccount.isPending && deleteStage === 'idle') || saveDelayPending
  const isBusy = updateAccount.isPending || saveDelayPending || deleteLoading
  const canDelete = deleteNameInput === account.name
  const hasEditableAccountContext = canLinkTaxAdvantagedCategory || isRevolving
  const visibilitySectionNumber = hasEditableAccountContext ? '03' : '02'
  const isArchiving = !account.is_archived && form.is_archived

  const requestClose = () => {
    if (isBusy) return
    onClose()
  }

  // While the modal is open, lock page scroll and let Escape use the same
  // close path as the visible close controls.
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isBusy, onClose])

  return (
    <>
      {createPortal(
        <>
            <motion.div
              className="fixed inset-0 z-[100]"
              style={{ background: 'rgba(0, 0, 0, 0.22)', backdropFilter: 'blur(6px)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={requestClose}
              aria-hidden
            />

            <motion.div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.22, ease: EASE }}
              onClick={requestClose}
            >
              <motion.div
                layout
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-account-identity-title"
                className="app-modal-panel flex max-h-[84vh] w-full max-w-2xl overflow-hidden rounded-2xl"
                style={{
                  background: 'var(--app-bg)',
                  border: '1px solid var(--app-border-strong)',
                  boxShadow: 'var(--app-shadow-soft)',
                }}
                transition={{ layout: { duration: 0.28, ease: EASE } }}
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className="hidden w-12 shrink-0 flex-col items-center justify-between py-5 min-[1050px]:flex"
                  style={{
                    background: 'var(--app-surface-soft)',
                    borderRight: '1px solid var(--app-border)',
                    color: 'var(--app-accent)',
                  }}
                  aria-hidden
                >
                  <Pencil size={18} strokeWidth={2} />
                  <span className="rotate-180 text-[0.6875rem] font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
                    Edit
                  </span>
                </div>

                <motion.form
                  layout
                  onSubmit={handleSubmit}
                  className="flex min-h-0 w-full flex-col"
                  noValidate
                  transition={{ layout: { duration: 0.28, ease: EASE } }}
                >
                  <div
                    className="shrink-0 pb-5 pl-4 pr-5 pt-6 min-[1050px]:px-7"
                    style={{ borderBottom: '1px solid var(--app-border)' }}
                  >
                    <div className="flex items-start justify-between gap-6">
                      <div className="min-w-0">
                        <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                          {humanizeAccountType(account.account_type)}
                        </p>
                        <h2 id="edit-account-identity-title" className="font-serif text-3xl font-light">
                          Edit Account
                        </h2>
                      </div>
                      <button type="button" onClick={requestClose} className="app-icon-button shrink-0" aria-label="Close" disabled={isBusy}>
                        <X size={20} aria-hidden />
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-7">
                    <div className="space-y-5">
                      <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
                        <div className="flex min-h-0 flex-col items-center">
                          <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
                            01
                          </span>
                          <span className="mt-1 w-px flex-1" style={{ backgroundColor: 'var(--app-border-strong)' }} aria-hidden />
                        </div>

                        <div className="min-w-0 space-y-3">
                          <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
                            Identity
                          </p>

                          <div>
                            <FieldLabelRow htmlFor="edit-account-name" label="Account Name" error={fieldErrors.name} />
                            <input
                              id="edit-account-name"
                              className={`app-input ${fieldErrors.name ? 'app-input-error' : ''}`}
                              value={form.name}
                              onChange={(event) => setField('name', event.target.value)}
                              maxLength={256}
                            />
                          </div>

                          <div>
                            <FieldLabelRow label="Institution" />
                            <Dropdown
                              options={institutionOptions}
                              value={form.institution_id}
                              onChange={(value) => setField('institution_id', value)}
                              placeholder="Select institution..."
                              searchable
                              searchPlaceholder="Search institutions..."
                              onCreateNew={handleCreateInstitution}
                              createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
                            />
                          </div>
                        </div>
                      </section>

                      {hasEditableAccountContext && (
                        <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
                          <div className="flex min-h-0 flex-col items-center">
                            <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
                              02
                            </span>
                            <span className="mt-1 w-px flex-1" style={{ backgroundColor: 'var(--app-border-strong)' }} aria-hidden />
                          </div>

                          <div className="min-w-0 space-y-3">
                            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
                              Details
                            </p>

                            {canLinkTaxAdvantagedCategory && (
                              <div>
                                <FieldLabelRow label="Tax-Advantaged Plan" />
                                <Dropdown
                                  options={taxAdvantagedCategoryOptions}
                                  value={form.tax_advantaged_plan_id}
                                  onChange={(value) => setField('tax_advantaged_plan_id', value)}
                                  placeholder="Select plan..."
                                  searchable
                                  searchPlaceholder="Search plans..."
                                />
                              </div>
                            )}

                            {isRevolving && (
                              <div>
                                <FieldLabelRow htmlFor="edit-credit-limit" label="Credit Limit" error={fieldErrors.credit_limit} />
                                <div className="relative">
                                  {selectedCurrencySymbol && (
                                    <span
                                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                                      style={{ color: 'var(--app-text-subtle)' }}
                                      aria-hidden
                                    >
                                      {selectedCurrencySymbol}
                                    </span>
                                  )}
                                  <input
                                    id="edit-credit-limit"
                                    className={`app-input ${selectedCurrencySymbol ? 'pl-8' : ''} ${fieldErrors.credit_limit ? 'app-input-error' : ''}`}
                                    inputMode="decimal"
                                    value={form.credit_limit}
                                    onChange={(event) => setField(
                                      'credit_limit',
                                      formatMoneyInputLive(sanitizeMoneyInput(event.target.value)),
                                    )}
                                    placeholder="Optional"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </section>
                      )}

                      <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
                        <div className="flex min-h-0 flex-col items-center">
                          <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
                            {visibilitySectionNumber}
                          </span>
                          <span className="mt-1 w-px flex-1" style={{ backgroundColor: 'var(--app-border-strong)' }} aria-hidden />
                        </div>

                        <div className="min-w-0 space-y-3">
                          <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
                            Archive
                          </p>

                          <label
                            htmlFor="edit-account-archived"
                            className="flex cursor-pointer items-center justify-between gap-4 rounded-xl p-4"
                            style={{
                              background: 'var(--app-input-bg)',
                              border: '1px solid var(--app-input-border)',
                            }}
                          >
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 font-medium">
                                <EyeOff size={16} style={{ color: 'var(--app-text-muted)' }} aria-hidden />
                                Archive account
                              </span>
                              <span className="mt-0.5 block text-sm" style={{ color: 'var(--app-text-muted)' }}>
                                Move this account out of active lists while keeping its history.
                              </span>
                            </span>
                            <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors">
                              <input
                                id="edit-account-archived"
                                type="checkbox"
                                role="switch"
                                checked={form.is_archived}
                                onChange={(event) => {
                                  handleArchiveToggle(event.target.checked)
                                }}
                                className="peer sr-only"
                              />
                              <span
                                className="absolute inset-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
                                style={{ background: form.is_archived ? 'var(--app-accent)' : 'var(--app-border-strong)' }}
                                aria-hidden
                              />
                              <span
                                className="relative h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                style={{ transform: form.is_archived ? 'translateX(1.25rem)' : 'translateX(0)' }}
                                aria-hidden
                              />
                            </span>
                          </label>

                          <AnimatePresence initial={false}>
                            {isArchiving && (
                              <motion.div
                                className="overflow-hidden"
                                initial={{ height: 0, marginTop: 0, opacity: 0 }}
                                animate={{ height: 'auto', marginTop: 12, opacity: 1 }}
                                exit={{ height: 0, marginTop: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: EASE }}
                              >
                                <ArchiveBalanceWarning balance={account.current_balance} currency={account.currency} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </section>

                      <AnimatePresence>
                        {submitError && (
                          <motion.p
                            className="text-sm font-medium"
                            style={{ color: 'var(--app-negative)' }}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.15 }}
                          >
                            {submitError}
                          </motion.p>
                        )}
                      </AnimatePresence>

                      <AnimatePresence initial={false}>
                        {deleteStage !== 'idle' && (
                          <motion.div
                            className="overflow-hidden"
                            initial={{ height: 0, marginTop: 0, opacity: 0 }}
                            animate={{ height: 'auto', marginTop: 20, opacity: 1 }}
                            exit={{ height: 0, marginTop: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: EASE }}
                          >
                            <motion.div
                              layout
                              className="rounded-lg px-3 py-2.5"
                              style={{
                                background: 'var(--app-negative-soft)',
                                border: '1px solid var(--app-border)',
                              }}
                              transition={{ duration: 0.22, ease: EASE }}
                            >
                              <div className="flex gap-2.5">
                                <div
                                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                                  style={{ background: 'var(--app-bg)', color: 'var(--app-negative)' }}
                                >
                                  <AlertTriangle size={13} aria-hidden />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="break-words text-sm font-semibold leading-5">
                                    Delete {account.name}?
                                  </p>
                                  <p className="mt-0.5 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                                    Permanent deletion removes its transactions, budgets, and balance history. Archive it instead
                                    if you only want it out of view.
                                  </p>

                                  <div className="mt-3 overflow-hidden">
                                    {deleteStage === 'confirm' ? (
                                      <motion.div
                                        key="confirm"
                                        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                                        initial={false}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.16, ease: EASE }}
                                      >
                                        {!account.is_archived ? (
                                          <button
                                            type="button"
                                            className="inline-flex items-center gap-2 text-sm font-medium"
                                            style={{ color: 'var(--app-text-muted)' }}
                                            onClick={handleArchiveInstead}
                                            disabled={isBusy}
                                          >
                                            <EyeOff size={15} aria-hidden />
                                            Archive instead
                                          </button>
                                        ) : (
                                          <span aria-hidden />
                                        )}
                                        <button
                                          type="button"
                                          className="app-danger-button justify-center sm:ml-auto"
                                          onClick={() => {
                                            setDeleteStage('type-name')
                                          }}
                                          disabled={isBusy}
                                        >
                                          Continue
                                        </button>
                                      </motion.div>
                                    ) : (
                                      <motion.div
                                        key="type-name"
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.18, ease: EASE }}
                                      >
                                        <label
                                          htmlFor="delete-account-name"
                                          className="mb-1.5 block break-words text-[0.9375rem]"
                                          style={{ color: 'var(--app-text-muted)' }}
                                        >
                                          Type <strong className="font-semibold">"{account.name}"</strong> to delete.
                                        </label>
                                        <input
                                          id="delete-account-name"
                                          className="app-input"
                                          value={deleteNameInput}
                                          onChange={(event) => {
                                            setDeleteNameInput(event.target.value)
                                            setDeleteError(null)
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key !== 'Enter') return
                                            event.preventDefault()
                                            handleDeleteAccount()
                                          }}
                                          disabled={isBusy}
                                          autoComplete="off"
                                        />

                                        {deleteError && (
                                          <p className="mt-3 text-[0.9375rem] font-medium" style={{ color: 'var(--app-negative)' }}>
                                            {deleteError}
                                          </p>
                                        )}

                                        <div className="mt-4 flex justify-end">
                                          <button
                                            type="button"
                                            className={`app-danger-button ${deleteLoading ? 'app-primary-button-loading' : ''}`}
                                            onClick={handleDeleteAccount}
                                            disabled={!canDelete || isBusy}
                                          >
                                            {deleteLoading ? <span className="app-spinner" /> : 'Delete account'}
                                          </button>
                                        </div>
                                      </motion.div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <div
                    className="flex shrink-0 items-center gap-3 px-6 py-4 sm:px-7 min-[1050px]:py-5"
                    style={{ borderTop: '1px solid var(--app-border)' }}
                  >
                    <button
                      type="button"
                      className="app-danger-button h-10 w-10 shrink-0 px-0"
                      onClick={handleStartDeleteAccount}
                      disabled={isBusy || deleteStage !== 'idle'}
                      aria-label="Delete account"
                      title="Delete account"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                    <div className="ml-auto flex items-center gap-3">
                      <button type="button" className="app-secondary-button" onClick={requestClose} disabled={isBusy}>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${saveLoading ? 'app-primary-button-loading' : 'w-36'}`}
                        disabled={isBusy || deleteStage !== 'idle'}
                      >
                        {saveLoading ? <span className="app-spinner" /> : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </motion.form>
              </motion.div>
            </motion.div>
        </>,
        document.body,
      )}
      <CreateInstitutionModal
        key={institutionModalKey}
        open={showInstitutionModal}
        initialName={institutionModalName}
        onClose={() => setShowInstitutionModal(false)}
        onCreated={handleInstitutionCreated}
      />
    </>
  )
}
