import { useMemo } from 'react'
import {
  useCommitStagedJournalImport,
  useImportJournal,
  type JournalImportRequest,
  type JournalImportRunResponse,
  type JournalImportSource,
} from '@/api/provider-imports'
import { formatProviderImportSummary, PROVIDER_IMPORT_UPLOAD_LABEL } from '@/pages/imports/utils'
import { useImportRun } from './useImportRun'

/**
 * Runs a provider import through the save every import shares, adding what only an export from
 * another app sends: the app it came from, its budgets and the accounts it archives
 */
export function useProviderImportRun<TSkipped>({
  source,
  answers,
}: {
  source: JournalImportSource

  /** Every answer the user gives about the import, as one value that changes only when one of them does */
  answers: object
}) {
  const importJournal = useImportJournal()
  const commitStagedJournal = useCommitStagedJournalImport()
  const run = useImportRun<JournalImportRunResponse, TSkipped>({
    answers,
    uploadLabel: PROVIDER_IMPORT_UPLOAD_LABEL,
    mutations: [importJournal, commitStagedJournal],
    formatSummary: ({ result, skippedRowsAtCommit }) => formatProviderImportSummary(result, skippedRowsAtCommit.length),
  })

  const importResult = run.workflow.importResult
  const importedBudgetNames = useMemo(
    () => new Set(importResult?.budgets.map((budget) => budget.name) ?? []),
    [importResult],
  )

  /**
   * Whether Commit import can start an import now, given what the provider's own answers hold
   */
  const canCommit = ({ hasPayload, isProcessingFile, budgetSelectionError }: {
    hasPayload: boolean
    isProcessingFile: boolean
    budgetSelectionError: string | null
  }) => run.canCommit({ hasPayload, isProcessingFile, blockReason: budgetSelectionError })

  /**
   * Starts the import. It creates the budgets selected when it started, so they are captured here
   * along with the rows it leaves out
   */
  const startImport = async ({ skippedRows, ...request }: Omit<JournalImportRequest, 'source'> & { skippedRows: TSkipped[] }) => {
    const journalRequest: JournalImportRequest = { source, ...request }
    await run.startImport(skippedRows, {
      upload: (signal, onStaged) => importJournal.mutateAsync({ request: journalRequest, signal, onStaged }),
      commit: (runId, signal) => commitStagedJournal.mutateAsync({ runId, signal }),
    })
  }

  return {
    canCommit,
    startImport,
    resetImportRun: run.resetImportRun,
    workflow: { ...run.workflow, importedBudgetNames },
  }
}
