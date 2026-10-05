import { ApiError } from '@/api/auth/errors';
import { BANK_LINKS_ACTIVE_POLL_MS, BANK_LINKS_IDLE_POLL_MS } from '@/api/bank-sync/constants';
import type { AccountBankStatus, BankLink } from '@/api/bank-sync/types';

/**
 * Whether one of the user's jobs is working on a link right now, from a Sync now request until its
 * job finishes. An import waiting on the request budget is not, so it is read at the slower pace
 * until its next part starts
 */
function isLinkBusy(link: BankLink): boolean {
  return link.sync_in_progress || link.import?.state === 'running';
}

/**
 * Whether the server refused the read, which asking again will not change, as against a failure on
 * the way there that the next attempt may not meet
 */
export function isRefusedRead(error: Error | null): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/**
 * How often the link list is read: quickly while a sync or import runs, slowly while any link
 * exists, and never for a user with no links
 *
 * Before the first read succeeds there are no links to go by, so a read that failed on the way is
 * tried again at the slow pace, while one the server refused is left alone
 */
export function getBankLinksPollInterval(links: BankLink[] | undefined, error: Error | null): number | false {
  if (!links) return error && !isRefusedRead(error) ? BANK_LINKS_IDLE_POLL_MS : false;
  if (links.length === 0) return false;
  return links.some(isLinkBusy) ? BANK_LINKS_ACTIVE_POLL_MS : BANK_LINKS_IDLE_POLL_MS;
}

/**
 * How long a read of the link list stays fresh: until the poll would read it again, so a screen
 * opening between polls takes the polled copy rather than asking again. Without links nothing
 * polls, and the slow pace stands in, so a link made on another device shows on the next screen
 * opened a minute later
 */
export function getBankLinksStaleTime(links: BankLink[] | undefined): number {
  return getBankLinksPollInterval(links, null) || BANK_LINKS_IDLE_POLL_MS;
}

/**
 * How often an account's link is read while its page is open: quickly while its import runs, slowly
 * while the import waits, and not at all otherwise
 */
export function getAccountBankStatusPollInterval(status: AccountBankStatus | undefined): number | false {
  const state = status?.link?.import?.state;
  if (state === 'running') return BANK_LINKS_ACTIVE_POLL_MS;
  return state === 'waiting' || state === 'waiting_on_budget' ? BANK_LINKS_IDLE_POLL_MS : false;
}
