import { ApiError } from '@/api/auth'

// What a failure shows when the server or the page gave no reason a user could use
const GENERAL_REASON = 'Something went wrong.'
const TIMEOUT_REASON = 'The server took too long to answer.'
const UNREACHABLE_REASON = "Couldn't reach the server."

/**
 * Says why a lookup the import page made failed, as the first sentence of a failure panel that
 * already has a title and a Try again button, so it never repeats either
 *
 * The server's own reason is shown where it gave one, with a full stop where it ends in no
 * punctuation. A validation refusal is the page's own wording for what it sent, since the fields the
 * server names mean nothing to a user. A timeout and a lost connection each get a sentence, and
 * every other failure, a server fault with no body or an answer that could not be read included,
 * gets the general one, since the browser's own wording for it means nothing to a user
 *
 * @param error - What the lookup rejected with
 * @param refusedReason - The sentence for the server refusing what the page sent
 */
export function getLoadFailureReason(error: unknown, refusedReason: string): string {
  if (error instanceof ApiError) {
    if (error.fieldErrors) return refusedReason
    const detail = error.detail?.trim()
    if (!detail) return GENERAL_REASON
    return /[.?!]$/.test(detail) ? detail : `${detail}.`
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') return TIMEOUT_REASON
  if (error instanceof TypeError) return UNREACHABLE_REASON
  return GENERAL_REASON
}
