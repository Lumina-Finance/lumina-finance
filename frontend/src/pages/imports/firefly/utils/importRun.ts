import type { FireflyImportRunResponse } from '@/api/firefly-imports'
import type { FireflyFileKind, FireflyImportStage, FireflyImportStageState } from '@/pages/imports/firefly/types'
import type { ImportOverlayPhase } from '@/pages/imports/types'
import { getImportCommitFailure } from '@/pages/imports/utils/commitFailure'
import {
  FIREFLY_IMPORT_OVERLAY_MIN_MS,
  FIREFLY_IMPORT_STAGE_CROSS_OFF_MS,
  FIREFLY_IMPORT_STAGE_MIN_MS,
} from '@/pages/imports/firefly/constants'
import type { FireflyCompletedImportContext, FireflySkippedRowDetail } from './skippedRows'

/** Why the last attempt failed, with the answers it was started with */
export interface FireflyImportFailure {
  message: string
  answers: object
}

/**
 * Where the import run stands, as the overlay and the import button read it
 */
export interface FireflyImportRunState {
  overlayPhase: ImportOverlayPhase
  stageState: FireflyImportStageState | null

  // Stopping is offered only while the upload runs. Once saving starts, the save either lands
  // whole or not at all, and stopping would only stop waiting for it
  canStop: boolean

  // An import whose save stopped for a reason saving again could clear leaves its upload staged,
  // and this is what the second attempt runs against
  stagedRunId: string | null
  failure: FireflyImportFailure | null
  completedImport: FireflyCompletedImportContext | null
}

export const FIREFLY_IMPORT_RUN_IDLE: FireflyImportRunState = {
  overlayPhase: 'idle',
  stageState: null,
  canStop: false,
  stagedRunId: null,
  failure: null,
  completedImport: null,
}

interface FireflyImportRunDependencies {
  onChange: (state: FireflyImportRunState) => void
  discardStagedRun: (runId: string) => void
  wait: (milliseconds: number) => Promise<void>
}

/**
 * Runs Firefly III import attempts and holds where the latest one stands
 *
 * The state lives here rather than in the screen's render, since the overlay keeps its buttons on
 * screen while it fades and each one carries the handler from the render before it closed. Every
 * action therefore reads the run as it really is
 */
