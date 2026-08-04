import { useState, type Dispatch, type SetStateAction } from 'react'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import {
  emptyScopedImportAnswers,
  readScopedImportAnswers,
  removeRecordKey,
  removeSetValue,
  writeScopedImportAnswers,
  type ScopedImportAnswers,
} from '@/pages/imports/utils'

/**
 * Account-create state shared by both import flows: the per-row type, currency and institution picked
 * when a mapping resolves to creating a new account, the batch bar's values, and the handler that
 * changes a row's mapping and clears its create-state when the row no longer creates an account
 */
export interface ImportAccountCreateState {
  accountCreateTypes: Record<string, string>
  accountCreateCurrencies: Record<string, string>
  accountCreateInstitutions: Record<string, string>
  selectedAccountRows: Set<string>
  batchAccountType: string
  batchAccountCurrency: string
  batchAccountInstitution: string
  setAccountCreateTypes: Dispatch<SetStateAction<Record<string, string>>>
  setAccountCreateCurrencies: Dispatch<SetStateAction<Record<string, string>>>
  setAccountCreateInstitutions: Dispatch<SetStateAction<Record<string, string>>>
  setSelectedAccountRows: Dispatch<SetStateAction<Set<string>>>
  setBatchAccountType: Dispatch<SetStateAction<string>>
  setBatchAccountCurrency: Dispatch<SetStateAction<string>>
  setBatchAccountInstitution: Dispatch<SetStateAction<string>>
  updateAccountMapping: (sourceAccount: string, accountId: string) => void
}

/**
 * Owns the account-create state both import flows carry alongside their own account mappings
 *
 * The mappings themselves stay with the caller, since each flow resolves them differently, so this
 * takes the caller's mappings setter and calls it from the shared handler that also clears a row's
 * create-state once it no longer creates an account
 *
 * @param setAccountMappings - The caller's own mappings setter
 * @param scope - What the answers were given for, so they are dropped rather than carried once the
 *   sources they were about are gone
 */
export function useImportAccountCreateState(
  setAccountMappings: Dispatch<SetStateAction<Record<string, string>>>,
  scope: string,
): ImportAccountCreateState {
  const [accountCreateTypes, setScopedAccountCreateTypes] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [accountCreateCurrencies, setScopedAccountCreateCurrencies] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [accountCreateInstitutions, setScopedAccountCreateInstitutions] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [selectedAccountRows, setSelectedAccountRows] = useState<Set<string>>(() => new Set())
  const [batchAccountType, setBatchAccountType] = useState('')
  const [batchAccountCurrency, setBatchAccountCurrency] = useState('')
  const [batchAccountInstitution, setBatchAccountInstitution] = useState('')

  /**
   * Wraps a scoped answer store as the plain record setter every table already takes
   */
  const scopedSetter = (
    setScoped: Dispatch<SetStateAction<ScopedImportAnswers<string>>>,
  ): Dispatch<SetStateAction<Record<string, string>>> => (update) => {
    setScoped((current) => {
      const answers = readScopedImportAnswers(current, scope)
      return writeScopedImportAnswers(scope, typeof update === 'function' ? update(answers) : update)
    })
  }

  const setAccountCreateTypes = scopedSetter(setScopedAccountCreateTypes)
  const setAccountCreateCurrencies = scopedSetter(setScopedAccountCreateCurrencies)
  const setAccountCreateInstitutions = scopedSetter(setScopedAccountCreateInstitutions)

  const updateAccountMapping = (sourceAccount: string, accountId: string) => {
    setAccountMappings((current) => ({ ...current, [sourceAccount]: accountId }))
    if (accountId !== CREATE_ACCOUNT_VALUE) {
      setAccountCreateTypes((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateCurrencies((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateInstitutions((current) => removeRecordKey(current, sourceAccount))
      setSelectedAccountRows((current) => removeSetValue(current, sourceAccount))
    }
  }

  return {
    accountCreateTypes: readScopedImportAnswers(accountCreateTypes, scope),
    accountCreateCurrencies: readScopedImportAnswers(accountCreateCurrencies, scope),
    accountCreateInstitutions: readScopedImportAnswers(accountCreateInstitutions, scope),
    selectedAccountRows,
    batchAccountType,
    batchAccountCurrency,
    batchAccountInstitution,
    setAccountCreateTypes,
    setAccountCreateCurrencies,
    setAccountCreateInstitutions,
    setSelectedAccountRows,
    setBatchAccountType,
    setBatchAccountCurrency,
    setBatchAccountInstitution,
    updateAccountMapping,
  }
}
