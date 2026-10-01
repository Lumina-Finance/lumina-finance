import { useEffect, useMemo, useState } from 'react'
import {
  useCommitStagedJournalImport,
  useImportJournal,
  type JournalImportRequest,
  type JournalImportSource,
} from '@/api/provider-imports'
import { discardStagedRun } from '@/api/transaction-imports'
import { waitForMilliseconds } from '@/utils/timing'
import type { ImportProgressStep } from '@/pages/imports/types'
import {
  canStartProviderImport,
  createProviderImportRunController,
  describeProviderImportFailure,
  formatProviderImportSummary,
  getProviderImportError,
  PROVIDER_IMPORT_RUN_IDLE,
  PROVIDER_IMPORT_STAGES,
  type ProviderImportRunState,
} from '@/pages/imports/utils'

/**
 * Runs a provider import as one run that uploads everything and then writes all of it at once, and
 * holds where the latest attempt stands for the overlay and the import button
 *
 * An import that fails writes nothing, and one whose save failed for a reason trying again could
 * clear keeps its upload, so a retry only saves again. A failure is about the answers the import
 * was sent with, so it stops showing once one of them changes
 */
export function useProviderImportRun<TSkipped>({
  source,
  answers,
}: {
  source: JournalImportSource

  /** Every answer the user gives about the import, as one value that changes only when one of them does */
  answers: object
}) {
  const [run, setRun] = useState<ProviderImportRunState<TSkipped>>(PROVIDER_IMPORT_RUN_IDLE)
  const [controller] = useState(() => createProviderImportRunController<TSkipped>({
    onChange: setRun,
    discardStagedRun: (runId) => void discardStagedRun(runId),
    wait: waitForMilliseconds,
  }))
  const importJournal = useImportJournal()
  const commitStagedJournal = useCommitStagedJournalImport()

  const { failure, completedImport, overlayPhase, stageState, canStop, stagedRunId } = run
  const importResult = completedImport?.result ?? null
  const importError = getProviderImportError(failure, answers)

  const importOverlaySteps = useMemo<ImportProgressStep[] | undefined>(
    () => {
      if (!stageState) return undefined

      // A stage that has handed over leaves the list, so the overlay carries the stage holding it on
      // top and the ones still waiting underneath. The stage on top turns done the moment its work
      // lands and stays there struck off until the next one takes over
      const { isFinished, stage } = stageState
      const currentIndex = PROVIDER_IMPORT_STAGES.findIndex((entry) => entry.id === stage)
      return PROVIDER_IMPORT_STAGES.slice(currentIndex).map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        status: index > 0 ? 'queued' : isFinished ? 'done' : 'active',
      }))
    },
    [stageState],
  )

  const completedSkippedCount = completedImport?.skippedRowsAtCommit.length ?? 0
  const importedBudgetNames = useMemo(
    () => new Set(importResult?.budgets.map((budget) => budget.name) ?? []),
    [importResult],
  )

  const importOverlayOpen = overlayPhase !== 'idle'
  const isImportInFlight = importJournal.isPending || commitStagedJournal.isPending

  /**
   * Whether Commit import can start an import now, given what the provider's own answers hold
   */
  const canCommit = ({ hasPayload, isProcessingFile, budgetSelectionError }: {
    hasPayload: boolean
    isProcessingFile: boolean
    budgetSelectionError: string | null
  }) => canStartProviderImport({
    hasPayload,
    isProcessingFile,
    budgetSelectionError,
    overlayOpen: importOverlayOpen,
    inFlight: isImportInFlight,
    hasResult: importResult !== null,
  })

  /**
   * Starts the import. It creates the budgets selected when it started, so they are captured here
   * along with the rows it leaves out
   */
  const startImport = async ({ skippedRows, ...request }: Omit<JournalImportRequest, 'source'> & { skippedRows: TSkipped[] }) => {
    const journalRequest: JournalImportRequest = { source, ...request }
    await controller.start(
      skippedRows,
      answers,
      (signal, onStaged) => importJournal.mutateAsync({ request: journalRequest, signal, onStaged }),
    )
  }

  const retryImportCommit = async () => {
    if (isImportInFlight) return
    await controller.retry(answers, (runId, signal) => commitStagedJournal.mutateAsync({ runId, signal }))
  }

  /** Forgets every attempt, for when the answers it was given for no longer apply */
  const resetImportRun = () => {
    controller.reset()
    importJournal.reset()
    commitStagedJournal.reset()
  }

  // Leaving the page abandons the import: while uploading that drops what was uploaded, and while
  // saving it only stops waiting, since the save is the server's to finish
  useEffect(() => () => controller.stop(), [controller])

  return {
    canCommit,
    startImport,
    resetImportRun,

    // What the screens read, under the names every provider workflow returns
    workflow: {
      completedImport,
      completedSkippedCount,
      importError,

      // Only the overlay says what a failure left, read off the upload still kept, since closing it
      // drops that upload and the preview beside the button then shows the reason alone
      importOverlayError: importError && overlayPhase === 'error'
        ? describeProviderImportFailure(importError, stagedRunId !== null)
        : importError,
      importResult,
      importOverlayPhase: overlayPhase,
      importOverlayOpen,
      importOverlaySteps,
      importSummary: importResult ? formatProviderImportSummary(importResult, completedSkippedCount) : '',
      importedBudgetNames,
      isImportInFlight,
      canStopImport: canStop,
      canRetryImportCommit: stagedRunId !== null,
      retryImportCommit,
      cancelImport: controller.stop,
      closeImportOverlay: controller.close,
    },
  }
}
