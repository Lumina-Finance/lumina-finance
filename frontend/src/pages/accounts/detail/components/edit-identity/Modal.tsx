import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  useDeleteAccount,
  useUpdateAccount,
  type Account,
} from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useInstitutions } from '@/api/institutions'
import { useTaxAdvantagedCategories } from '@/api/taxAdvantagedCategories'
import CreateInstitutionModal from '@/components/reference-modals/CreateInstitutionModal'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { useModalFieldFocus } from '@/components/modal/useModalFieldFocus'
import { waitForMilliseconds } from '@/utils/timing'
import { EASE } from '@/pages/accounts/detail/constants/accountDetail'
import {
  createIdentityFormValues,
  getIdentityFieldErrors,
  getIdentityUpdatePayload,
  type IdentityFieldErrors,
  type IdentityFormValues,
} from '@/pages/accounts/detail/utils/identityForm'
import { AccountArchiveSection } from './sections/ArchiveSection'
import { DeleteAccountPanel } from './sections/DeletePanel'
import { AccountDetailsSection } from './sections/DetailsSection'
import { EditModalFooter } from './layout/Footer'
import { EditModalHeader } from './layout/Header'
import { EditModalSideRail } from './layout/SideRail'
import { AccountIdentitySection } from './sections/IdentitySection'
import type { DeleteStage } from './types'

type EditAccountIdentityModalProps = {
  account: Account
  onClose: () => void
  onDeleteStarted: (account: Account) => void
  onDeleted: (account: Account) => void
  onDeleteFailed: () => void
}

const MIN_SAVE_SPINNER_MS = 800
const MIN_DELETE_SPINNER_MS = 1000

/**
 * Coordinates account identity edits, archive changes, and destructive deletion from one modal workflow
 */
