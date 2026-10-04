/**
 * Guards the import run every import saves through: an interrupted save keeps its upload so nothing
 * is imported twice, Try again saves it, a fresh import settles it first, and the failure wording says
 * what happened
 */
import { describe, expect, it, vi } from 'vitest'
import type { JournalImportRunResponse } from '@/api/provider-imports'
import { ImportRunError, type StagedRunSettlement } from '@/api/import-runs'
import type { FireflySkippedRowDetail } from '@/pages/imports/firefly/utils'
import {
  canStartImport,
  createImportRunController,
  describeImportRunFailure,
  getImportRunError,
  type ImportRunState,
} from '@/pages/imports/utils'

const RESULT = { rows_imported: 3 } as JournalImportRunResponse
const SKIPPED_AT_START: FireflySkippedRowDetail[] = [{ id: 'file-1-6', journalId: '7', rowNumber: 8, cells: {}, reason: 'Left out' }]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** A controller whose minimum waits end at once, recording every state it reports */
function createHarness(settlement: StagedRunSettlement = 'discarded') {
  const states: ImportRunState<JournalImportRunResponse, FireflySkippedRowDetail>[] = []
  const discardStagedRun = vi.fn()
  const settleStagedRun = vi.fn().mockResolvedValue(settlement)
  const controller = createImportRunController<JournalImportRunResponse, FireflySkippedRowDetail>({
    onChange: (state) => states.push(state),
    discardStagedRun,
    settleStagedRun,
    wait: () => Promise.resolve(),
  })
  return { controller, states, discardStagedRun, settleStagedRun }
}

/** Requests whose upload succeeds and whose save of a kept upload answers with what was saved */
function createRequests(result: JournalImportRunResponse = RESULT) {
  return {
    upload: vi.fn(async (_signal: AbortSignal, onStaged: () => Promise<void>) => {
      await onStaged()
      return result
    }),
    commit: vi.fn().mockResolvedValue(RESULT),
  }
}

/** An upload that stages, hands over to saving, then fails while saving with no answer either way */
async function failWhileSaving(controller: ReturnType<typeof createHarness>['controller'], answers: object) {
  const requests = createRequests()
  requests.upload.mockImplementation(async (_signal, onStaged) => {
    await onStaged()
    throw new ImportRunError('The server went away', 'commit', 'run-1')
  })
  await controller.start(SKIPPED_AT_START, answers, requests)
  return requests
}

