import { useEffect, useMemo, useState } from 'react'
import { discardStagedRun, settleStagedRun } from '@/api/import-runs'
import { waitForMilliseconds } from '@/utils/timing'
import type { ImportProgressStep } from '@/pages/imports/types'
import {
  canStartImport,
  createImportRunController,
  describeImportRunFailure,
  getImportRunError,
  IMPORT_RUN_IDLE,
  IMPORT_RUN_SAVING_LABEL,
  IMPORT_RUN_STAGE_ORDER,
  IMPORT_SAVED_EARLIER_MESSAGE,
  type CompletedImport,
  type ImportRunRequests,
  type ImportRunState,
} from '@/pages/imports/utils'

/** The part of a save request's mutation the run reads: whether it is under way, and forgetting it */
interface ImportRunMutation {
  isPending: boolean
  reset: () => void
}

/**
 * Runs an import as one run that uploads everything and then writes all of it at once, and holds
 * where the latest attempt stands for the overlay and the import button. Every import saves through
 * this, so they keep an interrupted save the same way and say the same about it
 *
 * An import that fails writes nothing. One whose save ended with no answer keeps its upload for as
 * long as this screen is open, and the next import settles it first, so nothing is written twice.
 * A failure is about the answers the import was sent with, so it stops showing once one changes
 */
export function useImportRun<TResult, TSkipped>({
  answers,
  uploadLabel,
  mutations,
  formatSummary,
}: {
  /**
   * Every answer the user gives about the import, as one value that changes only when one of them
   * does. Built from the answers themselves rather than from anything read back from the server,
   * since the refresh after an interrupted save must not count as a changed answer
   */
  answers: object

  /** What the overlay calls the upload stage */
  uploadLabel: string

  /** The upload and the save of a kept upload, as their mutations */
  mutations: ImportRunMutation[]

  /** The summary line for an import that was sent and saved */
  formatSummary: (completed: CompletedImport<TResult, TSkipped>) => string
}) {
  const [run, setRun] = useState<ImportRunState<TResult, TSkipped>>(IMPORT_RUN_IDLE)
  const [controller] = useState(() => createImportRunController<TResult, TSkipped>({
    onChange: setRun,
    discardStagedRun: (runId) => void discardStagedRun(runId),
    settleStagedRun,
    wait: waitForMilliseconds,
  }))

  const { failure, completedImport, overlayPhase, stageState, canStop, stagedRunId } = run
  const importResult = completedImport?.result ?? null
  const importError = getImportRunError(failure, answers)
  const failureCopy = failure && importError !== null ? describeImportRunFailure(failure) : null

  // The overlay says the most about a failure, and the line beside Commit import repeats it briefly
  const overlayFailureCopy = overlayPhase === 'error' ? failureCopy : null

  const importOverlaySteps = useMemo<ImportProgressStep[] | undefined>(
    () => {
      if (!stageState) return undefined

      // A stage that has handed over leaves the list, so the overlay carries the stage holding it on
      // top and the ones still waiting underneath. The stage on top turns done the moment its work
      // lands and stays there struck off until the next one takes over
      const { isFinished, stage } = stageState
      const labels = { uploading: uploadLabel, saving: IMPORT_RUN_SAVING_LABEL }
      const currentIndex = IMPORT_RUN_STAGE_ORDER.indexOf(stage)
      return IMPORT_RUN_STAGE_ORDER.slice(currentIndex).map((id, index) => ({
        id,
        label: labels[id],
        status: index > 0 ? 'queued' : isFinished ? 'done' : 'active',
      }))
    },
    [stageState, uploadLabel],
  )

  const completedSkippedCount = completedImport?.skippedRowsAtCommit.length ?? 0
  const importOverlayOpen = overlayPhase !== 'idle'
  const isImportInFlight = mutations.some((mutation) => mutation.isPending)

  /**
   * Whether Commit import can start an import now, given what the import's own answers hold
   */
  const canCommit = ({ hasPayload, isProcessingFile, blockReason = null }: {
    hasPayload: boolean
    isProcessingFile: boolean
    blockReason?: string | null
  }) => canStartImport({
    hasPayload,
    isProcessingFile,
    blockReason,
    overlayOpen: importOverlayOpen,
    inFlight: isImportInFlight,
    hasResult: importResult !== null,
  })

  /**
   * Starts the import with the answers on screen
   *
   * @param skippedRows - Rows the import leaves out, captured now since later answers no longer
   *   change what it wrote
   * @param requests - How the import reaches the server
   */
  const startImport = (skippedRows: TSkipped[], requests: ImportRunRequests<TResult>) => (
    controller.start(skippedRows, answers, requests)
  )

  const retryImportCommit = async () => {
    if (isImportInFlight) return
    await controller.retry()
  }

  /** Forgets every attempt, for when the answers it was given for no longer apply */
  const resetImportRun = () => {
    controller.reset()
    for (const mutation of mutations) mutation.reset()
  }

  // Leaving the page abandons the import: while uploading that drops what was uploaded, and while
  // saving it only stops waiting, since the save is the server's to finish
  useEffect(() => () => controller.stop(), [controller])

  return {
    canCommit,
    startImport,
    resetImportRun,

    // What the screens read, under the names every import workflow returns
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
        ? IMPORT_SAVED_EARLIER_MESSAGE
        : completedImport ? formatSummary(completedImport) : '',
      isImportInFlight,
      canStopImport: canStop,
      canRetryImportCommit: stagedRunId !== null && failure?.interrupted === true,
      retryImportCommit,
      cancelImport: controller.stop,
      closeImportOverlay: controller.close,
    },
  }
}
