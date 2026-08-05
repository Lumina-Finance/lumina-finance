import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { CREATE_ACCOUNT_VALUE, UNSET_BATCH_INSTITUTION } from '@/pages/imports/constants'
import {
  emptyScopedImportAnswers,
  readScopedImportAnswers,
  readScopedSelection,
  removeRecordKey,
  removeSetValue,
  writeScopedImportAnswers,
  writeScopedSelection,
  type ImportSourceScope,
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

  /** Forgets every answer, including ones filed under a column that is not mapped right now */
  resetAccountCreateState: () => void
}

/**
 * Owns the account-create state both import flows carry alongside their own account mappings
 *
 * The mappings themselves stay with the caller, since each flow resolves them differently, so this
 * takes the caller's mappings setter and calls it from the shared handler that also clears a row's
 * create-state once it no longer creates an account
 *
 * @param setAccountMappings - The caller's own mappings setter
 * @param getSourceScope - What each source value was read from, so an answer is kept while that
 *   still holds and left behind once the same value comes from somewhere else
 */
export function useImportAccountCreateState(
  setAccountMappings: Dispatch<SetStateAction<Record<string, string>>>,
  getSourceScope: ImportSourceScope,
): ImportAccountCreateState {
  const [storedCreateTypes, setStoredCreateTypes] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [storedCreateCurrencies, setStoredCreateCurrencies] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [storedCreateInstitutions, setStoredCreateInstitutions] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [storedSelectedRows, setStoredSelectedRows] = useState<ScopedImportAnswers<true>>(emptyScopedImportAnswers)
  const [batchAccountType, setBatchAccountType] = useState('')
  const [batchAccountCurrency, setBatchAccountCurrency] = useState('')
  const [batchAccountInstitution, setBatchAccountInstitution] = useState(UNSET_BATCH_INSTITUTION)

  /**
   * Wraps a scoped answer store as the plain record setter every table already takes
   */
  const scopedSetter = (
    setStored: Dispatch<SetStateAction<ScopedImportAnswers<string>>>,
  ): Dispatch<SetStateAction<Record<string, string>>> => (update) => {
    setStored((current) => {
      const answers = readScopedImportAnswers(current, getSourceScope)
      return writeScopedImportAnswers(current, typeof update === 'function' ? update(answers) : update, getSourceScope)
    })
  }

  const setAccountCreateTypes = scopedSetter(setStoredCreateTypes)
  const setAccountCreateCurrencies = scopedSetter(setStoredCreateCurrencies)
  const setAccountCreateInstitutions = scopedSetter(setStoredCreateInstitutions)

  const setSelectedAccountRows: Dispatch<SetStateAction<Set<string>>> = (update) => {
    setStoredSelectedRows((current) => {
      const selection = readScopedSelection(current, getSourceScope)
      return writeScopedSelection(current, typeof update === 'function' ? update(selection) : update, getSourceScope)
    })
  }

  const updateAccountMapping = (sourceAccount: string, accountId: string) => {
    setAccountMappings((current) => ({ ...current, [sourceAccount]: accountId }))
    if (accountId !== CREATE_ACCOUNT_VALUE) {
      setAccountCreateTypes((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateCurrencies((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateInstitutions((current) => removeRecordKey(current, sourceAccount))
      setSelectedAccountRows((current) => removeSetValue(current, sourceAccount))
    }
  }

  // Held steady while the answers behind them are unchanged, since the three create records reach
  // the commit payload and the selection drives both mapping tables, and rebuilding any of them on
  // each render would put that work behind every keystroke on the page
  const accountCreateTypes = useMemo(
    () => readScopedImportAnswers(storedCreateTypes, getSourceScope),
    [getSourceScope, storedCreateTypes],
  )

  const accountCreateCurrencies = useMemo(
    () => readScopedImportAnswers(storedCreateCurrencies, getSourceScope),
    [getSourceScope, storedCreateCurrencies],
  )

  const accountCreateInstitutions = useMemo(
    () => readScopedImportAnswers(storedCreateInstitutions, getSourceScope),
    [getSourceScope, storedCreateInstitutions],
  )

  const selectedAccountRows = useMemo(
    () => readScopedSelection(storedSelectedRows, getSourceScope),
    [getSourceScope, storedSelectedRows],
  )

  const resetAccountCreateState = () => {
    setStoredCreateTypes(emptyScopedImportAnswers)
    setStoredCreateCurrencies(emptyScopedImportAnswers)
    setStoredCreateInstitutions(emptyScopedImportAnswers)
    setStoredSelectedRows(emptyScopedImportAnswers)
    setBatchAccountType('')
    setBatchAccountCurrency('')
    setBatchAccountInstitution(UNSET_BATCH_INSTITUTION)
  }

  return {
    accountCreateTypes,
    accountCreateCurrencies,
    accountCreateInstitutions,
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
    resetAccountCreateState,
  }
}
