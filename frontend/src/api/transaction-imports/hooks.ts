import { useQuery } from '@tanstack/react-query';
import { importLayoutKeys, importSourceKeys } from '@/api/cache/queryKeys';
import { useImportRunMutation } from '@/api/import-runs/hooks';
import { fetchImportLayouts, fetchImportSources } from '@/api/transaction-imports/requests';
import { commitStagedImportRun, runTransactionImport } from '@/api/transaction-imports/run';
import type {
  CsvImportLayout,
  TransactionImportPayload,
  TransactionImportSource,
} from '@/api/transaction-imports/types';
import { useAuth } from '@/hooks/useAuth';

/**
 * Provides the mutation boundary for staging a prepared import and committing it
 */
export function useImportTransactions() {
  return useImportRunMutation(({ payload, signal, onStaged, fileName, csvLayout, source }: {
    payload: TransactionImportPayload;
    signal?: AbortSignal;
    onStaged?: () => Promise<void>;
    fileName?: string;
    csvLayout?: CsvImportLayout;
    source?: TransactionImportSource;
  }) => runTransactionImport(payload, signal, onStaged, fileName, csvLayout, source));
}

/**
 * Reads the CSV layouts saved for the user's own accounts
 *
 * Read again every time the import page opens, since an import or an undo in another tab changes
 * them, and a file read against an outdated list starts from settings that are no longer saved
 *
 * @param isWanted - Whether the screen uses the layouts, so one that doesn't never reads them
 */
export function useImportLayouts(isWanted: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: importLayoutKeys.all,
    queryFn: ({ signal }) => fetchImportLayouts(signal),
    enabled: !!accessToken && isWanted,

    // Fresh until an import or an undo invalidates it, so going stale means a reload is on its way,
    // which a file must wait for rather than be read against the list from before
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
}

/**
 * Reads which importer last brought transactions into each of the user's own accounts
 *
 * Read again every time the import page opens, since an import or an undo in another tab changes
 * them, and the page opens on whatever the list says once it has one
 *
 * @param isWanted - Whether the screen uses the sources, so one that doesn't never reads them
 */
export function useImportSources(isWanted: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: importSourceKeys.all,
    queryFn: ({ signal }) => fetchImportSources(signal),
    enabled: !!accessToken && isWanted,
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
}

/**
 * Provides the mutation boundary for committing a file that is already staged
 *
 * A commit that failed for a reason committing again could clear leaves the file staged, and this
 * is what runs when the user asks for that second attempt
 */
export function useCommitStagedImport() {
  return useImportRunMutation(({ runId, signal }: { runId: string; signal?: AbortSignal }) =>
    commitStagedImportRun(runId, signal));
}
