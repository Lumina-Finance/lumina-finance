/**
 * Covers the held-rows check of an OFX import for a list too long for one request: it is asked in
 * parts, each within the row count and the body size the API takes, and the positions it answers refer
 * to the whole list, so a part's first row is never mistaken for the list's first
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { MAX_IMPORT_BATCH_BYTES, MAX_IMPORT_BATCH_ROWS, getJsonByteSize } from '@/api/shared/importBatchSize';
import type { HeldBankTransactionItem } from '@/api/transaction-imports';
import { fetchHeldBankTransactions, splitHeldCheckItems } from '@/api/transaction-imports/requests';

// The longest bank ID the API accepts
const LONGEST_BANK_ID_LENGTH = 100_000;

function buildItems(count: number, bankIdLength = 2): HeldBankTransactionItem[] {
  return Array.from({ length: count }, (_, index) => ({
    account_id: 'account-1',
    bank_account: 'bank:1:2',
    bank_transaction: `T${index}`.padEnd(bankIdLength, 'x'),
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

    expect(askedParts().map((part) => part.length)).toEqual([3]);
    expect(answer).toEqual({ held: [1] });
  });

  it('asks about a long list in parts, and answers with positions in the whole list', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce({ held: [0] })
      .mockResolvedValueOnce({ held: [5] })
      .mockResolvedValueOnce({ held: [] });

    const answer = await fetchHeldBankTransactions(buildItems(MAX_IMPORT_BATCH_ROWS * 2 + 7));

    expect(askedParts().map((part) => part.length)).toEqual([MAX_IMPORT_BATCH_ROWS, MAX_IMPORT_BATCH_ROWS, 7]);
    expect(askedParts()[1][0]).toBe('T5000');
    expect(answer).toEqual({ held: [0, MAX_IMPORT_BATCH_ROWS + 5] });
  });

  it('counts positions from the rows each earlier part held, whatever its size', async () => {
    authenticatedFetchMock.mockResolvedValue({ held: [0] });
    const items = buildItems(10, LONGEST_BANK_ID_LENGTH);

    const answer = await fetchHeldBankTransactions(items);

    const lengths = askedParts().map((part) => part.length);
    expect(lengths.length).toBeGreaterThan(1);
    expect(answer.held).toEqual(lengths.map((_, index) => lengths.slice(0, index).reduce((sum, length) => sum + length, 0)));
  });

  it('fails as a whole when one part cannot be answered, rather than answer for the rest', async () => {
    authenticatedFetchMock.mockResolvedValueOnce({ held: [] }).mockRejectedValueOnce(new Error('Server error'));

    await expect(fetchHeldBankTransactions(buildItems(MAX_IMPORT_BATCH_ROWS + 1))).rejects.toThrow('Server error');
  });
});

describe('splitting the transactions to ask about', () => {
  it('keeps every part within the body size budget when the bank IDs are as long as the API takes', () => {
    const parts = splitHeldCheckItems(buildItems(30, LONGEST_BANK_ID_LENGTH));

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(getJsonByteSize({ items: part })).toBeLessThanOrEqual(MAX_IMPORT_BATCH_BYTES);
    }
    expect(parts.flat()).toEqual(buildItems(30, LONGEST_BANK_ID_LENGTH));
  });

  it('keeps every part within the row count the API takes when the bank IDs are short', () => {
    const parts = splitHeldCheckItems(buildItems(MAX_IMPORT_BATCH_ROWS + 1));

    expect(parts.map((part) => part.length)).toEqual([MAX_IMPORT_BATCH_ROWS, 1]);
  });

  it('makes no request for an empty list', async () => {
    expect(splitHeldCheckItems([])).toEqual([]);
    authenticatedFetchMock.mockReset();

    expect(await fetchHeldBankTransactions([])).toEqual({ held: [] });
    expect(authenticatedFetchMock).not.toHaveBeenCalled();
  });

  it('refuses a single transaction too large to send', () => {
    expect(() => splitHeldCheckItems(buildItems(1, MAX_IMPORT_BATCH_BYTES))).toThrow('too large');
  });
});
