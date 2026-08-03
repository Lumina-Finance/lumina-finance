import { useMemo, type Dispatch, type SetStateAction } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { Tag } from '@/api/tags'
import {
  buildAccountOptions,
  buildCounterpartyAccountOptions,
} from '@/pages/transactions/components/transaction-modal/utils/options'
import type {
  TransactionFormFieldErrors,
  TransactionFormValues,
} from '@/pages/transactions/components/transaction-modal/types'

interface UseAccountFieldOptions {
  accounts: AccountsOverview[]
  selectableAccounts: AccountsOverview[]
  editing: boolean
  selectedAccount: AccountsOverview | undefined
  form: TransactionFormValues
  setForm: Dispatch<SetStateAction<TransactionFormValues>>
  clearError: (field: keyof TransactionFormFieldErrors) => void
  tagById: Map<string, Pick<Tag, 'id' | 'group_id' | 'name'>>
}

interface AccountFieldState {
  accountOptions: { value: string; label: string }[]
  selectedArchivedAccountOption: { value: string; label: string } | undefined
  selectedArchivedCounterpartyAccountOption: { value: string; label: string } | undefined
  counterpartyAccountOptions: { value: string; label: string }[]
  handleAccountChange: (accountId: string) => void
  handleSymmetricTransferChange: (value: boolean) => void
  handleCounterpartyAccountChange: (accountId: string) => void
}

/**
 * Owns the originating and receiving account fields, including the symmetric-transfer toggle and
 * the tag-group filtering that runs when the originating account changes
 */
export function useAccountField({
  accounts,
  selectableAccounts,
  editing,
  selectedAccount,
  form,
  setForm,
  clearError,
  tagById,
}: UseAccountFieldOptions): AccountFieldState {
  const accountOptions = useMemo(
    () => buildAccountOptions(selectableAccounts, editing, form.currency),
    [selectableAccounts, editing, form.currency],
  )
  const counterpartyAccountOptions = useMemo(
    () => buildCounterpartyAccountOptions(accounts, form.account_id, form.symmetric_transfer),
    [accounts, form.account_id, form.symmetric_transfer],
  )
  const selectedArchivedAccountOption = editing && selectedAccount?.is_archived
    ? { value: selectedAccount.id, label: selectedAccount.name }
    : undefined

  // An account archived after the transfer was recorded is off the list above, so the stored answer
  // is supplied as its own option. Without it the field would read as unanswered, and every edit
  // now has to answer, so correcting anything else on the transaction would force the account to be
  // changed to one that is not where the money went
  const recordedCounterpartyAccount = accounts.find((account) => account.id === form.counterparty_account_id)
  const selectedArchivedCounterpartyAccountOption = editing && recordedCounterpartyAccount?.is_archived
    ? { value: recordedCounterpartyAccount.id, label: recordedCounterpartyAccount.name }
    : undefined

  const handleAccountChange = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId)
    const accountGroupId = account?.group_id ?? null
    setForm((f) => ({
      ...f,
      account_id: accountId,
      currency: account?.currency || '',
      // The originating account wins, so empty the counterparty field when it held the same account
      counterparty_account_id: accountId === f.counterparty_account_id ? '' : f.counterparty_account_id,
      tag_ids: f.tag_ids.filter((tagId) => {
        const tag = tagById.get(tagId)
        return !tag || tag.group_id === null || tag.group_id === accountGroupId
      }),
    }))
    clearError('account_id')
    clearError('currency')
    clearError('counterparty_account_id')
  }

  /** Reports whether an account can hold the matching transaction the ticked checkbox writes */
  const canReceivePairedTransaction = (accountId: string) =>
    accounts.some((account) => account.id === accountId && !account.is_archived)

  const handleSymmetricTransferChange = (value: boolean) => {
    setForm((f) => ({
      ...f,
      symmetric_transfer: value,
      // Ticking narrows the list to accounts that can take a real transaction, dropping both
      // outside the app and the archived ones, so an answer that is no longer on the list is
      // cleared rather than left selected against a missing option
      counterparty_account_id: value && !canReceivePairedTransaction(f.counterparty_account_id) ? '' : f.counterparty_account_id,
    }))
  }

  const handleCounterpartyAccountChange = (accountId: string) => {
    setForm((f) => ({ ...f, counterparty_account_id: accountId }))
    clearError('counterparty_account_id')
  }

  return {
    accountOptions,
    selectedArchivedAccountOption,
    selectedArchivedCounterpartyAccountOption,
    counterpartyAccountOptions,
    handleAccountChange,
    handleSymmetricTransferChange,
    handleCounterpartyAccountChange,
  }
}
