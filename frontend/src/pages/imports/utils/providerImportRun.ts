import type { JournalImportRunResponse } from '@/api/provider-imports'
import { STEP_DOT_WAVE_MS } from '@/pages/imports/components/ProgressOverlay'
import type { ImportOverlayPhase } from '@/pages/imports/types'
import { getImportCommitFailure } from '@/pages/imports/utils/commitFailure'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

/**
 * Stage of a provider import currently holding the overlay: uploading the export, which saves
 * nothing, then writing all of it at once
 */
export type ProviderImportStage = 'uploading' | 'saving'

/**
 * Stage holding the overlay and whether its work has landed
 *
 * The finished stage keeps the overlay for a beat so it can be struck off
 * before the next stage starts, which the two fields have to express together
 */
export interface ProviderImportStageState {
  stage: ProviderImportStage
  isFinished: boolean
}

/**
 * Stages of the import in the order they run, as the overlay lists them
 */
export const PROVIDER_IMPORT_STAGES: { id: ProviderImportStage; label: string }[] = [
  { id: 'uploading', label: 'Uploading the export' },
  { id: 'saving', label: 'Saving the import' },
]

const PROVIDER_IMPORT_OVERLAY_MIN_MS = LOADING_ANIMATION_MIN_MS

/**
 * How long the upload stage holds the overlay before saving takes over
 *
 * A small export uploads faster than the transition between the stages reads, so without a floor
 * the upload stage would flash past unseen. The floor is pinned to one full dot wave so a stage is
 * never struck off mid-cycle
 */
const PROVIDER_IMPORT_STAGE_MIN_MS = STEP_DOT_WAVE_MS

/**
 * How long a finished stage stays on the overlay struck off before the next
 * stage takes its place
 *
 * The strike is what tells the user the stage landed, so this has to outlast
 * the line being drawn and leave a beat to read it afterwards
 */
export const PROVIDER_IMPORT_STAGE_CROSS_OFF_MS = 750

/**
 * Largest budgets request an import sends, kept under the server's 10 MiB request limit with room
 * for the rest of the request, so a selection too large to send is refused before anything uploads
 */
export const PROVIDER_MAX_BUDGETS_REQUEST_BYTES = 9 * 1024 * 1024

// Added after the reason a provider import failed. An import the server refused, or one that failed
// while uploading, wrote nothing. A save that failed for another reason may or may not have landed,
// and saving it again answers either way
const PROVIDER_IMPORT_NOTHING_SAVED_NOTE = 'Nothing was added to your ledger.'
const PROVIDER_IMPORT_SAVE_AGAIN_NOTE = 'Your upload is kept, so you can try saving it again.'

/** What one completed import wrote, with the rows it left out, captured when it started */
export interface CompletedProviderImport<TSkipped> {
  result: JournalImportRunResponse
  skippedRowsAtCommit: TSkipped[]
}

/** Why the last attempt failed, with the answers it was started with */
export interface ProviderImportFailure {
  message: string
  answers: object
}

/**
 * Where the import run stands, as the overlay and the import button read it
 */
export interface ProviderImportRunState<TSkipped = unknown> {
  overlayPhase: ImportOverlayPhase
  stageState: ProviderImportStageState | null

  // Stopping is offered only while the upload runs. Once saving starts, the save either lands
  // whole or not at all, and stopping would only stop waiting for it
  canStop: boolean

  // An import whose save stopped for a reason saving again could clear leaves its upload staged,
  // and this is what the second attempt runs against
  stagedRunId: string | null
  failure: ProviderImportFailure | null
  completedImport: CompletedProviderImport<TSkipped> | null
}

export const PROVIDER_IMPORT_RUN_IDLE: ProviderImportRunState<never> = {
  overlayPhase: 'idle',
  stageState: null,
  canStop: false,
  stagedRunId: null,
  failure: null,
  completedImport: null,
}

interface ProviderImportRunDependencies<TSkipped> {
  onChange: (state: ProviderImportRunState<TSkipped>) => void
  discardStagedRun: (runId: string) => void
  wait: (milliseconds: number) => Promise<void>
}

/**
 * Runs provider import attempts and holds where the latest one stands
 *
 * The state lives here rather than in the screen's render, since the overlay keeps its buttons on
 * screen while it fades and each one carries the handler from the render before it closed. Every
 * action therefore reads the run as it really is
 */
