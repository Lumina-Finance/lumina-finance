/**
 * Covers the held-rows check of an OFX import for a list too long for one request: it is asked in
 * parts, each within what the API takes, and the positions it answers refer to the whole list, so a
 * part's first row is never mistaken for the list's first
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import type { HeldBankTransactionItem } from '@/api/transaction-imports';
import { fetchHeldBankTransactions, HELD_CHECK_REQUEST_ITEMS } from '@/api/transaction-imports/requests';

function buildItems(count: number): HeldBankTransactionItem[] {
  return Array.from({ length: count }, (_, index) => ({
    account_id: 'account-1',
    bank_account: 'bank:1:2',
    bank_transaction: `T${index}`,
  }));
}

/** The transactions each request asked about, by their bank IDs */
function askedParts() {
  return authenticatedFetchMock.mock.calls.map(([, init]) => (
    (JSON.parse(init.body as string) as { items: HeldBankTransactionItem[] }).items.map((item) => item.bank_transaction)
  ));
}

describe('asking which transactions an account holds', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('asks about a short list in one request', async () => {
    authenticatedFetchMock.mockResolvedValue({ held: [1] });

    const answer = await fetchHeldBankTransactions(buildItems(3));

    expect(askedParts()).toEqual([['T0', 'T1', 'T2']]);
    expect(answer).toEqual({ held: [1] });
  });

  it('asks about a long list in parts, and answers with positions in the whole list', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce({ held: [0] })
      .mockResolvedValueOnce({ held: [5] })
      .mockResolvedValueOnce({ held: [] });

    const answer = await fetchHeldBankTransactions(buildItems(HELD_CHECK_REQUEST_ITEMS * 2 + 7));

    expect(askedParts().map((part) => part.length)).toEqual([HELD_CHECK_REQUEST_ITEMS, HELD_CHECK_REQUEST_ITEMS, 7]);
    expect(askedParts()[1][0]).toBe(`T${HELD_CHECK_REQUEST_ITEMS}`);
    expect(answer).toEqual({ held: [0, HELD_CHECK_REQUEST_ITEMS + 5] });
  });

  it('fails as a whole when one part cannot be answered, rather than answer for the rest', async () => {
    authenticatedFetchMock.mockResolvedValueOnce({ held: [] }).mockRejectedValueOnce(new Error('Server error'));

    await expect(fetchHeldBankTransactions(buildItems(HELD_CHECK_REQUEST_ITEMS + 1))).rejects.toThrow('Server error');
  });
});
