import { ApiError } from '@/api/auth/errors'
import {
  BANK_DISCOVERY_POLL_MS,
  BANK_LINKS_ACTIVE_POLL_MS,
  BANK_LINKS_IDLE_POLL_MS,
  UNANSWERED_CLAIM_POLL_MS,
  UNANSWERED_CLAIM_WATCH_MS,
} from '@/api/bank-sync/constants'
import type { BankConnection, BankLink } from '@/api/bank-sync/types'

/**
 * How often the connections are read: while one waits on a listing of its bank accounts, and for a
 * while after a claim the app didn't answer, so a connection the server saves after all shows
 *
 * @param connections - The connections as last read, undefined until read
 * @param claimUnansweredAt - When a claim last ended without the app's answer, in epoch milliseconds,
 * or null when none has
 * @param now - The current time, in epoch milliseconds
 */
export function getBankConnectionsPollInterval(
  connections: BankConnection[] | undefined,
  claimUnansweredAt: number | null,
  now: number,
): number | false {
  if (connections?.some((connection) => connection.discovery_pending)) return BANK_DISCOVERY_POLL_MS
  if (claimUnansweredAt !== null && now < claimUnansweredAt + UNANSWERED_CLAIM_WATCH_MS) return UNANSWERED_CLAIM_POLL_MS
  return false
}

/**
 * Whether the app is fetching for a link right now, by a sync or the next part of its import, or is
 * about to, for a due Sync now no worker has started yet. A sync running under a state shown over it,
 * such as a bank sign-in, counts too. An import or a Sync now waiting on the request budget is not,
 * so it is read at the slower pace until a request frees up
 */
function isLinkBusy(link: BankLink): boolean {
  return (
    link.sync.state === 'syncing' ||
    link.sync.state === 'importing' ||
    link.sync.sync_running ||
    link.sync.sync_requested
  )
}

/**
 * Whether the server refused the read, which asking again will not change, as against a failure on
 * the way there that the next attempt may not meet
 */
export function isRefusedRead(error: Error | null): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
}

/**
 * How often the link list is read while the tab is in view: quickly while a sync or import runs,
 * slowly while any link exists, and never for a user with no links
 *
 * Before the first read succeeds there are no links to go by, so a read that failed on the way is
 * tried again at the slow pace, while one the server refused is left alone
 */
export function getBankLinksPollInterval(links: BankLink[] | undefined, error: Error | null): number | false {
  if (!links) return error && !isRefusedRead(error) ? BANK_LINKS_IDLE_POLL_MS : false
  if (links.length === 0) return false
  return links.some(isLinkBusy) ? BANK_LINKS_ACTIVE_POLL_MS : BANK_LINKS_IDLE_POLL_MS
}

/**
 * Whether coming back to the tab reads the link list at once. A tab in the background doesn't poll,
 * so wherever the poll would read, the list is read on coming back however recently it last was, and
 * a change made meanwhile shows without waiting for the next tick. Where nothing polls, coming back
 * reads nothing either
 */
export function getBankLinksRefetchOnReturn(links: BankLink[] | undefined, error: Error | null): 'always' | false {
  return getBankLinksPollInterval(links, error) === false ? false : 'always'
}

/**
 * How long a read of the link list stays fresh: until the poll would read it again, so a screen
 * opening between polls takes the polled copy rather than asking again. Without links nothing
 * polls, and the slow pace stands in, so a link made on another device shows on the next screen
 * opened a minute later
 */
export function getBankLinksStaleTime(links: BankLink[] | undefined): number {
  return getBankLinksPollInterval(links, null) || BANK_LINKS_IDLE_POLL_MS
}