describe('import run', () => {
  it('offers stopping only until the upload hands over to saving, then lands with the rows left out at the start', async () => {
    const { controller, states } = createHarness()
    const staged = deferred<void>()
    const saved = deferred<JournalImportRunResponse>()

    const running = controller.start(SKIPPED_AT_START, {}, {
      upload: async (_signal, onStaged) => {
        await staged.promise
        await onStaged()
        return saved.promise
      },
      commit: vi.fn(),
    })
    expect(controller.getState()).toMatchObject({ overlayPhase: 'importing', canStop: true, stageState: { stage: 'uploading' } })

    staged.resolve()
    await vi.waitFor(() => expect(controller.getState().stageState).toEqual({ stage: 'saving', isFinished: false }))
    expect(controller.getState().canStop).toBe(false)

    saved.resolve(RESULT)
    await running
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      completedImport: { result: RESULT, skippedRowsAtCommit: SKIPPED_AT_START, savedEarlier: false },
    })
    expect(states.some((state) => state.stageState?.stage === 'uploading' && state.stageState.isFinished)).toBe(true)
  })

  it('reports a stop during the upload as stopped, with nothing kept to save again', async () => {
    const { controller } = createHarness()

    const running = controller.start(SKIPPED_AT_START, {}, {
      upload: (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new ImportRunError('Aborted', 'staging', null)))
      }),
      commit: vi.fn(),
    })
    controller.stop()
    await running

    expect(controller.getState()).toMatchObject({
      overlayPhase: 'cancelled',
      stagedRunId: null,
      failure: { message: 'Import stopped, and nothing was added to your ledger.', interrupted: false },
    })
  })

  it('keeps an upload whose save was interrupted, and Try again saves only that upload with the rows it left out', async () => {
    const { controller, settleStagedRun } = createHarness()
    const requests = await failWhileSaving(controller, {})
    expect(controller.getState()).toMatchObject({ overlayPhase: 'error', stagedRunId: 'run-1', failure: { interrupted: true } })

    await controller.retry()

    expect(requests.upload).toHaveBeenCalledTimes(1)
    expect(requests.commit).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
    expect(settleStagedRun).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      stagedRunId: null,
      completedImport: { result: RESULT, skippedRowsAtCommit: SKIPPED_AT_START, savedEarlier: false },
    })
  })

  it('keeps an interrupted upload when the overlay closes, and ignores closing while it runs', async () => {
    const { controller, discardStagedRun } = createHarness()
    const upload = deferred<JournalImportRunResponse>()

    const running = controller.start(SKIPPED_AT_START, {}, { upload: () => upload.promise, commit: vi.fn() })
    controller.close()
    expect(controller.getState().overlayPhase).toBe('importing')
    upload.reject(new ImportRunError('The server went away', 'commit', 'run-1'))
    await running

    controller.close()

    expect(discardStagedRun).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ overlayPhase: 'idle', stagedRunId: 'run-1' })
  })

  it('saves the kept upload rather than uploading again when importing with the same answers', async () => {
    const { controller, settleStagedRun } = createHarness()
    const answers = {}
    await failWhileSaving(controller, answers)
    controller.close()
    const requests = createRequests()

    await controller.start([], answers, requests)

    expect(requests.upload).not.toHaveBeenCalled()
    expect(requests.commit).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
    expect(settleStagedRun).not.toHaveBeenCalled()
    expect(controller.getState().completedImport?.skippedRowsAtCommit).toEqual(SKIPPED_AT_START)
  })

  it('uploads changed answers once dropping the kept upload shows nothing of it was saved', async () => {
    const { controller, settleStagedRun } = createHarness('discarded')
    await failWhileSaving(controller, {})
    controller.close()
    const requests = createRequests()

    await controller.start([], { changed: true }, requests)

    expect(settleStagedRun).toHaveBeenCalledWith('run-1')
    expect(requests.upload).toHaveBeenCalledTimes(1)
    expect(requests.commit).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      stagedRunId: null,
      completedImport: { savedEarlier: false, skippedRowsAtCommit: [] },
    })
  })

  it('keeps a replacement upload whose save was interrupted too, and Try again saves only that one', async () => {
    const { controller, settleStagedRun } = createHarness('discarded')
    await failWhileSaving(controller, {})
    controller.close()
    const requests = createRequests()
    requests.upload.mockImplementation(async (_signal, onStaged) => {
      await onStaged()
      throw new ImportRunError('The server went away', 'commit', 'run-2')
    })

    await controller.start([], { changed: true }, requests)
    expect(controller.getState()).toMatchObject({ overlayPhase: 'error', stagedRunId: 'run-2', failure: { interrupted: true } })

    await controller.retry()

    expect(settleStagedRun).toHaveBeenCalledTimes(1)
    expect(requests.upload).toHaveBeenCalledTimes(1)
    expect(requests.commit).toHaveBeenCalledWith('run-2', expect.any(AbortSignal))
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      completedImport: { savedEarlier: false, skippedRowsAtCommit: [] },
    })
  })

  it('sends nothing new when the kept upload had been saved, and reports that earlier import', async () => {
    const { controller, discardStagedRun } = createHarness('saved')
    await failWhileSaving(controller, {})
    controller.reset()
    expect(controller.getState()).toMatchObject({ stagedRunId: 'run-1', failure: null })
    expect(discardStagedRun).not.toHaveBeenCalled()
    const requests = createRequests()

    await controller.start([], { changed: true }, requests)

    expect(requests.upload).not.toHaveBeenCalled()
    expect(requests.commit).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      stagedRunId: null,
      completedImport: { result: RESULT, skippedRowsAtCommit: SKIPPED_AT_START, savedEarlier: true },
    })
  })

  it('stays interrupted and sends nothing when the kept upload cannot be checked, then checks again on Try again', async () => {
    const { controller, settleStagedRun } = createHarness('unsettled')
    await failWhileSaving(controller, {})
    controller.close()
    const requests = createRequests()

    await controller.start([], { changed: true }, requests)

    expect(requests.upload).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ overlayPhase: 'error', stagedRunId: 'run-1', failure: { interrupted: true } })

    settleStagedRun.mockResolvedValueOnce('discarded')
    await controller.retry()

    expect(requests.upload).toHaveBeenCalledTimes(1)
    expect(requests.commit).not.toHaveBeenCalled()
  })

  it('drops the result of an attempt a reset replaced, and stops it', async () => {
    const { controller } = createHarness()
    const upload = deferred<JournalImportRunResponse>()
    let uploadSignal: AbortSignal | undefined

    const running = controller.start(SKIPPED_AT_START, {}, {
      upload: (signal) => {
        uploadSignal = signal
        return upload.promise
      },
      commit: vi.fn(),
    })
    controller.reset()
    upload.resolve(RESULT)
    await running

    expect(uploadSignal?.aborted).toBe(true)
    expect(controller.getState()).toMatchObject({ overlayPhase: 'idle', completedImport: null, failure: null })
  })

  it('shows a failure only while the answers it was about are unchanged', async () => {
    const { controller } = createHarness()
    const answers = { accountMappings: {} }
    await failWhileSaving(controller, answers)
    const failure = controller.getState().failure

    expect(getImportRunError(failure, answers)).toBe('The server went away')
    expect(getImportRunError(failure, { accountMappings: { Checking: 'create' } })).toBeNull()
  })
})

describe('describing a failed import', () => {
  it('says an interrupted save can be finished from this screen, and what to do before leaving', () => {
    const copy = describeImportRunFailure({ message: 'Failed to fetch', interrupted: true })

    expect(copy).toEqual({
      overlayTitle: 'Save interrupted',
      overlayMessage: 'The import was interrupted. Try again to finish saving your import. Nothing will be added twice as long as you stay on the import page.',
      overlayEmphasis: 'stay on the import page',
      overlayNote: 'Leaving the import page? Check your transactions before importing again.',
      footerMessage: 'Save interrupted. Please try again.',
    })

    // The overlay bolds the phrase only where the message holds it, so a rewording must keep it
    expect(copy.overlayMessage).toContain(copy.overlayEmphasis)
  })

  it('says a refused import added nothing, beside its reason', () => {
    expect(describeImportRunFailure({ message: 'Account is archived', interrupted: false })).toEqual({
      overlayTitle: null,
      overlayMessage: 'Account is archived. Nothing was added to your ledger.',
      overlayEmphasis: null,
      overlayNote: null,
      footerMessage: 'Account is archived',
    })
  })
})

describe('starting an import', () => {
  const ready = {
    hasPayload: true,
    isProcessingFile: false,
    blockReason: null,
    overlayOpen: false,
    inFlight: false,
    hasResult: false,
  }

  it('waits for a file still being read, which the payload does not hold yet', () => {
    expect(canStartImport(ready)).toBe(true)
    expect(canStartImport({ ...ready, isProcessingFile: true })).toBe(false)
  })
})
