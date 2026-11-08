import { holdsMinus, toMinorUnits } from '@/utils/moneyInput'

// The messages share the label's line, as the new-account prompt's does, so they stay short enough to
// fit beside it on a phone and the field never moves when one shows

/** What Record adjustment says for a blank or zero amount, since such an amount records nothing */
export const ZERO_AMOUNT_MESSAGE = 'Enter more than zero'

/** What the amount says when a sign is typed or pasted into it. It refuses the sign, since the offer's sign stands beside it */
export const SIGNED_AMOUNT_MESSAGE = 'Leave out the sign'

/** What an answer the server didn't give says, while one it refused gives the server's reason */
export const ANSWER_FAILED_MESSAGE = 'Oops, something went wrong. Please try again.'

/**
 * The offer's sign in words, for the amount's description, since the sign beside the field is drawn
 *
 * @param offered - The offered amount in minor units, signed as the ledger keeps them, never zero
 */
export function describeSign(offered: number): string {
  return offered < 0 ? 'Your ledger records this amount as negative.' : 'Your ledger records this amount as positive.'
}

/**
 * Whether text typed or pasted into the amount holds a sign. The amount refuses it since the
 * offer's sign stands beside it
 *
 * @param text - The field's text as typed, before the field refuses it
 */
export function holdsSign(text: string): boolean {
  return holdsMinus(text) || text.includes('+')
}

/** What a press of Record adjustment finds: a reason to refuse, or the amount to record */
export type RecordingReading = { refusal: string } | { amount: number }

/**
 * Reads what a press of Record adjustment does. It refuses while the amount shows its message for a
 * sign, since the field still holds the amount it kept and recording that would go ahead on a field
 * marked as wrong, and refuses a blank or zero amount
 *
 * @param shownMessage - The message beside the amount now, or null when it shows none
 * @param value - The field's money value
 * @param exponent - Decimal places of the account's currency
 * @param offered - The offered amount in minor units, signed as the ledger keeps them
 */
export function readRecording(
  shownMessage: string | null,
  value: string,
  exponent: number,
  offered: number,
): RecordingReading {
  if (shownMessage === SIGNED_AMOUNT_MESSAGE) return { refusal: SIGNED_AMOUNT_MESSAGE }

  const amount = readRecordedAmount(value, exponent, offered)
  return amount === null ? { refusal: ZERO_AMOUNT_MESSAGE } : { amount }
}

/**
 * What is wrong with the amount right now, or undefined when Record adjustment may go ahead. It is the
 * form's one source of problems for a refused press, so it stays until the amount is fixed
 *
 * @param shownMessage - The message beside the amount now, or null when it shows none
 * @param value - The field's money value
 * @param exponent - Decimal places of the account's currency
 * @param offered - The offered amount in minor units, signed as the ledger keeps them
 */
export function getRecordingProblem(
  shownMessage: string | null,
  value: string,
  exponent: number,
  offered: number,
): string | undefined {
  const reading = readRecording(shownMessage, value, exponent, offered)
  return 'refusal' in reading ? reading.refusal : undefined
}

/**
 * The amount an answer records, signed as the offer is, or null for one that is blank or zero
 *
 * The field holds only the amount's size, with the offer's sign shown beside it, so an amount typed
 * over the offered one closes the same gap by a different amount
 *
 * @param value - The field's money value
 * @param exponent - Decimal places of the account's currency
 * @param offered - The offered amount in minor units, signed as the ledger keeps them
 */
export function readRecordedAmount(value: string, exponent: number, offered: number): number | null {
  const size = toMinorUnits(value, exponent)
  if (!size) return null
  return offered < 0 ? -size : size
}
