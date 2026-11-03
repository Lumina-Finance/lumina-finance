import { getJournalRowAccountSources, getJournalRowCategorySource } from '@/api/provider-imports/rowSources'
import type { JournalImportStageBatch, JournalImportPayload } from '@/api/provider-imports/types'
import { buildImportBatches, getAnsweredTagKeys } from '@/api/shared/importBatching'
import { getNameKey } from '@/api/shared/nameKey'

/**
 * Splits a prepared provider import into batches that each fit the request-size budget
 *
 * An account no row names, which the import creates empty, rides with the first batch, since the
 * server only takes a batch that holds rows
 */
export async function buildJournalStageBatches(payload: JournalImportPayload): Promise<JournalImportStageBatch[]> {
  const rowAccountSources = new Set(payload.rows.flatMap((row) => getJournalRowAccountSources(row)))

  // Keyed by what matches a tag name rather than by the spelling the answer names, so a row spelling
  // it differently still finds the answer given for it
  const tagMappingsByKey = new Map(payload.tags.map((mapping) => [getNameKey(mapping.source), mapping]))

  return buildImportBatches({
    rows: payload.rows,
    mappings: {
      accounts: new Map(payload.accounts.map((mapping) => [mapping.source, mapping])),
      categories: new Map(payload.categories.map((mapping) => [mapping.source, mapping])),
      tags: tagMappingsByKey,
    },
    getRowSources: (row) => {
      const categorySource = getJournalRowCategorySource(row)
      return {
        accounts: getJournalRowAccountSources(row),
        categories: categorySource === null ? [] : [categorySource],
        tags: getAnsweredTagKeys(row.tag_names, tagMappingsByKey),
      }
    },
    firstBatchSources: {
      accounts: payload.accounts.map((mapping) => mapping.source).filter((source) => !rowAccountSources.has(source)),
    },
  })
}
