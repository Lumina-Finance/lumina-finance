import type { AccountsOverview } from '@/api/accounts'
import { isValidMoneyInput, toMinorUnits } from '@/utils/moneyInput'
import type { FieldProblems } from '@/utils/refusedSubmit'

export const STARTING_BALANCE_INPUT_ID = 'new-account-starting-balance'
export const STARTING_BALANCE_ERROR_ID = 'new-account-starting-balance-error'

// A starting balance is zero or higher, so a hyphen or a true minus typed or pasted into the field
// is answered with a message rather than dropped without a word
export const MUST_BE_ZERO_OR_HIGHER_MESSAGE = 'Must be zero or higher'

export const STARTING_BALANCE_FIELDS = ['starting_balance'] as const
export const STARTING_BALANCE_CONTROL_IDS = { starting_balance: STARTING_BALANCE_INPUT_ID }

/**
 * What stops Continue from going ahead. The field refuses text holding a minus and keeps its value,
 * so a marked field holds the amount it had, and going ahead would record that instead of what was
 * typed. Only a prompt keeping the account manual shows the field, so choosing a bank link leaves it
 * out
 *
 * Text that isn't an amount, such as a point alone, is refused with the same message, as the Add
 * account dialogue refused it before the field moved here
 *
 * @param keepsManual - Whether the prompt is keeping the account manual, the only case that shows the field
 * @param typedMinus - Whether the field's last refused text held a minus
 * @param text - What the starting balance field holds
 */
export function getStartingBalanceProblems(
  keepsManual: boolean,
  typedMinus: boolean,
  text: string,
): FieldProblems<(typeof STARTING_BALANCE_FIELDS)[number]> {
  const refused = typedMinus || !isValidMoneyInput(text)
  return keepsManual && refused ? { starting_balance: MUST_BE_ZERO_OR_HIGHER_MESSAGE } : {}
}

/**
 * The request that records what the field holds, or null when it holds nothing to record
 *
 * A blank or zero balance is the balance the account already has. The amount goes as the user states
 * it, so a liability's is the amount owed, positive, and the backend saves it negated
 *
 * @param account - The new account to record the balance in
 * @param text - What the starting balance field holds
 * @param exponent - The account currency's minor-unit exponent
 */
export function buildStartingBalanceRequest(account: Pick<AccountsOverview, 'id'>, text: string, exponent: number) {
  const amount = toMinorUnits(text, exponent)

  return amount ? { accountId: account.id, payload: { amount } } : null
}
