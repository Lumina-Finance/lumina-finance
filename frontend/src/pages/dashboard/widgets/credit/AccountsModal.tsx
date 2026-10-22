import { useMemo, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { useReplaceCreditExcludedAccounts, type CreditUtilizationAccount } from '@/api/dashboard'
import { MultiSelectChecklist } from '@/components/filters/MultiSelectChecklist'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { resolveInstitutionLogoUrl } from '@/utils/institutionLogo'
import { humanizeAccountType } from '@/pages/accounts/detail/utils/formatAccountType'
import {
  getExcludedAccountIds,
  isExclusionChanged,
  toggleExcludedAccount,
} from '@/pages/dashboard/utils/creditAccountChoice'
import { LOADING_ANIMATION_MIN_MS, waitForMilliseconds } from '@/utils/timing'

type CreditAccountsModalProps = {
  open: boolean
  accounts: CreditUtilizationAccount[]
  onClose: () => void
}

const SAVE_ERROR_MESSAGE = 'Oops, something went wrong. Please try again.'

/**
 * Lets the user choose which credit accounts make up the dashboard credit utilization, saving the
 * accounts left unchecked so a card added later is included until it is left out
 */
export function CreditAccountsModal({ open, accounts, onClose }: CreditAccountsModalProps) {
  const replaceExcluded = useReplaceCreditExcludedAccounts()
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const serverExcluded = useMemo(() => getExcludedAccountIds(accounts), [accounts])
  const excluded = draft ?? serverExcluded
  const includedIds = useMemo(
    () => accounts.filter((account) => !excluded.has(account.id)).map((account) => account.id),
    [accounts, excluded],
  )
  const options = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: account.name,
        imageUrl: resolveInstitutionLogoUrl(account.institution),
        details: {
          type: humanizeAccountType(account.account_type),
          institution: account.institution?.name ?? null,
        },
      })),
    [accounts],
  )

  /**
   * Checks or unchecks one account in the draft, starting from what the server leaves out
   */
  function toggleAccount(id: string) {
    setSaveError(null)
    setDraft((current) => toggleExcludedAccount(current ?? serverExcluded, id))
  }

  /**
   * Saves the choice and closes, holding the saving state for the minimum loading time so it never flashes
   */
  async function handleSave() {
    if (isSaving) return
    if (!isExclusionChanged(serverExcluded, excluded)) {
      onClose()
      return
    }

    setIsSaving(true)
    const minimumLoading = waitForMilliseconds(LOADING_ANIMATION_MIN_MS)
    try {
      // A card deleted since the chooser opened is dropped, since the server refuses an account it can't find
      const accountIds = new Set(accounts.map((account) => account.id))
      await replaceExcluded.mutateAsync(Array.from(excluded).filter((id) => accountIds.has(id)))
      await minimumLoading
      onClose()
    } catch {
      await minimumLoading
      setSaveError(SAVE_ERROR_MESSAGE)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ModalTitledPanel
      open={open}
      titleId="credit-accounts-title"
      descriptionId="credit-accounts-description"
      eyebrow="Dashboard"
      title="Credit utilization"
      railLabel="Credit"
      RailIcon={CreditCard}
      closeDisabled={isSaving}
      onClose={onClose}
      // The draft is dropped once the modal has left the screen, so it never empties while fading out
      onExitComplete={() => {
        setDraft(null)
        setSaveError(null)
      }}
      footer={
        <ModalFormFooter
          submitLabel="Save"
          submitDisabled={isSaving}
          submitWidthClassName="w-full sm:w-28"
          error={saveError}
          onCancel={onClose}
          onPrimary={() => void handleSave()}
        />
      }
    >
      {/* The list takes the room left in the full-screen phone dialog and scrolls within it, and keeps a capped height once the dialog is sized by its content */}
      <div className="flex h-full flex-col">
        <div className="flex h-4 shrink-0 items-center justify-between gap-4">
          <p className="text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
            Accounts included
          </p>
          <span className="shrink-0 text-sm leading-none" style={{ color: 'var(--app-text-subtle)' }}>
            {includedIds.length} selected
          </span>
        </div>
        <p id="credit-accounts-description" className="mt-4 shrink-0 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          Choose the credit accounts that make up your utilization.
        </p>
        <div className="mt-3 flex min-h-0 flex-1 flex-col min-[750px]:max-h-72 min-[750px]:flex-none">
          <MultiSelectChecklist
            options={options}
            selectedValues={includedIds}
            searchPlaceholder="Search accounts"
            fillHeight
            onToggle={toggleAccount}
          />
        </div>
      </div>
    </ModalTitledPanel>
  )
}
