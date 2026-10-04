import type { ReactNode } from 'react'
import {
  ACCOUNTS_LOAD_FAILURE_EXPLANATION,
  ACCOUNTS_LOAD_FAILURE_TITLE,
  CREATED_ACCOUNT_BALANCE_NOTE,
  CREATED_ACCOUNT_CREDIT_LIMIT_NOTE,
  CREATED_ACCOUNT_EXPLANATION,
  CREATED_ACCOUNT_TITLE,
} from '@/pages/imports/constants'
import { ImportLoadFailure, ImportNotice } from './Primitives'

/**
 * What an account step shows in place of its tables: the retry when the account list failed to
 * load, then what it says while there are no sources, and otherwise its own content
 *
 * @param empty - Shown while there are no sources. Null where the step has already said why
 */
export function ImportAccountStepBody({
  accountsFailed,
  refetchAccounts,
  isEmpty,
  empty,
  children,
}: {
  accountsFailed: boolean
  refetchAccounts: () => unknown
  isEmpty: boolean
  empty: ReactNode
  children: ReactNode
}) {
  if (accountsFailed) {
    return (
      <ImportLoadFailure
        title={ACCOUNTS_LOAD_FAILURE_TITLE}
        description={ACCOUNTS_LOAD_FAILURE_EXPLANATION}
        onRetry={refetchAccounts}
      />
    )
  }

  return isEmpty ? empty : children
}

/**
 * Says what an account the import creates starts with, shown while any row is answered create
 *
 * Callers hold it back until the account list has landed, since every row rests on create until it
 * does, which would show the notice and then drop it once the names match
 *
 * @param explanation - Replaces the default wording, for an export whose accounts bring their own starting balances
 */
export function ImportCreatedAccountsNotice({
  explanation = CREATED_ACCOUNT_EXPLANATION,
  items = [CREATED_ACCOUNT_BALANCE_NOTE, CREATED_ACCOUNT_CREDIT_LIMIT_NOTE],
}: {
  explanation?: string
  items?: string[]
}) {
  return (
    <ImportNotice title={CREATED_ACCOUNT_TITLE} items={items}>
      {explanation}
    </ImportNotice>
  )
}
