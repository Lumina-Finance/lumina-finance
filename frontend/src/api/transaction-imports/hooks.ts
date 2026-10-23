import { useQuery } from '@tanstack/react-query';
import { heldBankTransactionKeys, importLayoutKeys, importSourceKeys } from '@/api/cache/queryKeys';
import { useImportRunMutation } from '@/api/import-runs/hooks';
import { fetchHeldBankTransactions, fetchImportLayouts, fetchImportSources } from '@/api/transaction-imports/requests';
import { commitStagedImportRun, runTransactionImport } from '@/api/transaction-imports/run';
import type {
  CsvImportLayout,
  HeldBankTransactionItem,
  HeldBankTransactionsScope,
  TransactionImportPayload,
  TransactionImportSource,
} from '@/api/transaction-imports/types';
import { useAuth } from '@/hooks/useAuth';

const HELD_CHECK_RETRY_COUNT = 1;

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
 * Asks the server which OFX transactions their account already holds, so the preview can leave them out
 *
 * The cache key is the scope alone. The items carry the bank accounts and bank IDs and are only sent,
 * so the persisted query cache never holds them. Read again whenever the app data is refreshed, since
 * an import or an undo, here or in another tab, changes what an account holds
 *
 * @param scope - Names the staged files, the statements' positions and their accounts, or null when
 *   there is nothing to ask
 * @param items - The transactions to ask about, in the order the answer's positions refer to
 * @param isPaused - Keeps the answer as it is, so an import being saved is not asked again about what
 *   it has just written
 */
export function useHeldBankTransactions(
  scope: HeldBankTransactionsScope | null,
  items: HeldBankTransactionItem[],
  isPaused: boolean,
) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: heldBankTransactionKeys.check(scope ?? { fileIds: [], statements: [] }),
    queryFn: ({ signal }) => fetchHeldBankTransactions(items, signal),
    enabled: !!accessToken && scope !== null && !isPaused,

    // Fresh until an import or an undo invalidates it, and read again when the preview opens
    staleTime: Infinity,
    refetchOnMount: 'always',

    // Commit waits on this answer, so a failure is shown after one more try instead of the default three
    retry: HELD_CHECK_RETRY_COUNT,
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