export function createProviderImportRunController<TSkipped>({
  onChange,
  discardStagedRun,
  wait,
}: ProviderImportRunDependencies<TSkipped>) {
  let state: ProviderImportRunState<TSkipped> = PROVIDER_IMPORT_RUN_IDLE

  // Tells a finished attempt whether it is still the latest one, so a reset or a newer attempt in
  // between drops its result instead of writing into what replaced it
  let attemptId = 0
  let abortController: AbortController | null = null

  // What the kept upload left out, captured when it was staged, so saving it again reports the
  // rows it really left out even if the mappings have moved since
  let stagedSkippedRows: TSkipped[] = []

  const update = (patch: Partial<ProviderImportRunState<TSkipped>>) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  /**
   * Shows one stage of the import on the overlay, holding a finished one struck off for a beat
   */
  const showStage = async (stage: ProviderImportStage, isFinished: boolean) => {
    update({ stageState: { stage, isFinished } })
    if (isFinished) await wait(PROVIDER_IMPORT_STAGE_CROSS_OFF_MS)
  }

  /**
   * Runs one attempt at the import, whether the whole upload or only saving an upload kept from
   * an attempt that failed, and records how it ended
   */
  const runAttempt = async (
    firstStage: ProviderImportStage,
    skippedRowsAtCommit: TSkipped[],
    answers: object,
    attempt: (signal: AbortSignal) => Promise<JournalImportRunResponse>,
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
    const minimumOverlay = wait(PROVIDER_IMPORT_OVERLAY_MIN_MS)

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
      skippedRowsAtCommit: TSkipped[],
      answers: object,
      upload: (signal: AbortSignal, onStaged: () => Promise<void>) => Promise<JournalImportRunResponse>,
    ) => {
      const uploadMinimum = wait(PROVIDER_IMPORT_STAGE_MIN_MS)
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
      commit: (runId: string, signal: AbortSignal) => Promise<JournalImportRunResponse>,
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
      update(PROVIDER_IMPORT_RUN_IDLE)
    },
  }
}

export type ProviderImportRunController<TSkipped> = ReturnType<typeof createProviderImportRunController<TSkipped>>

/**
 * Returns the last failure's reason while the answers it was about are still the ones on screen
 */
export function getProviderImportError(failure: ProviderImportFailure | null, answers: object) {
  return failure?.answers === answers ? failure.message : null
}

/**
 * Whether Commit import can start an import now
 *
 * A file still being read has not reached the payload yet, and an import started meanwhile would
 * run without it, which could leave part of what it holds out for good
 */
export function canStartProviderImport({
  hasPayload,
  isProcessingFile,
  budgetSelectionError,
  overlayOpen,
  inFlight,
  hasResult,
}: {
  hasPayload: boolean
  isProcessingFile: boolean
  budgetSelectionError: string | null
  overlayOpen: boolean
  inFlight: boolean
  hasResult: boolean
}) {
  return hasPayload && !isProcessingFile && !budgetSelectionError && !overlayOpen && !inFlight && !hasResult
}

/**
 * Counts the sources answered create-new that the import sends, since the commit creates nothing
 * for a source it leaves out
 */
export function countCreatedImportSources(
  sources: string[],
  mappings: Record<string, string>,
  createValue: string,
  writtenSources: ReadonlySet<string>,
) {
  return sources.filter((source) => mappings[source] === createValue && writtenSources.has(source)).length
}

/**
 * Says why an import failed and what that left behind: nothing, or an upload that can be saved again
 */
export function describeProviderImportFailure(reason: string, canSaveAgain: boolean) {
  const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`
  return `${sentence} ${canSaveAgain ? PROVIDER_IMPORT_SAVE_AGAIN_NOTE : PROVIDER_IMPORT_NOTHING_SAVED_NOTE}`
}

/**
 * Formats the import result into the overlay summary line
 *
 * Budgets and archived accounts only join the line when the commit wrote some, so an import
 * without them reads as a transactions import alone
 *
 * @param result - What the commit wrote
 * @param skippedCount - Rows the browser left out because they cannot be written
 */
export function formatProviderImportSummary(result: JournalImportRunResponse, skippedCount: number) {
  const parts = [
    `${result.rows_imported} row${result.rows_imported === 1 ? '' : 's'} imported`,
    `${result.transactions_created} transaction${result.transactions_created === 1 ? '' : 's'} created`,
    `${skippedCount} skipped`,
  ]
  if (result.budgets_created > 0) {
    parts.push(`${result.budgets_created} budget${result.budgets_created === 1 ? '' : 's'} imported`)
  }
  if (result.accounts_archived > 0) {
    parts.push(`${result.accounts_archived} account${result.accounts_archived === 1 ? '' : 's'} archived`)
  }

  return parts.join(' · ')
}
