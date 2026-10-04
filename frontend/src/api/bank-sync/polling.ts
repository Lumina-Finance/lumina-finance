import { BANK_LINKS_ACTIVE_POLL_MS, BANK_LINKS_IDLE_POLL_MS } from '@/api/bank-sync/constants';
import type { BankLink } from '@/api/bank-sync/types';

/**
 * Whether one of the user's jobs is working on a link right now. An import waiting on the request
 * budget is not, so it is read at the slower pace until its next part starts
 */
function isLinkBusy(link: BankLink): boolean {
  return link.sync_in_progress || link.import?.state === 'running';
}

/**
 * How often the link list is read: quickly while a sync or import runs, slowly while any link
 * exists, and never for a user with no links
 */
export function getBankLinksPollInterval(links: BankLink[] | undefined): number | false {
  if (!links || links.length === 0) return false;
  return links.some(isLinkBusy) ? BANK_LINKS_ACTIVE_POLL_MS : BANK_LINKS_IDLE_POLL_MS;
}
