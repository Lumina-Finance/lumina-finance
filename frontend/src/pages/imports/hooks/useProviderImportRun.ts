import { useEffect, useMemo, useState } from 'react'
import {
  useCommitStagedJournalImport,
  useImportJournal,
  type JournalImportRequest,
  type JournalImportSource,
} from '@/api/provider-imports'
import { discardStagedRun, settleStagedRun } from '@/api/transaction-imports'
import { waitForMilliseconds } from '@/utils/timing'
import type { ImportProgressStep } from '@/pages/imports/types'
import {
  canStartProviderImport,
  createProviderImportRunController,
  describeProviderImportFailure,
  formatProviderImportSummary,
  getProviderImportError,
  PROVIDER_IMPORT_RUN_IDLE,
  PROVIDER_IMPORT_SAVED_EARLIER_MESSAGE,
  PROVIDER_IMPORT_STAGES,
  type ProviderImportRunState,
} from '@/pages/imports/utils'

/**
 * Runs a provider import as one run that uploads everything and then writes all of it at once, and
 * holds where the latest attempt stands for the overlay and the import button
 *
 * An import that fails writes nothing. One whose save ended with no answer keeps its upload for as
 * long as this screen is open, and the next import settles it first, so nothing is written twice.
 * A failure is about the answers the import was sent with, so it stops showing once one changes
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
    settleStagedRun,
    wait: waitForMilliseconds,
  }))
  const importJournal = useImportJournal()
  const commitStagedJournal = useCommitStagedJournalImport()

  const { failure, completedImport, overlayPhase, stageState, canStop, stagedRunId } = run
  const importResult = completedImport?.result ?? null
  const importError = getProviderImportError(failure, answers)
  const failureCopy = failure && importError !== null ? describeProviderImportFailure(failure) : null

  // The overlay says the most about a failure, and the line beside Commit import repeats it briefly
  const overlayFailureCopy = overlayPhase === 'error' ? failureCopy : null

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
    await controller.start(skippedRows, answers, {
      upload: (signal, onStaged) => importJournal.mutateAsync({ request: journalRequest, signal, onStaged }),
      commit: (runId, signal) => commitStagedJournal.mutateAsync({ runId, signal }),
    })
  }

  const retryImportCommit = async () => {
    if (isImportInFlight) return
    await controller.retry()
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
      importError: failureCopy?.footerMessage ?? importError,
      importOverlayError: overlayFailureCopy?.overlayMessage ?? importError,
      importOverlayErrorEmphasis: overlayFailureCopy?.overlayEmphasis ?? undefined,
      importOverlayTitle: overlayFailureCopy?.overlayTitle ?? undefined,
      importOverlayNote: overlayFailureCopy?.overlayNote ?? undefined,
      importResult,
      importOverlayPhase: overlayPhase,
      importOverlayOpen,
      importOverlaySteps,
      importSummary: completedImport?.savedEarlier
        ? PROVIDER_IMPORT_SAVED_EARLIER_MESSAGE
        : importResult ? formatProviderImportSummary(importResult, completedSkippedCount) : '',
      importedBudgetNames,
      isImportInFlight,
      canStopImport: canStop,
      canRetryImportCommit: stagedRunId !== null && failure?.interrupted === true,
      retryImportCommit,
      cancelImport: controller.stop,
      closeImportOverlay: controller.close,
    },
  }
}
