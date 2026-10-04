import { buildImportBatches } from '@/api/shared/importBatching';
import { getMerchantNameKey } from '@/api/shared/merchantNameKey';
import type {
  TransactionImportPayload,
  TransactionImportRow,
  TransactionImportStageBatch,
} from '@/api/transaction-imports/types';

/**
 * Splits a prepared import into batches that each fit the request-size budget
 */
export async function buildStagedImportBatches(
  payload: TransactionImportPayload,
): Promise<TransactionImportStageBatch[]> {
  // Keyed by what matches a payee rather than by the spelling the answer names, so a row spelling
  // it differently still finds the answer given for it
  const merchantMappingsByKey = new Map(
    payload.merchants.map((mapping) => [getMerchantNameKey(mapping.source), mapping]),
  );

  return buildImportBatches({
    rows: payload.rows,
    mappings: {
      accounts: new Map(payload.accounts.map((mapping) => [mapping.source, mapping])),
      categories: new Map(payload.categories.map((mapping) => [mapping.source, mapping])),
      merchants: merchantMappingsByKey,
    },
    getRowSources: (row) => ({
      accounts: getRowAccountSources(row),
      categories: [row.category_source],
      merchants: getRowMerchantKeys(row, merchantMappingsByKey),
    }),
  });
}

/**
 * The answered payee value a row carries, or nothing where its payee was left alone
 *
 * Only the payee values the user answered carry a mapping, so a row whose payee was left alone
 * adds nothing to the batch and is not looked up as though it must be there
 */
function getRowMerchantKeys(row: TransactionImportRow, merchantMappingsByKey: Map<string, unknown>) {
  if (!row.merchant_name) return [];
  const key = getMerchantNameKey(row.merchant_name);
  return merchantMappingsByKey.has(key) ? [key] : [];
}

/**
 * Lists every account mapping source one row references
 *
 * The counterparty account of a transfer is one of them, even though no row in the batch is
 * written to it
 */
function getRowAccountSources(row: TransactionImportRow) {
  return row.counterparty_account_source
    ? [row.account_source, row.counterparty_account_source]
    : [row.account_source];
}
