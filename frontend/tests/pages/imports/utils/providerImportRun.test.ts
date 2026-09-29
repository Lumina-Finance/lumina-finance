import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/auth/errors'
import type { JournalImportRunResponse } from '@/api/provider-imports'
import { TransactionImportRunError } from '@/api/transaction-imports'
import type { FireflySkippedRowDetail } from '@/pages/imports/firefly/utils'
import {
  canStartProviderImport,
  countCreatedImportSources,
  createProviderImportRunController,
  createUnconfirmedImportSaveStore,
  describeProviderImportFailure,
  formatProviderImportSummary,
  getProviderImportError,
  type ProviderImportRunState,
} from '@/pages/imports/utils'
import { createMemoryStorage } from './fixtures'

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

const SAVES_PREFIX = 'saves:'

/**
 * A controller whose minimum waits end at once, recording every state it reports, with its saves
 * kept in the storage given so a second harness can stand for the page opened again
 */
function createHarness(storage = createMemoryStorage()) {
  const states: ProviderImportRunState<FireflySkippedRowDetail>[] = []
  const discardStagedRun = vi.fn()
  const saves = createUnconfirmedImportSaveStore(storage, SAVES_PREFIX, () => 0)
  const controller = createProviderImportRunController<FireflySkippedRowDetail>({
    onChange: (state) => states.push(state),
    discardStagedRun,
    wait: () => Promise.resolve(),
    unconfirmedSaves: saves,
  })
  return { controller, states, discardStagedRun, saves, storage }
}

/** The error a save throws once the server has answered it with a status */
function refusedSave(status: number, detail = 'Refused') {
  return new TransactionImportRunError(detail, 'commit', 'run-1', { cause: new ApiError(detail, status) })
}

