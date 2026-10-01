import type { ImportRunBudgets, JournalImportRunResponse } from '@/api/provider-imports'
import { getJsonByteSize } from '@/api/shared/importBatchSize'
import { TransactionImportRunError, type StagedRunSettlement } from '@/api/transaction-imports'
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

// Added after the reason a provider import failed when the server refused it, or it failed while
// uploading, since either way it wrote nothing
const PROVIDER_IMPORT_NOTHING_SAVED_NOTE = 'Nothing was added to your ledger.'

// A save that ended with no answer may or may not have landed. Saving again from this screen
// settles it either way without writing anything twice, since the screen keeps the upload, so the
// copy leads with that and leaves what is unknown to the note for someone about to leave
const PROVIDER_IMPORT_INTERRUPTED_TITLE = 'Save interrupted'
const PROVIDER_IMPORT_INTERRUPTED_MESSAGE = 'The import was interrupted. Try again to finish saving your import. Nothing will be added twice as long as you remain on this screen.'
const PROVIDER_IMPORT_INTERRUPTED_NOTE = 'Leaving this page? Check your transactions before importing again.'
const PROVIDER_IMPORT_INTERRUPTED_FOOTER = 'Save interrupted. Please try again.'

// Why an import stopped before sending anything when the server gave no answer about the upload
// it kept. The interrupted copy above is what the user reads, so this only names the case
const PROVIDER_IMPORT_UNSETTLED_REASON = 'The interrupted save could not be checked'

/** Said in place of the summary when an import was not sent because the interrupted save had landed */
export const PROVIDER_IMPORT_SAVED_EARLIER_MESSAGE = 'Your earlier import was saved, so this one wasn\'t imported.'

/** What one completed import wrote, with the rows it left out, captured when it started */
export interface CompletedProviderImport<TSkipped> {
  result: JournalImportRunResponse
  skippedRowsAtCommit: TSkipped[]

  // Set when a save thought interrupted had landed, so what the screen shows is that earlier
  // import rather than the one just asked for, which was never sent
  savedEarlier: boolean
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

  /** Whether the save ended with no answer, so the upload is kept and may already have landed */
  interrupted: boolean
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

  // A save that ended with no answer leaves its upload staged, kept until an import from this
  // screen settles whether it landed, since starting afresh without asking could write it twice
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
  settleStagedRun: (runId: string) => Promise<StagedRunSettlement>
  wait: (milliseconds: number) => Promise<void>
}

/** How one attempt reaches the server: by uploading the whole import, or by saving a kept upload */
export interface ProviderImportRequests {
  /** Sends the import, calling its second argument once everything is staged */
  upload: (signal: AbortSignal, onStaged: () => Promise<void>) => Promise<JournalImportRunResponse>
  commit: (runId: string, signal: AbortSignal) => Promise<JournalImportRunResponse>
}

/** An attempt as it was started, kept so Try again can start it the same way */
interface ProviderImportStart<TSkipped> {
  skippedRowsAtCommit: TSkipped[]
  answers: object
  requests: ProviderImportRequests
}

/**
 * Runs provider import attempts and holds where the latest one stands
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
export function createProviderImportRunController<TSkipped>({
  onChange,
  discardStagedRun,
  settleStagedRun,
  wait,
}: ProviderImportRunDependencies<TSkipped>) {
  let state: ProviderImportRunState<TSkipped> = PROVIDER_IMPORT_RUN_IDLE

  // Tells a finished attempt whether it is still the latest one, so a reset or a newer attempt in
  // between drops its result instead of writing into what replaced it
  let attemptId = 0
  let abortController: AbortController | null = null

  // The answers the kept upload was sent with and the rows it left out, captured when it was
  // staged. They decide whether an import can save that upload as it is, and what saving it reports
  let stagedAnswers: object | null = null
  let stagedSkippedRows: TSkipped[] = []
  let lastStart: ProviderImportStart<TSkipped> | null = null

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
   * Runs one attempt at the import and records how it ended
   *
   * An upload kept from an interrupted save is saved as it is when the answers are the ones it was
   * sent with. Otherwise it is dropped first, and only an upload that was never saved lets the new
   * one go ahead. One that had landed is answered with what it wrote, and one the server gave no
   * answer about stays kept, so the next attempt asks again
   */
  const runAttempt = async ({ skippedRowsAtCommit, answers, requests }: ProviderImportStart<TSkipped>) => {
    const currentAttemptId = attemptId + 1
    attemptId = currentAttemptId
    const controller = new AbortController()
    abortController = controller
    const keptRunId = state.stagedRunId
    const keptAnswers = stagedAnswers
    const keptSkippedRows = stagedSkippedRows
    const savingKeptUpload = keptRunId !== null && keptAnswers === answers
    const firstStage: ProviderImportStage = savingKeptUpload ? 'saving' : 'uploading'

    update({
      failure: null,
      completedImport: null,
      canStop: firstStage === 'uploading',
      stageState: { stage: firstStage, isFinished: false },
      overlayPhase: 'importing',
    })
    const minimumOverlay = wait(PROVIDER_IMPORT_OVERLAY_MIN_MS)
    const uploadMinimum = wait(PROVIDER_IMPORT_STAGE_MIN_MS)

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
      let result: JournalImportRunResponse
      let savedEarlier = false
      if (keptRunId && savingKeptUpload) {
        result = await requests.commit(keptRunId, controller.signal)
      } else {
        const settlement = keptRunId ? await settleStagedRun(keptRunId) : 'discarded'
        if (settlement === 'unsettled') {
          throw new TransactionImportRunError(PROVIDER_IMPORT_UNSETTLED_REASON, 'commit', keptRunId)
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
    start: (skippedRowsAtCommit: TSkipped[], answers: object, requests: ProviderImportRequests) => {
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
      update({ ...PROVIDER_IMPORT_RUN_IDLE, stagedRunId: state.stagedRunId })
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

/** What the overlay and the line beside Commit import say about a failed import */
export interface ProviderImportFailureCopy {
  /** Replaces the overlay's own title, which is null when that title already fits */
  overlayTitle: string | null
  overlayMessage: string

  /** Set apart under the overlay's buttons, for a step that matters only to someone leaving */
  overlayNote: string | null
  footerMessage: string
}

/**
 * Says what a failed import left behind: nothing, or a save that was interrupted and may already
 * have landed, which saving again from this screen settles without writing anything twice
 */
export function describeProviderImportFailure({ message, interrupted }: Pick<ProviderImportFailure, 'message' | 'interrupted'>): ProviderImportFailureCopy {
  if (interrupted) {
    return {
      overlayTitle: PROVIDER_IMPORT_INTERRUPTED_TITLE,
      overlayMessage: PROVIDER_IMPORT_INTERRUPTED_MESSAGE,
      overlayNote: PROVIDER_IMPORT_INTERRUPTED_NOTE,
      footerMessage: PROVIDER_IMPORT_INTERRUPTED_FOOTER,
    }
  }

  const sentence = /[.!?]$/.test(message) ? message : `${message}.`
  return {
    overlayTitle: null,
    overlayMessage: `${sentence} ${PROVIDER_IMPORT_NOTHING_SAVED_NOTE}`,
    overlayNote: null,
    footerMessage: message,
  }
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