export function createFireflyImportRunController({ onChange, discardStagedRun, wait }: FireflyImportRunDependencies) {
  let state = FIREFLY_IMPORT_RUN_IDLE

  // Tells a finished attempt whether it is still the latest one, so a reset or a newer attempt in
  // between drops its result instead of writing into what replaced it
  let attemptId = 0
  let abortController: AbortController | null = null

  // What the kept upload left out, captured when it was staged, so saving it again reports the
  // rows it really left out even if the mappings have moved since
  let stagedSkippedRows: FireflySkippedRowDetail[] = []

  const update = (patch: Partial<FireflyImportRunState>) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  /**
   * Shows one stage of the import on the overlay, holding a finished one struck off for a beat
   */
  const showStage = async (stage: FireflyImportStage, isFinished: boolean) => {
    update({ stageState: { stage, isFinished } })
    if (isFinished) await wait(FIREFLY_IMPORT_STAGE_CROSS_OFF_MS)
  }

  /**
   * Runs one attempt at the import, whether the whole upload or only saving an upload kept from
   * an attempt that failed, and records how it ended
   */
  const runAttempt = async (
    firstStage: FireflyImportStage,
    skippedRowsAtCommit: FireflySkippedRowDetail[],
    answers: object,
    attempt: (signal: AbortSignal) => Promise<FireflyImportRunResponse>,
  ) => {
    const currentAttemptId = attemptId + 1
    attemptId = currentAttemptId
    const controller = new AbortController()
    abortController = controller

    update({
      failure: null,
      completedImport: null,
      stagedRunId: null,
      canStop: firstStage === 'uploading',
      stageState: { stage: firstStage, isFinished: false },
      overlayPhase: 'importing',
    })
    const minimumOverlay = wait(FIREFLY_IMPORT_OVERLAY_MIN_MS)

    try {
      const result = await attempt(controller.signal)
      if (attemptId !== currentAttemptId) return
      update({ canStop: false, completedImport: { result, skippedRowsAtCommit } })

      // The last stage is struck off while the overlay is still importing, so it lands as visibly
      // as the upload stage did when it handed over
      await showStage('saving', true)
      await minimumOverlay
      if (attemptId !== currentAttemptId) return
      update({ overlayPhase: 'success' })
    } catch (error) {
      // Stopping is a decision the user has just taken, so the overlay answers it rather than
      // sitting out the rest of a minimum it was holding for an import nobody interrupted
      if (!controller.signal.aborted) await minimumOverlay
      if (attemptId !== currentAttemptId) return

      const failure = getImportCommitFailure(error, controller.signal.aborted)
      if (failure.discardableRunId) discardStagedRun(failure.discardableRunId)
      stagedSkippedRows = skippedRowsAtCommit
      update({
        canStop: false,
        stagedRunId: failure.retryableRunId,
        failure: { message: failure.message, answers },
        overlayPhase: controller.signal.aborted ? 'cancelled' : 'error',
      })
    } finally {
      if (abortController === controller) abortController = null
    }
  }

  return {
    getState: () => state,

    /**
     * Uploads the whole import and saves it
     *
     * @param skippedRowsAtCommit - Rows the import leaves out, captured before the first await since
     *   the response can outlive the mappings used for its request
     * @param answers - The answers the import is sent with, which a failure is reported against
     * @param upload - Sends the import, calling its second argument once everything is staged
     */
    start: (
      skippedRowsAtCommit: FireflySkippedRowDetail[],
      answers: object,
      upload: (signal: AbortSignal, onStaged: () => Promise<void>) => Promise<FireflyImportRunResponse>,
    ) => {
      const uploadMinimum = wait(FIREFLY_IMPORT_STAGE_MIN_MS)
      return runAttempt('uploading', skippedRowsAtCommit, answers, (signal) => upload(signal, async () => {
        // Nothing is saved until the upload has finished, so the stage list hands over to saving
        // before the save starts, and stopping is no longer offered from there
        await uploadMinimum
        if (signal.aborted) return
        await showStage('uploading', true)
        if (signal.aborted) return
        update({ canStop: false, stageState: { stage: 'saving', isFinished: false } })
      }))
    },

    /**
     * Saves the upload an attempt that failed while saving kept, without uploading it again
     */
    retry: async (
      answers: object,
      commit: (runId: string, signal: AbortSignal) => Promise<FireflyImportRunResponse>,
    ) => {
      const runId = state.stagedRunId
      if (!runId) return
      await runAttempt('saving', stagedSkippedRows, answers, (signal) => commit(runId, signal))
    },

    /**
     * Stops the attempt in progress, which while uploading drops what it uploaded so nothing is
     * left behind, and while saving only stops waiting, since the save is the server's to finish
     */
    stop: () => {
      abortController?.abort()
    },

    /**
     * Closes a finished overlay, and leaving a failed import behind gives up on its kept upload
     */
    close: () => {
      if (state.overlayPhase === 'idle' || state.overlayPhase === 'importing') return
      if (state.stagedRunId) discardStagedRun(state.stagedRunId)
      update({ stagedRunId: null, overlayPhase: 'idle' })
    },

    /**
     * Forgets every attempt, stopping one in progress and dropping any kept upload
     */
    reset: () => {
      attemptId += 1
      abortController?.abort()
      if (state.stagedRunId) discardStagedRun(state.stagedRunId)
      update(FIREFLY_IMPORT_RUN_IDLE)
    },
  }
}

export type FireflyImportRunController = ReturnType<typeof createFireflyImportRunController>

/**
 * Returns the last failure's reason while the answers it was about are still the ones on screen
 */
export function getFireflyImportError(failure: FireflyImportFailure | null, answers: object) {
  return failure?.answers === answers ? failure.message : null
}

/**
 * Whether Commit import can start an import now
 *
 * A file still being read has not reached the payload yet, and an import started meanwhile would
 * run without it, which for a budgets file leaves its budgets out for good
 */
export function canStartFireflyImport({
  hasPayload,
  processingFileKind,
  budgetSelectionError,
  overlayOpen,
  inFlight,
  hasResult,
}: {
  hasPayload: boolean
  processingFileKind: FireflyFileKind | null
  budgetSelectionError: string | null
  overlayOpen: boolean
  inFlight: boolean
  hasResult: boolean
}) {
  return hasPayload && processingFileKind === null && !budgetSelectionError && !overlayOpen && !inFlight && !hasResult
}

/**
 * Counts the sources answered create-new that the import sends, since the commit creates nothing
 * for a source it leaves out
 */
export function countFireflyCreatedSources(
  sources: string[],
  mappings: Record<string, string>,
  createValue: string,
  writtenSources: ReadonlySet<string>,
) {
  return sources.filter((source) => mappings[source] === createValue && writtenSources.has(source)).length
}
