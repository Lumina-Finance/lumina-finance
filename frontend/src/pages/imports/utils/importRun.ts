import { ImportRunError, type StagedRunSettlement } from '@/api/import-runs'
import { STEP_DOT_WAVE_MS } from '@/pages/imports/components/ProgressOverlay'
import type { ImportOverlayPhase } from '@/pages/imports/types'
import { getImportCommitFailure } from '@/pages/imports/utils/commitFailure'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

/**
 * Stage of an import currently holding the overlay: uploading the file, which saves nothing, then
 * writing all of it at once
 */
export type ImportRunStage = 'uploading' | 'saving'

/**
 * Stage holding the overlay and whether its work has landed
 *
 * The finished stage keeps the overlay for a beat so it can be struck off
 * before the next stage starts, which the two fields have to express together
 */
export interface ImportRunStageState {
  stage: ImportRunStage
  isFinished: boolean
}

/**
 * Stages of the import in the order they run, as the overlay lists them
 */
export const IMPORT_RUN_STAGE_ORDER: ImportRunStage[] = ['uploading', 'saving']

/** What the overlay calls the save, which is the same for every import */
export const IMPORT_RUN_SAVING_LABEL = 'Saving the import'

const IMPORT_RUN_OVERLAY_MIN_MS = LOADING_ANIMATION_MIN_MS

/**
 * How long the upload stage holds the overlay before saving takes over
 *
 * A small import uploads faster than the transition between the stages reads, so without a floor
 * the upload stage would flash past unseen. The floor is pinned to one full dot wave so a stage is
 * never struck off mid-cycle
 */
const IMPORT_RUN_STAGE_MIN_MS = STEP_DOT_WAVE_MS

/**
 * How long a finished stage stays on the overlay struck off before the next
 * stage takes its place
 *
 * The strike is what tells the user the stage landed, so this has to outlast
 * the line being drawn and leave a beat to read it afterwards
 */
export const IMPORT_RUN_STAGE_CROSS_OFF_MS = 750

// Added after the reason an import failed when the server refused it, or it failed while
// uploading, since either way it wrote nothing
const IMPORT_RUN_NOTHING_SAVED_NOTE = 'Nothing was added to your ledger.'

// A save that ended with no answer may or may not have landed. Saving again from this screen
// settles it either way without writing anything twice, since the screen keeps the upload, so the
// copy leads with that and leaves what is unknown to the note for someone about to leave
const IMPORT_RUN_INTERRUPTED_TITLE = 'Save interrupted'
const IMPORT_RUN_INTERRUPTED_MESSAGE = 'The import was interrupted. Try again to finish saving your import. Nothing will be added twice as long as you stay on the import page.'
// The one condition the promise rests on, set in bold so it isn't read past
const IMPORT_RUN_INTERRUPTED_EMPHASIS = 'stay on the import page'
const IMPORT_RUN_INTERRUPTED_NOTE = 'Leaving the import page? Check your transactions before importing again.'
const IMPORT_RUN_INTERRUPTED_FOOTER = 'Save interrupted. Please try again.'

// Why an import stopped before sending anything when the server gave no answer about the upload
// it kept. The interrupted copy above is what the user reads, so this only names the case
const IMPORT_RUN_UNSETTLED_REASON = 'The interrupted save could not be checked'

/** Said in place of the summary when an import was not sent because the interrupted save had landed */
export const IMPORT_SAVED_EARLIER_MESSAGE = 'Your earlier import was saved, so this one wasn\'t imported.'

/** What one completed import wrote, with the rows it left out, captured when it started */
export interface CompletedImport<TResult, TSkipped> {
  result: TResult
  skippedRowsAtCommit: TSkipped[]

  // Set when a save thought interrupted had landed, so what the screen shows is that earlier
  // import rather than the one just asked for, which was never sent
  savedEarlier: boolean
}

/** Why the last attempt failed, with the answers it was started with */
export interface ImportRunFailure {
  message: string
  answers: object

  /** Whether the save ended with no answer, so the upload is kept and may already have landed */
  interrupted: boolean
}

/**
 * Where the import run stands, as the overlay and the import button read it
 */
export interface ImportRunState<TResult, TSkipped = unknown> {
  overlayPhase: ImportOverlayPhase
  stageState: ImportRunStageState | null

  // Stopping is offered only while the upload runs. Once saving starts, the save either lands
  // whole or not at all, and stopping would only stop waiting for it
  canStop: boolean

  // A save that ended with no answer leaves its upload staged, kept until an import from this
  // screen settles whether it landed, since starting afresh without asking could write it twice
  stagedRunId: string | null
  failure: ImportRunFailure | null
  completedImport: CompletedImport<TResult, TSkipped> | null
}

export const IMPORT_RUN_IDLE: ImportRunState<never, never> = {
  overlayPhase: 'idle',
  stageState: null,
  canStop: false,
  stagedRunId: null,
  failure: null,
  completedImport: null,
}

interface ImportRunDependencies<TResult, TSkipped> {
  onChange: (state: ImportRunState<TResult, TSkipped>) => void
  discardStagedRun: (runId: string) => void
  settleStagedRun: (runId: string) => Promise<StagedRunSettlement>
  wait: (milliseconds: number) => Promise<void>
}

