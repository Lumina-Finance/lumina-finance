import { authenticatedFetch } from '@/api/client';
import {
  MAX_IMPORT_BATCH_BYTES,
  MAX_IMPORT_BATCH_ROWS,
  TARGET_IMPORT_BATCH_BYTES,
  getJsonByteSize,
  getNextArrayItemByteSize,
} from '@/api/shared/importBatchSize';
import type {
  HeldBankTransactionItem,
  HeldBankTransactionsResponse,
  SavedAccountImportSource,
  SavedCsvImportLayout,
} from '@/api/transaction-imports/types';

/**
 * Reads how CSV files were read for each of the user's own accounts, the most recently saved first
 */
export function fetchImportLayouts(signal?: AbortSignal) {
  return authenticatedFetch<SavedCsvImportLayout[]>('/transactions/import/layouts', { signal });
}

/**
 * Reads which importer last brought transactions into each of the user's own accounts
 */
export function fetchImportSources(signal?: AbortSignal) {
  return authenticatedFetch<SavedAccountImportSource[]>('/transactions/import/sources', { signal });
}

/**
 * Splits the transactions to ask about into requests that each fit the import request budget
 *
 * A part is closed on the row count the API takes and on the bytes of its encoded body, as the
 * staged batches are, because a bank ID may be up to 100,000 characters and a count alone could
 * build a body the server refuses
 */
export function splitHeldCheckItems(items: HeldBankTransactionItem[]) {
  const emptyBytes = getJsonByteSize({ items: [] });
  const parts: HeldBankTransactionItem[][] = [];
  let part: HeldBankTransactionItem[] = [];
  let bytes = emptyBytes;

  for (const item of items) {
    let itemBytes = getNextArrayItemByteSize(part.length, item);
    if (part.length > 0 && (bytes + itemBytes > TARGET_IMPORT_BATCH_BYTES || part.length >= MAX_IMPORT_BATCH_ROWS)) {
      parts.push(part);
      part = [];
      bytes = emptyBytes;
      itemBytes = getNextArrayItemByteSize(0, item);
    }
    if (part.length === 0 && bytes + itemBytes > MAX_IMPORT_BATCH_BYTES) {
      throw new Error('One imported row is too large to check safely.');
    }
    part.push(item);
    bytes += itemBytes;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

/**
 * Asks which OFX transactions their account already holds, by position in the list sent
 *
 * A long list is asked in parts, one after the other, and the positions are given for the whole list.
 * The bank values travel in the bodies only, so no cache key, log or URL carries them
 */
export async function fetchHeldBankTransactions(items: HeldBankTransactionItem[], signal?: AbortSignal) {
  const held: number[] = [];
  let start = 0;
  for (const part of splitHeldCheckItems(items)) {
    const answer = await authenticatedFetch<HeldBankTransactionsResponse>('/transactions/import/held-bank-transactions', {
      method: 'POST',
      body: JSON.stringify({ items: part }),
      signal,
    });
    held.push(...answer.held.map((position) => start + position));
    start += part.length;
  }
  return { held };
}
