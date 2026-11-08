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
 * @param keepsManual - Whether the prompt is keeping the account manual, which shows the field
 * @param typedMinus - Whether the field's last refused text held a minus
 */
export function getStartingBalanceProblems(
  keepsManual: boolean,
  typedMinus: boolean,
): FieldProblems<(typeof STARTING_BALANCE_FIELDS)[number]> {
  return keepsManual && typedMinus ? { starting_balance: MUST_BE_ZERO_OR_HIGHER_MESSAGE } : {}
}