/** How one attempt reaches the server: by uploading the whole import, or by saving a kept upload */
export interface ImportRunRequests<TResult> {
  /** Sends the import, calling its second argument once everything is staged */
  upload: (signal: AbortSignal, onStaged: () => Promise<void>) => Promise<TResult>
  commit: (runId: string, signal: AbortSignal) => Promise<TResult>
}

/** An attempt as it was started, kept so Try again can start it the same way */
interface ImportRunStart<TResult, TSkipped> {
  skippedRowsAtCommit: TSkipped[]
  answers: object
  requests: ImportRunRequests<TResult>
}

/**
 * Runs import attempts and holds where the latest one stands
 *
 * The state lives here rather than in the screen's render, since the overlay keeps its buttons on
 * screen while it fades and each one carries the handler from the render before it closed. Every
 * action therefore reads the run as it really is
 *
 * A save that ends with no answer may have landed, so its upload is kept for as long as the screen
 * is open, whatever the user does next. Saving it again lands it at most once, and an import
 * started with other answers first drops it, which the server refuses for an upload that had
 * landed. Either way nothing is written twice
 */
export function createImportRunController<TResult, TSkipped>({
  onChange,
  discardStagedRun,
  settleStagedRun,
  wait,
}: ImportRunDependencies<TResult, TSkipped>) {
  let state: ImportRunState<TResult, TSkipped> = IMPORT_RUN_IDLE

  // Tells a finished attempt whether it is still the latest one, so a reset or a newer attempt in
  // between drops its result instead of writing into what replaced it
  let attemptId = 0
  let abortController: AbortController | null = null

  // The answers the kept upload was sent with and the rows it left out, captured when it was
  // staged. They decide whether an import can save that upload as it is, and what saving it reports
  let stagedAnswers: object | null = null
  let stagedSkippedRows: TSkipped[] = []
  let lastStart: ImportRunStart<TResult, TSkipped> | null = null

  const update = (patch: Partial<ImportRunState<TResult, TSkipped>>) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  /**
   * Shows one stage of the import on the overlay, holding a finished one struck off for a beat
   */
  const showStage = async (stage: ImportRunStage, isFinished: boolean) => {
    update({ stageState: { stage, isFinished } })
    if (isFinished) await wait(IMPORT_RUN_STAGE_CROSS_OFF_MS)
  }

  /**
   * Runs one attempt at the import and records how it ended
   *
   * An upload kept from an interrupted save is saved as it is when the answers are the ones it was
   * sent with. Otherwise it is dropped first, and only an upload that was never saved lets the new
   * one go ahead. One that had landed is answered with what it wrote, and one the server gave no
   * answer about stays kept, so the next attempt asks again
   */
  const runAttempt = async ({ skippedRowsAtCommit, answers, requests }: ImportRunStart<TResult, TSkipped>) => {
    const currentAttemptId = attemptId + 1
    attemptId = currentAttemptId
    const controller = new AbortController()
    abortController = controller
    const keptRunId = state.stagedRunId
    const keptAnswers = stagedAnswers
    const keptSkippedRows = stagedSkippedRows
    const savingKeptUpload = keptRunId !== null && keptAnswers === answers
    const firstStage: ImportRunStage = savingKeptUpload ? 'saving' : 'uploading'

    update({
      failure: null,
      completedImport: null,
      canStop: firstStage === 'uploading',
      stageState: { stage: firstStage, isFinished: false },
      overlayPhase: 'importing',
    })
    const minimumOverlay = wait(IMPORT_RUN_OVERLAY_MIN_MS)
    const uploadMinimum = wait(IMPORT_RUN_STAGE_MIN_MS)

    // Nothing is saved until the upload has finished, so the stage list hands over to saving
    // before the save starts, and stopping is no longer offered from there
    const handOverToSaving = async () => {
      await uploadMinimum
      if (controller.signal.aborted) return
      await showStage('uploading', true)
      if (controller.signal.aborted) return
      update({ canStop: false, stageState: { stage: 'saving', isFinished: false } })
    }

    // Which run an interrupted save leaves kept, and what it was sent with: the kept upload while
    // this attempt is still working out what became of it, and the new upload once one is sent
    let runAnswers = keptAnswers ?? answers
    let runSkippedRows = keptRunId ? keptSkippedRows : skippedRowsAtCommit

    try {
      let result: TResult
      let savedEarlier = false
      if (keptRunId && savingKeptUpload) {
        result = await requests.commit(keptRunId, controller.signal)
      } else {
        const settlement = keptRunId ? await settleStagedRun(keptRunId) : 'discarded'
        if (settlement === 'unsettled') {
          throw new ImportRunError(IMPORT_RUN_UNSETTLED_REASON, 'commit', keptRunId)
        }
        if (keptRunId && settlement === 'saved') {
          // Saving a run that was committed only answers with what that commit wrote
          result = await requests.commit(keptRunId, controller.signal)
          savedEarlier = true
        } else {
          runAnswers = answers
          runSkippedRows = skippedRowsAtCommit
          result = await requests.upload(controller.signal, handOverToSaving)
        }
      }
      if (attemptId !== currentAttemptId) return
      stagedAnswers = null
      stagedSkippedRows = []
      update({
        canStop: false,
        stagedRunId: null,
        completedImport: { result, skippedRowsAtCommit: runSkippedRows, savedEarlier },
      })

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
      stagedAnswers = failure.retryableRunId ? runAnswers : null
      stagedSkippedRows = failure.retryableRunId ? runSkippedRows : []
      update({
        canStop: false,
        stagedRunId: failure.retryableRunId,
        failure: {
          message: failure.message,
          answers,
          interrupted: failure.retryableRunId !== null && !controller.signal.aborted,
        },
        overlayPhase: controller.signal.aborted ? 'cancelled' : 'error',
      })
    } finally {
      if (abortController === controller) abortController = null
    }
  }

  return {
    getState: () => state,

    /**
     * Imports with the answers on screen, saving or settling an upload kept from an interrupted save first
     *
     * @param skippedRowsAtCommit - Rows the import leaves out, captured before the first await since
     *   the response can outlive the mappings used for its request
     * @param answers - The answers the import is sent with, which a failure is reported against
     * @param requests - How the import reaches the server
     */
    start: (skippedRowsAtCommit: TSkipped[], answers: object, requests: ImportRunRequests<TResult>) => {
      lastStart = { skippedRowsAtCommit, answers, requests }
      return runAttempt(lastStart)
    },

    /**
     * Starts the last import again as it was started, which saves an interrupted upload it kept
     */
    retry: async () => {
      if (lastStart) await runAttempt(lastStart)
    },

    /**
     * Stops the attempt in progress, which while uploading drops what it uploaded so nothing is
     * left behind, and while saving only stops waiting, since the save is the server's to finish
     */
    stop: () => {
      abortController?.abort()
    },

    /**
     * Closes a finished overlay, keeping any upload an interrupted save left, so importing again
     * from this screen settles it rather than writing its rows a second time
     */
    close: () => {
      if (state.overlayPhase === 'idle' || state.overlayPhase === 'importing') return
      update({ overlayPhase: 'idle' })
    },

    /**
     * Forgets every attempt, stopping one in progress, but keeps an upload an interrupted save left
     * for the next import on this screen to settle
     */
    reset: () => {
      attemptId += 1
      abortController?.abort()
      update({ ...IMPORT_RUN_IDLE, stagedRunId: state.stagedRunId })
    },
  }
}

