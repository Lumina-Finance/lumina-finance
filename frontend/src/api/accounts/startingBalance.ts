import { ApiError, isAnsweredByApp } from '@/api/auth/errors'
import { fetchAccount, recordStartingBalance } from '@/api/accounts/requests'
import type { Account } from '@/api/accounts/types'

// A second save is refused with this once the first has landed. That is how a save sent again
// after an unanswered one finds out it had been saved after all. Reading the account tells that
// refusal from any other with the same status, so the backend's wording isn't relied on
const REFUSED_STATUS = 422

/** A save ended with no answer and the account shows it didn't land, so it can be sent again as it is */
export class StartingBalanceNotSavedError extends Error {
  constructor() {
    super('The starting balance was not saved')
    this.name = 'StartingBalanceNotSavedError'
  }
}

/** A save ended with no answer and the account couldn't be read either, so whether it landed is unknown */
export class StartingBalanceUnsettledError extends Error {
  constructor() {
    super('Whether the starting balance was saved is unknown')
    this.name = 'StartingBalanceUnsettledError'
  }
}

function isRefused(error: unknown): boolean {
  return error instanceof ApiError && error.status === REFUSED_STATUS
}

/**
 * Records a starting balance and settles a save that ended with no answer by reading the account
 *
 * The account is new and the balance its only entry, so the account holding exactly that balance
 * means the save landed, and it is then answered as a save. A save sent again after one that did
 * land is refused for the transactions the account now has, so a refusal is settled the same way,
 * and passed on as it is when the account doesn't hold the balance
 *
 * @param variables - The account and the balance as the user states it
 * @returns The account with the starting balance, whether this save or an earlier one recorded it
 * @throws StartingBalanceNotSavedError when the save ended with no answer and didn't land
 * @throws StartingBalanceUnsettledError when the account couldn't be read to tell
 */
export async function recordStartingBalanceSettled(
  variables: Parameters<typeof recordStartingBalance>[0],
): Promise<Account> {
  try {
    return await recordStartingBalance(variables)
  } catch (error) {
    const unanswered = !isAnsweredByApp(error)
    if (!unanswered && !isRefused(error)) throw error

    let account: Account
    try {
      account = await fetchAccount(variables.accountId)
    } catch {
      if (unanswered) throw new StartingBalanceUnsettledError()
      throw error
    }

    const { amount } = variables.payload
    if (account.current_balance === (account.account_kind === 'asset' ? amount : -amount)) return account
    if (unanswered) throw new StartingBalanceNotSavedError()
    throw error
  }
}
