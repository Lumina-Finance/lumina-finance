import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  useCheckStagedJournalImport,
  useCommitStagedJournalImport,
  useImportJournal,
  type JournalImportRequest,
  type JournalImportSource,
} from '@/api/provider-imports'
import { discardStagedRun } from '@/api/transaction-imports'
import { useAuth } from '@/hooks/useAuth'
import { waitForMilliseconds } from '@/utils/timing'
import type { ImportProgressStep } from '@/pages/imports/types'
import {
  canStartProviderImport,
  createProviderImportRunController,
  createUnconfirmedImportSaveStore,
  describeProviderImportFailure,
  formatProviderImportSummary,
  getBrowserLocalStorage,
  getProviderImportError,
  getUnconfirmedImportSavePrefix,
  PROVIDER_IMPORT_RUN_IDLE,
  PROVIDER_IMPORT_STAGES,
  type ProviderImportRunState,
} from '@/pages/imports/utils'

/**
 * Runs a provider import as one run that uploads everything and then writes all of it at once, and
 * holds where the latest attempt stands for the overlay and the import button
 *
 * An import that fails writes nothing. One whose save went unanswered may already have landed, so
 * it keeps its upload, remembered past the page, and holds the overlay until saving again or asking
 * the server settles it. A failure is about the answers the import was sent with, so it stops
 * showing once one of them changes
 */
export function useProviderImportRun<TSkipped>({
  source,
  answers,
}: {
  source: JournalImportSource

  /** Every answer the user gives about the import, as one value that changes only when one of them does */
  answers: object
}) {
  const { user } = useAuth()
  const [run, setRun] = useState<ProviderImportRunState<TSkipped>>(PROVIDER_IMPORT_RUN_IDLE)
  const [controller] = useState(() => createProviderImportRunController<TSkipped>({
    onChange: setRun,
    discardStagedRun: (runId) => void discardStagedRun(runId),
    wait: waitForMilliseconds,

    // Without a signed-in user there is nobody to keep saves for, and the page still holds its own
    unconfirmedSaves: createUnconfirmedImportSaveStore(
      user ? getBrowserLocalStorage() : null,
      user ? getUnconfirmedImportSavePrefix(user.id, source) : '',
      Date.now,
    ),
  }))
  const importJournal = useImportJournal()
  const commitStagedJournal = useCommitStagedJournalImport()
  const { mutateAsync: checkStagedRun } = useCheckStagedJournalImport()

  const { failure, completedImport, overlayPhase, stageState, canStop, stagedRunId, isSaveRemembered } = run
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

  const completedSkippedCount = completedImport?.skippedCount ?? 0
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

  // A save this browser sent and never heard back about takes the overlay before anything can be
  // started, laid out ahead of the first paint so the page never shows Commit import in between
  useLayoutEffect(() => {
    void controller.resume(answers, (runId) => checkStagedRun({ runId }))
  }, [controller, answers, checkStagedRun])

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

      // Only the overlay says what a failure left behind, and the preview beside the button shows the
      // reason alone once it closes. A save nobody answered for is described by what may have
      // happened to it rather than by its reason
      importOverlayError: describeProviderImportFailure(overlayPhase, importError),
      importResult,
      importOverlayPhase: overlayPhase,
      importOverlayOpen,
      importOverlaySteps,
      importSummary: importResult ? formatProviderImportSummary(importResult, completedSkippedCount) : '',
      importedBudgetNames,

      // Only rows kept from this visit can be listed, so a save learned about later offers none
      canReviewSkippedRows: (completedImport?.skippedRowsAtCommit.length ?? 0) > 0,
      isImportInFlight,
      canStopImport: canStop,
      canRetryImportCommit: stagedRunId !== null,

      // A save the browser refused to keep is lost by leaving, so only trying again is offered
      canLeaveImport: isSaveRemembered,
      retryImportCommit,
      cancelImport: controller.stop,
      closeImportOverlay: controller.close,
    },
  }
}
