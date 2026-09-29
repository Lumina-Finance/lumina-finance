import type { ImportRunBudgets, JournalImportRunResponse } from '@/api/provider-imports'
import { getJsonByteSize } from '@/api/shared/importBatchSize'
import { STEP_DOT_WAVE_MS } from '@/pages/imports/components/ProgressOverlay'
import type { ImportOverlayPhase } from '@/pages/imports/types'
import { getImportCommitFailure } from '@/pages/imports/utils/commitFailure'
import type { UnconfirmedImportSave, UnconfirmedImportSaveStore } from '@/pages/imports/utils/unconfirmedImportSave'
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

/**
 * Builds the budgets a provider import creates alongside its rows, or the reason it can't. Built
 * ahead of the import so a budget it cannot send is refused while the selection can still change
 */
export function buildProviderRunBudgets(build: () => ImportRunBudgets): { budgets: ImportRunBudgets | null; error: string | null } {
  try {
    const budgets = build()

    // The budgets go in one request, and a request past the server's limit is refused whole
    if (getJsonByteSize(budgets) > PROVIDER_MAX_BUDGETS_REQUEST_BYTES) {
      return { budgets: null, error: 'The selected budgets are too large to import at once. Select fewer budgets.' }
    }
    return { budgets, error: null }
  } catch (error) {
    return { budgets: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Why the selected budgets can't be imported, if they can't. The importer takes a bounded number of
 * budgets, and its refusal would name none of them
 */
export function getProviderBudgetSelectionError(selectedCount: number, maxBudgets: number, buildError: string | null) {
  return selectedCount > maxBudgets
    ? `Select at most ${maxBudgets.toLocaleString()} budgets to import, since the importer takes up to that many at once.`
    : buildError
}

// Added after the reason a provider import failed, which is only ever one known to have written
// nothing: the server refused it, or it stopped before the save was sent
const PROVIDER_IMPORT_NOTHING_SAVED_NOTE = 'Nothing was added to your ledger.'

// Shown in place of a reason when a save was sent and never answered, since the reason says
// nothing about whether it landed. Saving the same run again is safe because the server answers a
// committed run with what it wrote rather than writing it again
const PROVIDER_IMPORT_UNCONFIRMED_MESSAGE = "We couldn't confirm whether your import was saved, so it may already have gone through. Try again to check. If it was saved, you'll see what it added, and trying again never adds your transactions twice."

/** What one completed import wrote, with the rows it left out, captured when it started */
export interface CompletedProviderImport<TSkipped> {
  result: JournalImportRunResponse

  /** Empty for a save the page learned about after being left, since only the count was kept */
  skippedRowsAtCommit: TSkipped[]
  skippedCount: number
}

/**
 * Selects the skipped rows the preview shows, with its title. Once the import has run, they are the
 * rows it was started with, since later answers no longer change what it wrote
 *
 * The weekly checks read the title after the import, so its wording is theirs to match
 */
export function getProviderSkippedRowsDisplay<TSkipped>({
  liveForecastRows,
  completedImport,
}: {
  liveForecastRows: TSkipped[]
  completedImport: CompletedProviderImport<TSkipped> | null
}) {
  const rows = completedImport?.skippedRowsAtCommit ?? liveForecastRows
  const totalCount = rows.length
  const plural = totalCount === 1 ? '' : 's'
  return {
    rows,
    totalCount,
    title: completedImport
      ? `${totalCount} row${plural} ${totalCount === 1 ? 'was' : 'were'} not imported`
      : `${totalCount} row${plural} will not be imported`,
  }
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

  // A save that was sent and never answered may already have landed, so its run is held until the
  // server answers for it. Saving again runs against this, and nothing new can start meanwhile
  stagedRunId: string | null

  // Whether the browser kept that save past the page. One it refused to keep lives only here, so the
  // overlay offers no way to leave it that would lose it
  isSaveRemembered: boolean
  failure: ProviderImportFailure | null
  completedImport: CompletedProviderImport<TSkipped> | null
}

export const PROVIDER_IMPORT_RUN_IDLE: ProviderImportRunState<never> = {
  overlayPhase: 'idle',
  stageState: null,
  canStop: false,
  stagedRunId: null,
  isSaveRemembered: false,
  failure: null,
  completedImport: null,
}

interface ProviderImportRunDependencies<TSkipped> {
  onChange: (state: ProviderImportRunState<TSkipped>) => void
  discardStagedRun: (runId: string) => void
  wait: (milliseconds: number) => Promise<void>

  /** Keeps each sent save past the page until the server answers for it */
  unconfirmedSaves: UnconfirmedImportSaveStore
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
  unconfirmedSaves,
}: ProviderImportRunDependencies<TSkipped>) {
  let state: ProviderImportRunState<TSkipped> = PROVIDER_IMPORT_RUN_IDLE

  // Tells a finished attempt whether it is still the latest one, so a reset or a newer attempt in
  // between drops its result instead of writing into what replaced it
  let attemptId = 0
  let abortController: AbortController | null = null

  // What the kept upload left out, captured when it was staged, so saving it again reports the
  // rows it really left out even if the mappings have moved since. A save remembered from before
  // the page opened brings only the count
  let stagedSkippedRows: TSkipped[] = []
  let stagedSkippedCount = 0

  // The run whose save the latest attempt sent, remembered past the page until the server answers
  let sentRunId: string | null = null
  let hasResumed = false

  // How to ask the server about a remembered save, kept from the first time the page asked, so an
  // import started later settles one another tab has since left unanswered before it uploads
  let checkSave: ((runId: string) => Promise<JournalImportRunResponse>) | null = null

  const update = (patch: Partial<ProviderImportRunState<TSkipped>>) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  const rememberSentSave = (runId: string, skippedCount: number) => {
    sentRunId = runId
    update({ isSaveRemembered: unconfirmedSaves.record({ runId, skippedCount }) })
  }

  const forgetSentSave = () => {
    if (sentRunId) unconfirmedSaves.clear(sentRunId)
    sentRunId = null
  }

  /**
   * Shows one stage of the import on the overlay, holding a finished one struck off for a beat
   */
  const showStage = async (stage: ProviderImportStage, isFinished: boolean) => {
    update({ stageState: { stage, isFinished } })
    if (isFinished) await wait(PROVIDER_IMPORT_STAGE_CROSS_OFF_MS)
  }

  /**
   * Records how an attempt ended without landing. A save the server may have written holds the
   * overlay until it is answered for, and anything known to have written nothing lets it close
   */
  const reportFailure = (error: unknown, cancelled: boolean, answers: object) => {
    const failure = getImportCommitFailure(error, cancelled)
    if (failure.discardableRunId) discardStagedRun(failure.discardableRunId)
    if (!failure.retryableRunId) forgetSentSave()
    update({
      canStop: false,
      stagedRunId: failure.retryableRunId,
      failure: { message: failure.message, answers },
      overlayPhase: failure.retryableRunId ? 'unconfirmed' : cancelled ? 'cancelled' : 'error',
    })
  }

  /**
   * Runs one attempt at the import, whether the whole upload or only saving an upload kept from
   * an attempt that failed, and records how it ended
   */
  const runAttempt = async (
    firstStage: ProviderImportStage,
    skipped: { rows: TSkipped[]; count: number },
    answers: object,
    attempt: (signal: AbortSignal) => Promise<JournalImportRunResponse>,
  ) => {
    const currentAttemptId = attemptId + 1
    attemptId = currentAttemptId
    const controller = new AbortController()
    abortController = controller
    sentRunId = null

    update({
      failure: null,
      completedImport: null,
      stagedRunId: null,
      isSaveRemembered: false,
      canStop: firstStage === 'uploading',
      stageState: { stage: firstStage, isFinished: false },
      overlayPhase: 'importing',
    })
    const minimumOverlay = wait(PROVIDER_IMPORT_OVERLAY_MIN_MS)

    try {
      const result = await attempt(controller.signal)
      if (attemptId !== currentAttemptId) return
      forgetSentSave()
      update({ canStop: false, completedImport: { result, skippedRowsAtCommit: skipped.rows, skippedCount: skipped.count } })

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

      stagedSkippedRows = skipped.rows
      stagedSkippedCount = skipped.count
      reportFailure(error, controller.signal.aborted, answers)
    } finally {
      if (abortController === controller) abortController = null
    }
  }

  /**
   * Holds the overlay on a save this browser remembered and asks the server whether it landed.
   * Asking writes nothing, so a save it cannot yet answer for stays open for the user to save again
   */
  const settleRememberedSave = async (
    save: UnconfirmedImportSave,
    answers: object,
    check: (runId: string) => Promise<JournalImportRunResponse>,
  ) => {
    const currentAttemptId = attemptId
    sentRunId = save.runId
    stagedSkippedRows = []
    stagedSkippedCount = save.skippedCount
    update({ overlayPhase: 'unconfirmed', stagedRunId: save.runId, isSaveRemembered: true, failure: null })

    try {
      const result = await check(save.runId)
      if (attemptId !== currentAttemptId) return
      forgetSentSave()
      update({
        stagedRunId: null,
        completedImport: { result, skippedRowsAtCommit: [], skippedCount: save.skippedCount },
        overlayPhase: 'success',
      })
    } catch (error) {
      if (attemptId !== currentAttemptId) return
      const failure = getImportCommitFailure(error, false)

      // Still unanswered, so the overlay keeps offering to save it again
      if (failure.retryableRunId) return
      reportFailure(error, false, answers)
    }
  }

  return {
    getState: () => state,

    /**
     * Uploads the whole import and saves it, unless this browser still holds a save nobody has
     * answered for, which is settled first instead
     *
     * @param skippedRowsAtCommit - Rows the import leaves out, captured before the first await since
     *   the response can outlive the mappings used for its request
     * @param answers - The answers the import is sent with, which a failure is reported against
     * @param upload - Sends the import, calling its second argument with the run once everything
     *   is staged
     */
    start: (
      skippedRowsAtCommit: TSkipped[],
      answers: object,
      upload: (signal: AbortSignal, onStaged: (runId: string) => Promise<void>) => Promise<JournalImportRunResponse>,
    ) => {
      // A save still unanswered, whether from another tab or one the page already settled another
      // save ahead of, is answered for before anything new uploads, since it may hold this import
      const remembered = checkSave ? unconfirmedSaves.readOldest() : null
      if (checkSave && remembered) return settleRememberedSave(remembered, answers, checkSave)

      const uploadMinimum = wait(PROVIDER_IMPORT_STAGE_MIN_MS)
      const skipped = { rows: skippedRowsAtCommit, count: skippedRowsAtCommit.length }
      return runAttempt('uploading', skipped, answers, (signal) => upload(signal, async (runId) => {
        // Nothing is saved until the upload has finished, so the stage list hands over to saving
        // before the save starts, and stopping is no longer offered from there
        await uploadMinimum
        if (signal.aborted) return
        await showStage('uploading', true)
        if (signal.aborted) return
        update({ canStop: false, stageState: { stage: 'saving', isFinished: false } })
        rememberSentSave(runId, skipped.count)
      }))
    },

    /**
     * Saves the upload a save that went unanswered kept, without uploading it again. The server
     * answers a run it already committed with what it wrote, so this settles either way
     */
    retry: async (
      answers: object,
      commit: (runId: string, signal: AbortSignal) => Promise<JournalImportRunResponse>,
    ) => {
      const runId = state.stagedRunId
      if (!runId) return
      const skipped = { rows: stagedSkippedRows, count: stagedSkippedCount }
      await runAttempt('saving', skipped, answers, (signal) => {
        rememberSentSave(runId, skipped.count)
        return commit(runId, signal)
      })
    },

    /**
     * Picks up the oldest save this browser sent and never heard back about when the page opens, and
     * keeps the way to ask about one for any import started later
     *
     * @param answers - The answers on screen, which a failure the server gives is reported against
     * @param check - Asks for what the run's commit wrote
     */
    resume: async (
      answers: object,
      check: (runId: string) => Promise<JournalImportRunResponse>,
    ) => {
      if (hasResumed || state.overlayPhase !== 'idle') return
      hasResumed = true
      checkSave = check
      const save = unconfirmedSaves.readOldest()
      if (save) await settleRememberedSave(save, answers, check)
    },

    /**
     * Stops the attempt in progress, which while uploading drops what it uploaded so nothing is
     * left behind, and while saving only stops waiting, since the save is the server's to finish
     */
    stop: () => {
      abortController?.abort()
    },

    /**
     * Closes a finished overlay, and leaving a failed import behind gives up on its kept upload. A
     * save nobody has answered for can't be closed on, since starting again could import it twice
     */
    close: () => {
      if (state.overlayPhase === 'idle' || state.overlayPhase === 'importing' || state.overlayPhase === 'unconfirmed') return
      if (state.stagedRunId) discardStagedRun(state.stagedRunId)
      update({ stagedRunId: null, overlayPhase: 'idle' })
    },

    /**
     * Forgets every attempt, stopping one in progress and dropping any kept upload
     *
     * The saves remembered past the page stay, since only the server can say one did not land.
     * Everything that resets sits under the overlay, which a save in flight or unanswered holds
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
 * What the overlay says about an import that ended without landing: that a save nobody answered
 * for may already have gone through, or why a failed one wrote nothing. A stopped import keeps
 * its own message
 */
export function describeProviderImportFailure(phase: ImportOverlayPhase, reason: string | null) {
  if (phase === 'unconfirmed') return PROVIDER_IMPORT_UNCONFIRMED_MESSAGE
  if (phase !== 'error' || reason === null) return reason
  const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`
  return `${sentence} ${PROVIDER_IMPORT_NOTHING_SAVED_NOTE}`
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
