import { useMemo, type Dispatch, type SetStateAction } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { Tag } from '@/api/tags'
import {
  buildAccountOptions,
  buildOtherAccountOptions,
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
  otherAccountOptions: { value: string; label: string }[]
  handleAccountChange: (accountId: string) => void
  handleToAccountChange: (accountId: string) => void
  handleSymmetricTransferChange: (value: boolean) => void
  handleOtherAccountChange: (accountId: string) => void
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
  const otherAccountOptions = useMemo(
    () => buildOtherAccountOptions(accounts, form.account_id, editing),
    [accounts, form.account_id, editing],
  )
  const selectedArchivedAccountOption = editing && selectedAccount?.is_archived
    ? { value: selectedAccount.id, label: selectedAccount.name }
    : undefined

  const handleAccountChange = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId)
    const accountGroupId = account?.group_id ?? null
    setForm((f) => ({
      ...f,
      account_id: accountId,
      currency: account?.currency || '',
      // The originating account wins, so empty the receiving field when it held the same account
      to_account_id: accountId === f.to_account_id ? '' : f.to_account_id,
      // Same reasoning for the recorded-other-account field: it cannot point at its own transaction
      other_account_id: accountId === f.other_account_id ? '' : f.other_account_id,
      tag_ids: f.tag_ids.filter((tagId) => {
        const tag = tagById.get(tagId)
        return !tag || tag.group_id === null || tag.group_id === accountGroupId
      }),
    }))
    clearError('account_id')
    clearError('currency')
    clearError('to_account_id')
    clearError('other_account_id')
  }

  const handleToAccountChange = (accountId: string) => {
    setForm((f) => ({
      ...f,
      to_account_id: accountId,
      // The receiving account wins, so empty the originating field when it held the same account
      account_id: accountId === f.account_id ? '' : f.account_id,
      // Choosing a receiving account fills what this leg records too. The field stays editable
      // afterward and is not forced back into agreement if it is then changed
      other_account_id: accountId,
    }))
    clearError('to_account_id')
    clearError('other_account_id')
  }

  const handleSymmetricTransferChange = (value: boolean) => {
    setForm((f) => ({ ...f, symmetric_transfer: value }))
    // The receiving-account field disappears when unticked, so its error goes with it. The
    // other-account field stays on screen either way, so ticking does not touch its error
    if (!value) clearError('to_account_id')
  }

  const handleOtherAccountChange = (accountId: string) => {
    setForm((f) => ({ ...f, other_account_id: accountId }))
    clearError('other_account_id')
  }

  return {
    accountOptions,
    selectedArchivedAccountOption,
    otherAccountOptions,
    handleAccountChange,
    handleToAccountChange,
    handleSymmetricTransferChange,
    handleOtherAccountChange,
  }
}