export type ImportRunController<TResult, TSkipped> = ReturnType<typeof createImportRunController<TResult, TSkipped>>

/**
 * Returns the last failure's reason while the answers it was about are still the ones on screen
 */
export function getImportRunError(failure: ImportRunFailure | null, answers: object) {
  return failure?.answers === answers ? failure.message : null
}

/**
 * Whether Commit import can start an import now
 *
 * A file still being read has not reached the payload yet, and an import started meanwhile would
 * run without it, which could leave part of what it holds out for good
 *
 * @param blockReason - Why the import's own answers can't be sent yet, such as a budget selection
 *   too large to send, or null when nothing holds it back
 */
export function canStartImport({
  hasPayload,
  isProcessingFile,
  blockReason,
  overlayOpen,
  inFlight,
  hasResult,
}: {
  hasPayload: boolean
  isProcessingFile: boolean
  blockReason: string | null
  overlayOpen: boolean
  inFlight: boolean
  hasResult: boolean
}) {
  return hasPayload && !isProcessingFile && !blockReason && !overlayOpen && !inFlight && !hasResult
}

/** What the overlay and the line beside Commit import say about a failed import */
export interface ImportRunFailureCopy {
  /** Replaces the overlay's own title, which is null when that title already fits */
  overlayTitle: string | null
  overlayMessage: string

  /** Words of the overlay message set in bold, or null when none need it */
  overlayEmphasis: string | null

  /** Set apart under the overlay's buttons, for a step that matters only to someone leaving */
  overlayNote: string | null
  footerMessage: string
}

/**
 * Says what a failed import left behind: nothing, or a save that was interrupted and may already
 * have landed, which saving again from this screen settles without writing anything twice
 */
export function describeImportRunFailure({ message, interrupted }: Pick<ImportRunFailure, 'message' | 'interrupted'>): ImportRunFailureCopy {
  if (interrupted) {
    return {
      overlayTitle: IMPORT_RUN_INTERRUPTED_TITLE,
      overlayMessage: IMPORT_RUN_INTERRUPTED_MESSAGE,
      overlayEmphasis: IMPORT_RUN_INTERRUPTED_EMPHASIS,
      overlayNote: IMPORT_RUN_INTERRUPTED_NOTE,
      footerMessage: IMPORT_RUN_INTERRUPTED_FOOTER,
    }
  }

  const sentence = /[.!?]$/.test(message) ? message : `${message}.`
  return {
    overlayTitle: null,
    overlayMessage: `${sentence} ${IMPORT_RUN_NOTHING_SAVED_NOTE}`,
    overlayEmphasis: null,
    overlayNote: null,
    footerMessage: message,
  }
}
