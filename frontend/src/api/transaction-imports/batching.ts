import { buildImportBatches } from '@/api/shared/importBatching'
import { getNameKey } from '@/api/shared/nameKey'
import type {
  TransactionImportPayload,
  TransactionImportRow,
  TransactionImportStageBatch,
} from '@/api/transaction-imports/types'

/**
 * Splits a prepared import into batches that each fit the request-size budget
 */
export async function buildStagedImportBatches(
  payload: TransactionImportPayload,
): Promise<TransactionImportStageBatch[]> {
  // Keyed by what matches a merchant name rather than by the spelling the answer names, so a row spelling
  // it differently still finds the answer given for it
  const merchantMappingsByKey = new Map(payload.merchants.map((mapping) => [getNameKey(mapping.source), mapping]))
  const tagMappingsByKey = new Map(payload.tags.map((mapping) => [getNameKey(mapping.source), mapping]))

  return buildImportBatches({
    rows: payload.rows,
    mappings: {
      accounts: new Map(payload.accounts.map((mapping) => [mapping.source, mapping])),
      categories: new Map(payload.categories.map((mapping) => [mapping.source, mapping])),
      merchants: merchantMappingsByKey,
      tags: tagMappingsByKey,
    },
    getRowSources: (row) => ({
      accounts: getRowAccountSources(row),
      categories: [row.category_source],
      merchants: getRowMerchantKeys(row, merchantMappingsByKey),
      tags: getRowTagKeys(row, tagMappingsByKey),
    }),
  })
}

/**
 * The answered merchant name a row carries, or nothing where its merchant was left alone
 *
 * Only the merchant names the user answered carry a mapping, so a row whose merchant was left alone
 * adds nothing to the batch and is not looked up as though it must be there
 */
function getRowMerchantKeys(row: TransactionImportRow, merchantMappingsByKey: Map<string, unknown>) {
  if (!row.merchant_name) return []
  const key = getNameKey(row.merchant_name)
  return merchantMappingsByKey.has(key) ? [key] : []
}

/**
 * The answered tag names a row carries, leaving out the tags that were left alone
 *
 * A row can name several tags, so it can reference several answers. Only the names the user answered
 * carry a mapping, and a tag left alone adds nothing to the batch
 */
function getRowTagKeys(row: TransactionImportRow, tagMappingsByKey: Map<string, unknown>) {
  const keys = row.tag_names.map((name) => getNameKey(name)).filter((key) => tagMappingsByKey.has(key))
  return [...new Set(keys)]
}

/**
 * Lists every account mapping source one row references
 *
 * The counterparty account of a transfer is one of them, even though no row in the batch is
 * written to it
 */
function getRowAccountSources(row: TransactionImportRow) {
  return row.counterparty_account_source ? [row.account_source, row.counterparty_account_source] : [row.account_source]
}
