import { useMemo, useState } from 'react'
import { Check, CreditCard } from 'lucide-react'
import { useReplaceCreditExcludedAccounts, type CreditUtilizationAccount } from '@/api/dashboard'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { InstitutionLogo } from '@/pages/accounts/components/InstitutionLogo'
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
  const [search, setSearch] = useState('')
  const includedCount = accounts.filter((account) => !excluded.has(account.id)).length
  const visibleAccounts = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return accounts
    return accounts.filter((account) =>
      `${account.name} ${account.institution?.name ?? ''}`.toLowerCase().includes(query),
    )
  }, [accounts, search])

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
        setSearch('')
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
      <div className="flex h-4 items-center justify-between gap-4">
        <p className="text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
          Accounts included
        </p>
        <span className="shrink-0 text-sm leading-none" style={{ color: 'var(--app-text-subtle)' }}>
          {includedCount} selected
        </span>
      </div>
      <p id="credit-accounts-description" className="mt-4 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
        Choose the credit accounts that make up your utilization.
      </p>
      <GlassSearchField
        value={search}
        onValueChange={setSearch}
        placeholder="Search accounts..."
        wrapperClassName="mt-3"
      />
      <div className="app-selection-list">
        {visibleAccounts.map((account) => (
          <CreditAccountOption
            key={account.id}
            account={account}
            selected={!excluded.has(account.id)}
            onToggle={toggleAccount}
          />
        ))}
        {visibleAccounts.length === 0 && (
          <p className="px-3 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
            No matching accounts.
          </p>
        )}
      </div>
    </ModalTitledPanel>
  )
}

/**
 * Renders one selectable credit account with its institution logo, name and type, cutting long text
 * off with an ellipsis so every row keeps one height
 */
function CreditAccountOption({
  account,
  selected,
  onToggle,
}: {
  account: CreditUtilizationAccount
  selected: boolean
  onToggle: (accountId: string) => void
}) {
  const metadata = `${humanizeAccountType(account.account_type)}${account.institution ? ` · ${account.institution.name}` : ''}`

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      className={`app-selection-option grid-cols-[1.25rem_1.5rem_minmax(0,1fr)] py-1 ${selected ? 'app-selection-option-active' : ''}`}
      onClick={() => onToggle(account.id)}
    >
      <span className={`app-selection-check ${selected ? 'app-selection-check-active' : ''}`}>
        <Check size={13} strokeWidth={3} aria-hidden />
      </span>
      {/* Decoration, so the row is named by the account and its type alone */}
      <span className="flex" aria-hidden>
        <InstitutionLogo institution={account.institution} variant="compact" />
      </span>
      <span className="min-w-0">
        <span className="block truncate leading-5">{account.name}</span>
        <span className="block truncate text-xs font-normal leading-4" style={{ color: 'var(--app-text-muted)' }}>
          {metadata}
        </span>
      </span>
    </button>
  )
}