export default function EditAccountIdentityModal({
  account,
  onClose,
  onDeleteStarted,
  onDeleted,
  onDeleteFailed,
}: EditAccountIdentityModalProps) {
  const { panelRef, handleModalFieldKeyDown } = useModalFieldFocus()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount({ minimumPendingMs: MIN_DELETE_SPINNER_MS })
  const { data: currencies = [] } = useCurrencies()
  const { data: institutions = [] } = useInstitutions()
  const { data: taxAdvantagedCategories = [] } = useTaxAdvantagedCategories()
  const [form, setForm] = useState<IdentityFormValues>(() => (
    createIdentityFormValues(account, currencies)
  ))
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<IdentityFieldErrors>({})
  const [deleteStage, setDeleteStage] = useState<DeleteStage>('idle')
  const [deleteNameInput, setDeleteNameInput] = useState('')
  const [saveDelayPending, setSaveDelayPending] = useState(false)
  const [institutionModalName, setInstitutionModalName] = useState('')
  const [showInstitutionModal, setShowInstitutionModal] = useState(false)
  const [institutionModalKey, setInstitutionModalKey] = useState(0)

  const isRevolving = account.account_kind === 'revolving'
  const canLinkTaxAdvantagedCategory = account.account_kind === 'asset' && account.group_id === null && !account.is_archived
  const selectedCurrencySymbol = currencies.find((currency) => currency.id === account.currency)?.symbol ?? ''

  const institutionOptions = useMemo<DropdownOption[]>(
    () => [
      { value: '', label: 'None' },
      ...institutions.map((institution) => ({ value: institution.id, label: institution.name })),
    ],
    [institutions],
  )

  const taxAdvantagedCategoryOptions = useMemo<DropdownOption[]>(
    () => [
      { value: '', label: 'None' },
      ...taxAdvantagedCategories
        .filter((plan) => plan.group_id === null && plan.currency === account.currency)
        .map((plan) => ({ value: plan.id, label: plan.name })),
    ],
    [account.currency, taxAdvantagedCategories],
  )

  /**
   * Updates one form field and clears stale validation tied to that field
   */
  const setField = <K extends keyof IdentityFormValues>(field: K, value: IdentityFormValues[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError(null)
  }

  /**
   * Opens the create-institution modal from the current dropdown search text
   */
  const handleCreateInstitution = (name: string) => {
    setInstitutionModalName(name)
    setInstitutionModalKey((key) => key + 1)
    setShowInstitutionModal(true)
  }

  /**
   * Selects a newly created institution without leaving the edit modal
   */
  const handleInstitutionCreated = (institution: { id: string }) => {
    setField('institution_id', institution.id)
    setShowInstitutionModal(false)
  }

  /**
   * Validates the form, submits the allowed account fields, and holds the save spinner briefly
   */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy || deleteStage !== 'idle') return
    const errors = getIdentityFieldErrors(form, isRevolving)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitError(null)
    setSaveDelayPending(true)
    const minimumDelay = waitForMilliseconds(MIN_SAVE_SPINNER_MS)

    try {
      await updateAccount.mutateAsync({
        accountId: account.id,
        payload: getIdentityUpdatePayload({
          form,
          isRevolving,
          canLinkTaxAdvantagedCategory,
          currencies,
          accountCurrency: account.currency,
        }),
      })
      await minimumDelay
      onClose()
    } catch (error) {
      await minimumDelay
      setSubmitError(error instanceof Error ? error.message : 'Failed to update account.')
      setSaveDelayPending(false)
    }
  }

  /**
   * Starts the delete confirmation flow and restores the archive toggle to its persisted state
   */
  const handleStartDeleteAccount = () => {
    setField('is_archived', account.is_archived)
    setDeleteError(null)
    setDeleteStage('confirm')
  }

  /**
   * Converts a delete intent into an archive edit so the form remains the source of the pending change
   */
  const handleArchiveInstead = () => {
    setDeleteError(null)
    setDeleteNameInput('')
    setDeleteStage('idle')
    setField('is_archived', true)
  }

  /**
   * Cancels an in-progress delete flow when the user changes archive state directly
   */
  const handleArchiveToggle = (checked: boolean) => {
    if (deleteStage !== 'idle') {
      setDeleteError(null)
      setDeleteNameInput('')
      setDeleteStage('idle')
    }
    setField('is_archived', checked)
  }

  /**
   * Deletes the account only after the typed confirmation matches the current account name
   */
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

  /**
   * Blocks closing while a mutation is pending so user intent and network state cannot diverge
   */
  const requestClose = () => {
    if (isBusy) return
    onClose()
  }

  // Modal side effects stay here so section components remain render-only
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
              ref={panelRef}
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
              onKeyDown={handleModalFieldKeyDown}
            >
              <EditModalSideRail />

              <motion.form
                layout
                onSubmit={handleSubmit}
                className="flex min-h-0 w-full flex-col"
                noValidate
                transition={{ layout: { duration: 0.28, ease: EASE } }}
              >
                <EditModalHeader
                  accountType={account.account_type}
                  isBusy={isBusy}
                  onClose={requestClose}
                />

                <div className="min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-7">
                  <div className="space-y-5">
                    <AccountIdentitySection
                      form={form}
                      fieldErrors={fieldErrors}
                      institutionOptions={institutionOptions}
                      setField={setField}
                      onCreateInstitution={handleCreateInstitution}
                    />

                    {hasEditableAccountContext && (
                      <AccountDetailsSection
                        form={form}
                        fieldErrors={fieldErrors}
                        canLinkTaxAdvantagedCategory={canLinkTaxAdvantagedCategory}
                        isRevolving={isRevolving}
                        selectedCurrencySymbol={selectedCurrencySymbol}
                        taxAdvantagedCategoryOptions={taxAdvantagedCategoryOptions}
                        setField={setField}
                      />
                    )}

                    <AccountArchiveSection
                      sectionNumber={visibilitySectionNumber}
                      isArchived={form.is_archived}
                      isArchiving={isArchiving}
                      currentBalance={account.current_balance}
                      currency={account.currency}
                      onToggle={handleArchiveToggle}
                    />

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

                    <DeleteAccountPanel
                      account={account}
                      deleteStage={deleteStage}
                      deleteNameInput={deleteNameInput}
                      deleteError={deleteError}
                      deleteLoading={deleteLoading}
                      isBusy={isBusy}
                      canDelete={canDelete}
                      onArchiveInstead={handleArchiveInstead}
                      onContinue={() => {
                        setDeleteStage('type-name')
                      }}
                      onDelete={handleDeleteAccount}
                      onNameChange={(value) => {
                        setDeleteNameInput(value)
                        setDeleteError(null)
                      }}
                    />
                  </div>
                </div>

                <EditModalFooter
                  deleteStage={deleteStage}
                  isBusy={isBusy}
                  saveLoading={saveLoading}
                  onCancel={requestClose}
                  onStartDelete={handleStartDeleteAccount}
                />
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
