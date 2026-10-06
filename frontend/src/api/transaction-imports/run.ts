import { commitStagedRun, runImport } from '@/api/import-runs/run';
import type { ImportRunRoutes } from '@/api/import-runs/types';
import { buildStagedImportBatches } from '@/api/transaction-imports/batching';
import type {
  TransactionImportPayload,
  TransactionImportResponse,
} from '@/api/transaction-imports/types';

const TRANSACTION_IMPORT_ROUTES: ImportRunRoutes = { rows: 'rows', commit: 'commit' };

/**
 * Uploads a prepared CSV import and writes it to the ledger
 *
 * @param payload - The prepared import, as the mapping steps built it
 * @param signal - Abandons the upload. The run is dropped when this fires during staging, while
 *   during the commit it only stops waiting, since the commit may already have landed
 * @param onStaged - Runs once everything is staged, before the commit starts
 * @param fileName - Names the import with the last import
 */
export function runTransactionImport(
  payload: TransactionImportPayload,
  signal?: AbortSignal,
  onStaged?: () => Promise<void>,
  fileName?: string,
): Promise<TransactionImportResponse> {
  return runImport<TransactionImportResponse>({
    open: { expected_transaction_count: payload.rows.length, file_name: fileName },
    routes: TRANSACTION_IMPORT_ROUTES,
    buildBatches: () => buildStagedImportBatches(payload),
  }, signal, onStaged);
}

/**
 * Writes an already staged CSV import to the ledger
 *
 * @param runId - The staged run to commit
 * @param signal - Stops waiting for the commit. It does not stop the commit itself
 */
export function commitStagedImportRun(runId: string, signal?: AbortSignal): Promise<TransactionImportResponse> {
  return commitStagedRun<TransactionImportResponse>(runId, TRANSACTION_IMPORT_ROUTES, signal);
}
