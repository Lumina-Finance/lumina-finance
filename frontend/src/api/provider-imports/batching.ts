import {
  getJournalRowAccountSources,
  getJournalRowCategorySource,
} from '@/api/provider-imports/rowSources';
import type {
  JournalImportStageBatch,
  JournalImportPayload,
} from '@/api/provider-imports/types';
import { buildImportBatches } from '@/api/shared/importBatching';

/**
 * Splits a prepared provider import into batches that each fit the request-size budget
 *
 * An account no row names, which the import creates empty, rides with the first batch, since the
 * server only takes a batch that holds rows
 */
export async function buildJournalStageBatches(
  payload: JournalImportPayload,
): Promise<JournalImportStageBatch[]> {
  const rowAccountSources = new Set(payload.rows.flatMap((row) => getJournalRowAccountSources(row)));

  return buildImportBatches({
    rows: payload.rows,
    mappings: {
      accounts: new Map(payload.accounts.map((mapping) => [mapping.source, mapping])),
      categories: new Map(payload.categories.map((mapping) => [mapping.source, mapping])),
    },
    getRowSources: (row) => {
      const categorySource = getJournalRowCategorySource(row);
      return {
        accounts: getJournalRowAccountSources(row),
        categories: categorySource === null ? [] : [categorySource],
      };
    },
    firstBatchSources: {
      accounts: payload.accounts.map((mapping) => mapping.source).filter((source) => !rowAccountSources.has(source)),
    },
  });
}
