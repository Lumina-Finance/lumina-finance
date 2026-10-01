import { describe, expect, it, vi } from 'vitest'
import type { JournalImportRunResponse } from '@/api/provider-imports'
import { TransactionImportRunError, type StagedRunSettlement } from '@/api/transaction-imports'
import type { FireflySkippedRowDetail } from '@/pages/imports/firefly/utils'
import {
  canStartProviderImport,
  countCreatedImportSources,
  createProviderImportRunController,
  describeProviderImportFailure,
  formatProviderImportSummary,
  getProviderImportError,
  type ProviderImportRunState,
} from '@/pages/imports/utils'

const RESULT = { rows_imported: 3 } as JournalImportRunResponse
const SKIPPED_AT_START: FireflySkippedRowDetail[] = [{ journalId: '7', rowNumber: 8, cells: {}, reason: 'Left out' }]

/** Creates a complete import result with empty counters and mappings unless overridden */
function createImportResult(overrides: Partial<JournalImportRunResponse> = {}): JournalImportRunResponse {
  return {
    transactions_created: 0,
    accounts_created: 0,
    accounts_reused: 0,
    categories_created: 0,
    categories_reused: 0,
    merchants_created: 0,
    merchants_reused: 0,
    tags_created: 0,
    tags_reused: 0,
    affected_account_ids: [],
    account_source_ids: {},
    category_source_ids: {},
    created_account_ids: [],
    created_category_ids: [],
    created_merchant_ids: [],
    created_tag_ids: [],
    rows_imported: 0,
    budgets_created: 0,
    budgets: [],
    accounts_archived: 0,
    archive_adjustments_created: 0,
    ...overrides,
  }
}

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
  const states: ProviderImportRunState<FireflySkippedRowDetail>[] = []
  const discardStagedRun = vi.fn()
  const settleStagedRun = vi.fn().mockResolvedValue(settlement)
  const controller = createProviderImportRunController<FireflySkippedRowDetail>({
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
    throw new TransactionImportRunError('The server went away', 'commit', 'run-1')
  })
  await controller.start(SKIPPED_AT_START, answers, requests)
  return requests
}

describe('provider import run', () => {
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
        signal.addEventListener('abort', () => reject(new TransactionImportRunError('Aborted', 'staging', null)))
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
    upload.reject(new TransactionImportRunError('The server went away', 'commit', 'run-1'))
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
    expect(controller.getState()).toMatchObject({ overlayPhase: 'success', stagedRunId: null, completedImport: { savedEarlier: false } })
  })

  it('sends nothing new when the kept upload had been saved, and reports that earlier import', async () => {
    const { controller } = createHarness('saved')
    await failWhileSaving(controller, {})
    controller.reset()
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

  it('keeps an interrupted upload through a reset, for the next import to settle', async () => {
    const { controller, discardStagedRun } = createHarness()
    await failWhileSaving(controller, {})

    controller.reset()

    expect(discardStagedRun).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ stagedRunId: 'run-1', failure: null })
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

describe('describing a failed provider import', () => {
  it('says an interrupted save can be finished from this screen, and what to do before leaving', () => {
    expect(describeProviderImportFailure({ message: 'Failed to fetch', interrupted: true })).toEqual({
      overlayTitle: 'Save interrupted',
      overlayMessage: 'The import was interrupted. Try again to finish saving your import. Nothing will be added twice as long as you stay on the import page.',
      overlayNote: 'Leaving the import page? Check your transactions before importing again.',
      footerMessage: 'Save interrupted. Please try again.',
    })
  })

  it('says a refused import added nothing, beside its reason', () => {
    expect(describeProviderImportFailure({ message: 'Account is archived', interrupted: false })).toEqual({
      overlayTitle: null,
      overlayMessage: 'Account is archived. Nothing was added to your ledger.',
      overlayNote: null,
      footerMessage: 'Account is archived',
    })
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

describe('the completed provider import summary', () => {
  it('counts the rows the browser left out as skipped', () => {
    const result = createImportResult({ rows_imported: 1, transactions_created: 1 })

    expect(formatProviderImportSummary(result, 2).replaceAll('\u00a0', ' ')).toBe('1 row imported · 1 transaction created · 2 skipped')
  })

  it('preserves plural row, transaction and budget segments in their current order', () => {
    const result = createImportResult({ rows_imported: 2, transactions_created: 2, budgets_created: 2 })

    expect(formatProviderImportSummary(result, 1).replaceAll('\u00a0', ' ')).toBe('2 rows imported · 2 transactions created · 1 skipped · 2 budgets imported')
  })

  // A narrow overlay wraps the summary, and a break inside a count strands its number from its word
  it('lets a line break only after a separator', () => {
    const result = createImportResult({ rows_imported: 10, transactions_created: 11 })

    expect(formatProviderImportSummary(result, 0).split(' ')).toEqual([
      '10\u00a0rows\u00a0imported\u00a0·',
      '11\u00a0transactions\u00a0created\u00a0·',
      '0\u00a0skipped',
    ])
  })
})
