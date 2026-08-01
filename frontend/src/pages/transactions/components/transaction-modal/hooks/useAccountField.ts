import { useMemo, type Dispatch, type SetStateAction } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { Tag } from '@/api/tags'
import { OUTSIDE_ACCOUNT_VALUE } from '@/pages/transactions/components/transaction-modal/constants'
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
    () => buildOtherAccountOptions(accounts, form.account_id, form.symmetric_transfer),
    [accounts, form.account_id, form.symmetric_transfer],
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
      // The originating account wins, so empty the other field when it held the same account
      other_account_id: accountId === f.other_account_id ? '' : f.other_account_id,
      tag_ids: f.tag_ids.filter((tagId) => {
        const tag = tagById.get(tagId)
        return !tag || tag.group_id === null || tag.group_id === accountGroupId
      }),
    }))
    clearError('account_id')
    clearError('currency')
    clearError('other_account_id')
  }

  const handleSymmetricTransferChange = (value: boolean) => {
    setForm((f) => ({
      ...f,
      symmetric_transfer: value,
      // Outside the app is no longer offered once ticked, so an answer of that is dropped rather
      // than left selected against an option the list no longer holds
      other_account_id: value && f.other_account_id === OUTSIDE_ACCOUNT_VALUE ? '' : f.other_account_id,
    }))
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
    handleSymmetricTransferChange,
    handleOtherAccountChange,
  }
}
