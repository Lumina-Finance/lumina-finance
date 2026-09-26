import { describe, expect, it, vi } from 'vitest'
import type { JournalImportRunResponse } from '@/api/provider-imports'
import { TransactionImportRunError } from '@/api/transaction-imports'
import type { FireflySkippedRowDetail } from '@/pages/imports/firefly/utils'
import {
  canStartProviderImport,
  countCreatedImportSources,
  createProviderImportRunController,
  getProviderImportError,
  type ProviderImportRunState,
} from '@/pages/imports/utils'

const RESULT = { rows_imported: 3 } as JournalImportRunResponse
const SKIPPED_AT_START: FireflySkippedRowDetail[] = [{ journalId: '7', rowNumber: 8, cells: {}, reason: 'Left out' }]

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
function createHarness() {
  const states: ProviderImportRunState<FireflySkippedRowDetail>[] = []
  const discardStagedRun = vi.fn()
  const controller = createProviderImportRunController<FireflySkippedRowDetail>({
    onChange: (state) => states.push(state),
    discardStagedRun,
    wait: () => Promise.resolve(),
  })
  return { controller, states, discardStagedRun }
}

/** An upload that stages, hands over to saving, then fails while saving in a way worth repeating */
async function failWhileSaving(controller: ReturnType<typeof createHarness>['controller'], answers: object) {
  await controller.start(SKIPPED_AT_START, answers, async (_signal, onStaged) => {
    await onStaged()
    throw new TransactionImportRunError('The server went away', 'commit', 'run-1')
  })
}

describe('provider import run', () => {
  it('offers stopping only until the upload hands over to saving, then lands with the rows left out at the start', async () => {
    const { controller, states } = createHarness()
    const staged = deferred<void>()
    const saved = deferred<JournalImportRunResponse>()

    const running = controller.start(SKIPPED_AT_START, {}, async (_signal, onStaged) => {
      await staged.promise
      await onStaged()
      return saved.promise
    })
    expect(controller.getState()).toMatchObject({ overlayPhase: 'importing', canStop: true, stageState: { stage: 'uploading' } })

    staged.resolve()
    await vi.waitFor(() => expect(controller.getState().stageState).toEqual({ stage: 'saving', isFinished: false }))
    expect(controller.getState().canStop).toBe(false)

    saved.resolve(RESULT)
    await running
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      completedImport: { result: RESULT, skippedRowsAtCommit: SKIPPED_AT_START },
    })
    expect(states.some((state) => state.stageState?.stage === 'uploading' && state.stageState.isFinished)).toBe(true)
  })

  it('reports a stop during the upload as stopped, with nothing kept to save again', async () => {
    const { controller } = createHarness()

    const running = controller.start(SKIPPED_AT_START, {}, (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new TransactionImportRunError('Aborted', 'staging', null)))
    }))
    controller.stop()
    await running

    expect(controller.getState()).toMatchObject({
      overlayPhase: 'cancelled',
      stagedRunId: null,
      failure: { message: 'Import stopped, and nothing was added to your ledger.' },
    })
  })

  it('keeps an upload whose save failed, and saves only that upload again with the rows it left out', async () => {
    const { controller } = createHarness()
    await failWhileSaving(controller, {})
    expect(controller.getState()).toMatchObject({ overlayPhase: 'error', stagedRunId: 'run-1', failure: { message: 'The server went away' } })

    const commit = vi.fn().mockResolvedValue(RESULT)
    await controller.retry({}, commit)

    expect(commit).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      stagedRunId: null,
      completedImport: { result: RESULT, skippedRowsAtCommit: SKIPPED_AT_START },
    })
  })

  it('drops the kept upload when a failed import is closed, and ignores closing while it runs', async () => {
    const { controller, discardStagedRun } = createHarness()
    const upload = deferred<JournalImportRunResponse>()

    const running = controller.start(SKIPPED_AT_START, {}, () => upload.promise)
    controller.close()
    expect(controller.getState().overlayPhase).toBe('importing')
    upload.reject(new TransactionImportRunError('The server went away', 'commit', 'run-1'))
    await running

    controller.close()

    expect(discardStagedRun).toHaveBeenCalledWith('run-1')
    expect(controller.getState()).toMatchObject({ overlayPhase: 'idle', stagedRunId: null })
  })

  it('drops the result of an attempt a reset replaced, and stops it', async () => {
    const { controller } = createHarness()
    const upload = deferred<JournalImportRunResponse>()
    let uploadSignal: AbortSignal | undefined

    const running = controller.start(SKIPPED_AT_START, {}, (signal) => {
      uploadSignal = signal
      return upload.promise
    })
    controller.reset()
    upload.resolve(RESULT)
    await running

    expect(uploadSignal?.aborted).toBe(true)
    expect(controller.getState()).toMatchObject({ overlayPhase: 'idle', completedImport: null, failure: null })
  })

  it('drops a kept upload on reset', async () => {
    const { controller, discardStagedRun } = createHarness()
    await failWhileSaving(controller, {})

    controller.reset()

    expect(discardStagedRun).toHaveBeenCalledWith('run-1')
    expect(controller.getState().stagedRunId).toBeNull()
  })

  it('shows a failure only while the answers it was about are unchanged', async () => {
    const { controller } = createHarness()
    const answers = { accountMappings: {} }
    await failWhileSaving(controller, answers)
    const failure = controller.getState().failure

    expect(getProviderImportError(failure, answers)).toBe('The server went away')
    expect(getProviderImportError(failure, { accountMappings: { Checking: 'create' } })).toBeNull()
  })
})

describe('starting a provider import', () => {
  const ready = {
    hasPayload: true,
    isProcessingFile: false,
    budgetSelectionError: null,
    overlayOpen: false,
    inFlight: false,
    hasResult: false,
  }

  it('waits for a file still being read, which the payload does not hold yet', () => {
    expect(canStartProviderImport(ready)).toBe(true)
    expect(canStartProviderImport({ ...ready, isProcessingFile: true })).toBe(false)
  })
})

describe('counting the sources an import creates', () => {
  it('leaves out a source answered create whose rows are all left out of the upload', () => {
    const mappings = { Checking: 'create', Savings: 'create', Wallet: 'account-1' }

    expect(countCreatedImportSources(['Checking', 'Savings', 'Wallet'], mappings, 'create', new Set(['Checking', 'Wallet']))).toBe(1)
  })
})
