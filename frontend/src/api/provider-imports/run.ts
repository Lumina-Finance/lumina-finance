import { commitStagedRun, runImport } from '@/api/import-runs/run';
import type { ImportRunRoutes } from '@/api/import-runs/types';
import { buildJournalStageBatches } from '@/api/provider-imports/batching';
import { putImportRunArchive, putImportRunBudgets } from '@/api/provider-imports/requests';
import type {
  ImportRunBudgets,
  JournalImportRunResponse,
  JournalImportPayload,
  JournalImportSource,
} from '@/api/provider-imports/types';

const JOURNAL_IMPORT_ROUTES: ImportRunRoutes = { rows: 'journal/rows', commit: 'journal/commit' };

/**
 * A prepared provider import: the app it came from, the export's rows, the budgets created
 * alongside them, and the accounts it creates that are then archived
 */
export interface JournalImportRequest {
  source: JournalImportSource;
  payload: JournalImportPayload;

  /** Absent when no budget is imported */
  budgets: ImportRunBudgets | null;

  /** Account sources answered create-new that the export marks inactive or closed */
  archiveAccountSources: string[];

  /** Names the import with the last import */
  fileName?: string;
}

/**
 * Uploads a prepared provider import and writes all of it in one transaction
 *
 * The budgets and the accounts to archive are staged after the export's rows, under the same run
 *
 * @param request - The prepared rows, budgets and accounts to archive
 * @param signal - Abandons the upload. The run is dropped when this fires during staging, while
 *   during the commit it only stops waiting, since the commit may already have landed
 * @param onStaged - Runs once everything is staged, before the commit starts, so the screen can
 *   show the upload finishing. Stopping while it runs still counts as stopping during staging
 */
export function runJournalImport(
  { source, payload, budgets, archiveAccountSources, fileName }: JournalImportRequest,
  signal?: AbortSignal,
  onStaged?: () => Promise<void>,
): Promise<JournalImportRunResponse> {
  return runImport<JournalImportRunResponse>({
    open: { expected_transaction_count: payload.rows.length, source, file_name: fileName },
    routes: JOURNAL_IMPORT_ROUTES,
    buildBatches: () => buildJournalStageBatches(payload),
    stageExtras: async (runId, stageSignal) => {
      if (budgets && budgets.budgets.length > 0) await putImportRunBudgets(runId, budgets, stageSignal);
      if (archiveAccountSources.length > 0) await putImportRunArchive(runId, archiveAccountSources, stageSignal);
    },
  }, signal, onStaged);
}

/**
 * Writes an already staged provider run
 *
 * @param runId - The staged run to commit
 * @param signal - Stops waiting for the commit. It does not stop the commit itself
 */
export function commitStagedJournalRun(runId: string, signal?: AbortSignal): Promise<JournalImportRunResponse> {
  return commitStagedRun<JournalImportRunResponse>(runId, JOURNAL_IMPORT_ROUTES, signal);
}
