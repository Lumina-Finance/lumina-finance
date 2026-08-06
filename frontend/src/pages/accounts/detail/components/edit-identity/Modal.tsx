import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  useDeleteAccount,
  useUpdateAccount,
  type Account,
} from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useCurrencyListState } from '@/hooks/useCurrencyListState'
import { useInstitutions, type Institution } from '@/api/institutions'
import { useInstitutionModal } from '@/hooks/useInstitutionModal'
import { useTaxAdvantagedCategories } from '@/api/tax-advantaged-categories'
import InstitutionModal from '@/components/reference-modals/InstitutionModal'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { ModalShell } from '@/components/modal/Shell'
import {
  DEFAULT_MINOR_UNIT_EXPONENT,
  findCurrencyExponent,
  fromMinorUnits,
} from '@/utils/moneyInput'
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
  open: boolean
  account: Account
  onClose: () => void
  /** Runs once the modal has finished leaving, which the page's own delete exit waits on */
  onExitComplete?: () => void
  onDeleteStarted: (account: Account) => void
  onDeleted: (account: Account) => void
  onDeleteFailed: () => void
}

// Set on the heading inside the header component, which the dialog is labelled by
const EDIT_ACCOUNT_IDENTITY_TITLE_ID = 'edit-account-identity-title'

const MIN_SAVE_SPINNER_MS = 800
const MIN_DELETE_SPINNER_MS = 1000

/**
 * Coordinates account identity edits, archive changes, and destructive deletion from one modal workflow
 *
 * Opens whether or not the currency table arrived. Everything except the credit limit is independent of
 * it, and that one field locks when the account's currency is missing from the table, since its
 * stored amount can only be read or written through that currency's decimal places
 */
export default function EditAccountIdentityModal({
  open,
  account,
  onClose,
  onExitComplete,
  onDeleteStarted,
  onDeleted,
  onDeleteFailed,
}: EditAccountIdentityModalProps) {
  const { data: currencies = [] } = useCurrencies()
  const currencyState = useCurrencyListState()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount({ minimumPendingMs: MIN_DELETE_SPINNER_MS })
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
  const institutionModal = useInstitutionModal(institutions)

  const isRevolving = account.account_kind === 'revolving'
  const canLinkTaxAdvantagedCategory = account.account_kind === 'asset' && account.group_id === null && !account.is_archived
  const selectedCurrencySymbol = currencies.find((currency) => currency.id === account.currency)?.symbol ?? ''
  const knownCreditLimitExponent = findCurrencyExponent(currencies, account.currency)
  const isCreditLimitLocked = isRevolving && knownCreditLimitExponent === null

  // The modal can open before the currency table arrives, which seeds the credit limit blank. Fill it in
  // when the table lands so the field does not sit editable and empty over a stored limit, which a save
  // would then clear. The field is disabled until this runs, so no typing can be overwritten
  const seededWithoutExponentRef = useRef(isCreditLimitLocked && account.credit_limit !== null)

  // Re-armed on each opening, since the form is reseeded then and may again be seeded before the table lands
  useEffect(() => {
    if (!open) return

    seededWithoutExponentRef.current = isCreditLimitLocked && account.credit_limit !== null
    // Only the opening matters here. Re-running as the table lands would re-arm the flag the fill-in below
    // has just cleared, and fill the field a second time over whatever was typed since
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (knownCreditLimitExponent === null || !seededWithoutExponentRef.current) return

    seededWithoutExponentRef.current = false
    setForm((current) => ({
      ...current,
      credit_limit: fromMinorUnits(account.credit_limit, knownCreditLimitExponent),
    }))
  }, [account.credit_limit, knownCreditLimitExponent])

  // The modal stays mounted between openings, so everything typed, failed or half-confirmed last time is
  // cleared on the way in. Without this, cancelling an edit and reopening shows the discarded values back.
  // Adjusting state during the render that opens it, rather than in an effect, keeps the reset in the same
  // render the fields first appear in, so no stale value is ever painted
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForm(createIdentityFormValues(account, currencies))
      setSubmitError(null)
      setDeleteError(null)
      setFieldErrors({})
      setDeleteStage('idle')
      setDeleteNameInput('')
      institutionModal.close()
    }
  }

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
   * Selects a newly created institution without leaving the edit modal, and leaves the
   * selection alone after a correction, which changes an institution rather than the choice
   */
  const handleInstitutionSaved = (institution: Institution) => {
    if (!institutionModal.institution) setField('institution_id', institution.id)
    institutionModal.close()
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

  return (
    <>
      <ModalShell
        open={open}
        onClose={requestClose}
        closeDisabled={isBusy}
        onExitComplete={onExitComplete}
        titleId={EDIT_ACCOUNT_IDENTITY_TITLE_ID}
        panelClassName="flex max-h-[84vh] w-full max-w-2xl overflow-hidden"
        level="stacked"
        animateHeight
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
                onCreateInstitution={institutionModal.openForCreate}
                onCorrectInstitution={institutionModal.openForCorrection}
              />

              {hasEditableAccountContext && (
                <AccountDetailsSection
                  form={form}
                  fieldErrors={fieldErrors}
                  canLinkTaxAdvantagedCategory={canLinkTaxAdvantagedCategory}
                  isRevolving={isRevolving}
                  currencyState={currencyState}
                  selectedCurrencySymbol={selectedCurrencySymbol}
                  creditLimitExponent={knownCreditLimitExponent ?? DEFAULT_MINOR_UNIT_EXPONENT}
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
      </ModalShell>
      <InstitutionModal
        key={institutionModal.key}
        open={institutionModal.open}
        initialName={institutionModal.name}
        institution={institutionModal.institution}
        onClose={institutionModal.close}
        onSaved={handleInstitutionSaved}
      />
    </>
  )
}