/** An upload that stages, hands over to saving, then fails while saving without an answer */
async function failWhileSaving(controller: ReturnType<typeof createHarness>['controller'], answers: object) {
  await controller.start(SKIPPED_AT_START, answers, async (_signal, onStaged) => {
    await onStaged('run-1')
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
      await onStaged('run-1')
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
    expect(controller.getState()).toMatchObject({ overlayPhase: 'unconfirmed', stagedRunId: 'run-1', failure: { message: 'The server went away' } })

    const commit = vi.fn().mockResolvedValue(RESULT)
    await controller.retry({}, commit)

    expect(commit).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      stagedRunId: null,
      completedImport: { result: RESULT, skippedRowsAtCommit: SKIPPED_AT_START },
    })
  })

  it('keeps a save whose outcome is unknown when the overlay is asked to close, so it cannot be imported again', async () => {
    const { controller, discardStagedRun } = createHarness()
    await failWhileSaving(controller, {})

    controller.close()

    expect(discardStagedRun).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ overlayPhase: 'unconfirmed', stagedRunId: 'run-1' })
  })

  it('holds a save through a retry the first save still blocks, and lets it go once the server says it wrote nothing', async () => {
    const { controller, discardStagedRun } = createHarness()
    await failWhileSaving(controller, {})

    await controller.retry({}, () => Promise.reject(refusedSave(409, 'This import is already being worked on')))
    expect(controller.getState()).toMatchObject({ overlayPhase: 'unconfirmed', stagedRunId: 'run-1' })

    await controller.retry({}, () => Promise.reject(refusedSave(404, 'Import run not found')))
    expect(discardStagedRun).toHaveBeenCalledWith('run-1')
    expect(controller.getState()).toMatchObject({ overlayPhase: 'error', stagedRunId: null })

    controller.close()
    expect(controller.getState().overlayPhase).toBe('idle')
  })

  it('remembers a sent save past the page until the server answers for it', async () => {
    const { controller, saves } = createHarness()

    await failWhileSaving(controller, {})
    expect(saves.readOldest()).toMatchObject({ runId: 'run-1', skippedCount: SKIPPED_AT_START.length })

    await controller.retry({}, () => Promise.reject(refusedSave(422)))
    expect(saves.readOldest()).toBeNull()

    await controller.start(SKIPPED_AT_START, {}, async (_signal, onStaged) => {
      await onStaged('run-2')
      return RESULT
    })
    expect(saves.readOldest()).toBeNull()
  })

  it('picks up a save remembered from an earlier visit, holding the overlay until the server answers for it', async () => {
    const storage = createMemoryStorage()
    await failWhileSaving(createHarness(storage).controller, {})
    const { controller, saves } = createHarness(storage)

    await controller.resume({}, () => Promise.reject(refusedSave(409, 'This import has not been saved yet')))
    expect(controller.getState()).toMatchObject({ overlayPhase: 'unconfirmed', stagedRunId: 'run-1' })
    expect(saves.readOldest()).toMatchObject({ runId: 'run-1' })

    const commit = vi.fn().mockResolvedValue(RESULT)
    await controller.retry({}, commit)
    expect(commit).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
    expect(controller.getState()).toMatchObject({
      overlayPhase: 'success',
      completedImport: { result: RESULT, skippedRowsAtCommit: [], skippedCount: SKIPPED_AT_START.length },
    })
    expect(saves.readOldest()).toBeNull()
  })

  it('shows what a remembered save wrote, or that it wrote nothing, as soon as the server says', async () => {
    const landed = createMemoryStorage()
    await failWhileSaving(createHarness(landed).controller, {})
    const afterLanding = createHarness(landed)
    await afterLanding.controller.resume({}, () => Promise.resolve(RESULT))

    const expired = createMemoryStorage()
    await failWhileSaving(createHarness(expired).controller, {})
    const afterExpiry = createHarness(expired)
    await afterExpiry.controller.resume({}, () => Promise.reject(refusedSave(422, 'This import expired before it was saved')))

    expect(afterLanding.controller.getState()).toMatchObject({ overlayPhase: 'success', completedImport: { result: RESULT } })
    expect(afterExpiry.controller.getState()).toMatchObject({
      overlayPhase: 'error',
      failure: { message: 'This import expired before it was saved' },
    })
    expect([afterLanding.saves.readOldest(), afterExpiry.saves.readOldest()]).toEqual([null, null])
  })

  it('answers for every save left unanswered, including one another tab sent later, before uploading anything new', async () => {
    const storage = createMemoryStorage()
    await failWhileSaving(createHarness(storage).controller, {})
    const { controller } = createHarness(storage)
    const check = vi.fn()
      .mockRejectedValueOnce(refusedSave(404, 'Import run not found'))
      .mockRejectedValue(refusedSave(409, 'This import has not been saved yet'))
    await controller.resume({}, check)
    controller.close()
    expect(controller.getState().overlayPhase).toBe('idle')

    await createHarness(storage).controller.start([], {}, async (_signal, onStaged) => {
      await onStaged('run-2')
      throw new TransactionImportRunError('The server went away', 'commit', 'run-2')
    })
    const upload = vi.fn()
    await controller.start(SKIPPED_AT_START, {}, upload)

    expect(upload).not.toHaveBeenCalled()
    expect(check).toHaveBeenLastCalledWith('run-2')
    expect(controller.getState()).toMatchObject({ overlayPhase: 'unconfirmed', stagedRunId: 'run-2' })
  })

  it('offers no way to leave a save the browser refused to keep, since leaving would lose it', async () => {
    const full = createMemoryStorage()
    full.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError')
    }
    const kept = createHarness()
    const unkept = createHarness(full)

    await failWhileSaving(kept.controller, {})
    await failWhileSaving(unkept.controller, {})

    expect(kept.controller.getState()).toMatchObject({ overlayPhase: 'unconfirmed', isSaveRemembered: true })
    expect(unkept.controller.getState()).toMatchObject({ overlayPhase: 'unconfirmed', stagedRunId: 'run-1', isSaveRemembered: false })
  })

  it('lets a retry pressed while a remembered save is being asked about settle it', async () => {
    const storage = createMemoryStorage()
    await failWhileSaving(createHarness(storage).controller, {})
    const { controller } = createHarness(storage)
    const check = deferred<JournalImportRunResponse>()

    const resuming = controller.resume({}, () => check.promise)
    await controller.retry({}, () => Promise.reject(refusedSave(422)))
    check.resolve(RESULT)
    await resuming

    expect(controller.getState()).toMatchObject({ overlayPhase: 'error', completedImport: null })
  })

  it('drops the upload of a save the server refused, closes it, and ignores closing while it runs', async () => {
    const { controller, discardStagedRun } = createHarness()
    const upload = deferred<JournalImportRunResponse>()

    const running = controller.start(SKIPPED_AT_START, {}, () => upload.promise)
    controller.close()
    expect(controller.getState().overlayPhase).toBe('importing')
    upload.reject(refusedSave(422))
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

describe('the completed provider import summary', () => {
  it('counts the rows the browser left out as skipped', () => {
    const result = createImportResult({ rows_imported: 1, transactions_created: 1 })

    expect(formatProviderImportSummary(result, 2)).toBe('1 row imported · 1 transaction created · 2 skipped')
  })

  it('preserves plural row, transaction and budget segments in their current order', () => {
    const result = createImportResult({ rows_imported: 2, transactions_created: 2, budgets_created: 2 })

    expect(formatProviderImportSummary(result, 1)).toBe('2 rows imported · 2 transactions created · 1 skipped · 2 budgets imported')
  })
})

describe('what the overlay says about an import that did not land', () => {
  it('says a save nobody answered for may already have gone through, whatever went wrong', () => {
    expect(describeProviderImportFailure('unconfirmed', 'Failed to fetch')).toBe(
      "We couldn't confirm whether your import was saved, so it may already have gone through. Try again to check. If it was saved, you'll see what it added, and trying again never adds your transactions twice.",
    )
  })

  it('says a refused import added nothing, after its reason', () => {
    expect(describeProviderImportFailure('error', 'This import expired before it was saved')).toBe(
      'This import expired before it was saved. Nothing was added to your ledger.',
    )
  })
})
