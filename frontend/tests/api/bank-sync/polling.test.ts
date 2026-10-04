/**
 * Covers how often the signed-in app reads the bank link list
 *
 * These tests catch a user with no links being polled, a running sync or import being read at the
 * slow pace so its progress lags, and an import waiting on the request budget being read at the
 * fast pace for the hours it can wait
 */
import { describe, expect, it } from 'vitest';
import { BANK_LINKS_ACTIVE_POLL_MS, BANK_LINKS_IDLE_POLL_MS } from '@/api/bank-sync/constants';
import { getBankLinksPollInterval } from '@/api/bank-sync/polling';
import type { BankImportState, BankLink } from '@/api/bank-sync/types';

function createBankLink(overrides: Partial<BankLink> = {}): BankLink {
  return {
    account_id: 'account-1',
    connection_id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_account_id: 'bank-account-1',
    external_account_name: 'Chequing',
    institution_name: 'Example Bank',
    import_start: '2026-01-01',
    linked_at: '2026-09-01T12:00:00Z',
    import: null,
    history_reminder: null,
    last_success_at: '2026-09-30T12:00:00Z',
    last_attempt: null,
    next_attempt_at: '2026-10-01T00:00:00Z',
    waiting_on_budget: false,
    sync_in_progress: false,
    action_needed: null,
    waiting_new_count: 0,
    review_warning: false,
    paused: false,
    balance: null,
    ...overrides,
  };
}

function withImport(state: BankImportState): BankLink {
  return createBankLink({
    account_id: 'account-2',
    import: {
      kind: 'initial',
      state,
      requested_start: '2025-01-01',
      windows_total: 6,
      windows_done: 2,
      items_found: 40,
      earliest_returned_date: null,
    },
  });
}

describe('bank link polling interval', () => {
  it.each([
    ['before the first read', undefined],
    ['for a user with no links', []],
  ])('does not poll %s', (_, links) => {
    expect(getBankLinksPollInterval(links)).toBe(false);
  });

  it('polls slowly while every link is idle', () => {
    expect(getBankLinksPollInterval([createBankLink(), withImport('complete')])).toBe(BANK_LINKS_IDLE_POLL_MS);
  });

  it('polls quickly while any one link syncs', () => {
    expect(getBankLinksPollInterval([createBankLink(), createBankLink({ sync_in_progress: true })]))
      .toBe(BANK_LINKS_ACTIVE_POLL_MS);
  });

  it('polls quickly while an import runs', () => {
    expect(getBankLinksPollInterval([createBankLink(), withImport('running')])).toBe(BANK_LINKS_ACTIVE_POLL_MS);
  });

  it('polls slowly while an import waits on the request budget', () => {
    expect(getBankLinksPollInterval([withImport('waiting_on_budget')])).toBe(BANK_LINKS_IDLE_POLL_MS);
  });
});
