/**
 * Covers how often the signed-in app reads the bank link list, and how long a read stays fresh
 *
 * These tests catch a user with no links being polled, a running sync or import being read at the
 * slow pace so its progress lags, an import waiting on the request budget being read at the fast
 * pace for the hours it can wait, a refused read being asked again, a server failure taken for a
 * refusal and never asked again, either pace drifting from the two seconds and the minute the
 * feature promises, and a screen opening between polls reading the list again rather than taking
 * the polled copy
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/auth/errors';
import { BANK_LINKS_ACTIVE_POLL_MS, BANK_LINKS_IDLE_POLL_MS } from '@/api/bank-sync/constants';
import { getBankLinksPollInterval, getBankLinksStaleTime } from '@/api/bank-sync/polling';
import { createBankLink, createImportingBankLink } from './fixtures';

describe('bank link polling interval', () => {
  it.each([
    ['before the first read', undefined],
    ['for a user with no links', []],
  ])('does not poll %s', (_, links) => {
    expect(getBankLinksPollInterval(links, null)).toBe(false);
  });

  it('polls slowly while every link is idle', () => {
    expect(getBankLinksPollInterval([createBankLink(), createImportingBankLink('complete')], null))
      .toBe(BANK_LINKS_IDLE_POLL_MS);
  });

  it('polls quickly while any one link syncs', () => {
    expect(getBankLinksPollInterval([createBankLink(), createBankLink({ sync_in_progress: true })], null))
      .toBe(BANK_LINKS_ACTIVE_POLL_MS);
  });

  it('polls quickly while an import runs', () => {
    expect(getBankLinksPollInterval([createBankLink(), createImportingBankLink('running')], null))
      .toBe(BANK_LINKS_ACTIVE_POLL_MS);
  });

  it('polls slowly while an import waits on the request budget', () => {
    expect(getBankLinksPollInterval([createImportingBankLink('waiting_on_budget')], null)).toBe(BANK_LINKS_IDLE_POLL_MS);
  });

  it('tries a first read that failed on the way again at the slow pace, and leaves a refused one alone', () => {
    expect(getBankLinksPollInterval(undefined, new TypeError('Network unavailable'))).toBe(BANK_LINKS_IDLE_POLL_MS);
    expect(getBankLinksPollInterval(undefined, new ApiError('Not Found', 404))).toBe(false);
  });

  it('tries a first read the server failed on again at the slow pace, since that is not a refusal', () => {
    expect(getBankLinksPollInterval(undefined, new ApiError('Server error', 500))).toBe(BANK_LINKS_IDLE_POLL_MS);
  });

  it('reads every two seconds while a sync runs and every minute otherwise', () => {
    expect([BANK_LINKS_ACTIVE_POLL_MS, BANK_LINKS_IDLE_POLL_MS]).toEqual([2000, 60000]);
  });
});

describe('bank link freshness', () => {
  it('keeps a read fresh until the poll would read it again', () => {
    expect(getBankLinksStaleTime([createBankLink({ sync_in_progress: true })])).toBe(BANK_LINKS_ACTIVE_POLL_MS);
    expect(getBankLinksStaleTime([createBankLink()])).toBe(BANK_LINKS_IDLE_POLL_MS);
  });

  it('keeps a read with no links fresh for as long as an idle poll would', () => {
    expect(getBankLinksStaleTime([])).toBe(BANK_LINKS_IDLE_POLL_MS);
  });
});
