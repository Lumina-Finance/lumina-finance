/**
 * Covers how the page waits for an import to be saved: the server answers the request at once, and
 * the page asks for the outcome every 1.5 seconds for up to five minutes
 *
 * These tests catch regressions where a refusal the save recorded is not shown as the refusal it is,
 * where a dropped poll ends the wait of a save that carries on, where stopping an import leaves the
 * page asking, and where the wait never ends
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/auth/errors'

const { authenticatedRequestMock } = vi.hoisted(() => ({
  authenticatedRequestMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: vi.fn(),
  authenticatedRequest: authenticatedRequestMock,
}))

import { commitImportRun } from '@/api/import-runs/requests'

const RUN_ID = 'run_1'
const SAVE_PATH = `/transactions/import/runs/${RUN_ID}/commit`
const ROUTES = { rows: 'rows', commit: 'commit' }
const SUMMARY = { transactions_created: 2 }

const POLL_INTERVAL_MS = 1_500
const FIVE_MINUTES_MS = 5 * 60_000

const goingOn = () => Response.json({ state: 'saving' }, { status: 202 })
const saved = () => Response.json(SUMMARY)

/** Starts the save and returns what it settles with, so a rejection is never left unhandled */
function startSaving(signal?: AbortSignal) {
  return commitImportRun<typeof SUMMARY>(RUN_ID, ROUTES, signal).then(
    (summary) => ({ summary }),
    (error: unknown) => ({ error }),
  )
}

/** Lists each request the save sent as its method and path */
function getRequests() {
  return authenticatedRequestMock.mock.calls.map(([path, init]) => `${init?.method ?? 'GET'} ${path}`)
}

beforeEach(() => {
  authenticatedRequestMock.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('commitImportRun', () => {
  it('returns the summary of a save already done without asking again', async () => {
    authenticatedRequestMock.mockResolvedValueOnce(saved())

    await expect(startSaving()).resolves.toEqual({ summary: SUMMARY })

    expect(getRequests()).toEqual([`POST ${SAVE_PATH}`])
  })

  it('asks every 1.5 seconds while the save goes on, and returns the summary the poll that finds it gives', async () => {
    authenticatedRequestMock
      .mockResolvedValueOnce(goingOn())
      .mockResolvedValueOnce(goingOn())
      .mockResolvedValueOnce(goingOn())
      .mockResolvedValueOnce(saved())
    const outcome = startSaving()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1)
    expect(getRequests(), 'nothing is asked before the first interval has passed').toEqual([`POST ${SAVE_PATH}`])
    await vi.advanceTimersByTimeAsync(1)
    expect(getRequests()).toEqual([`POST ${SAVE_PATH}`, `GET ${SAVE_PATH}`])
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)

    await expect(outcome).resolves.toEqual({ summary: SUMMARY })
    expect(getRequests()).toEqual([`POST ${SAVE_PATH}`, `GET ${SAVE_PATH}`, `GET ${SAVE_PATH}`, `GET ${SAVE_PATH}`])
  })

  it('throws the refusal a poll answers with and asks no more', async () => {
    const refusal = new ApiError('Invalid amount: $2.00', 422, { detail: 'Invalid amount: $2.00' })
    authenticatedRequestMock.mockResolvedValueOnce(goingOn()).mockRejectedValueOnce(refusal)
    const outcome = startSaving()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10)

    await expect(outcome).resolves.toEqual({ error: refusal })
    expect(getRequests()).toHaveLength(2)
  })

  it('keeps asking through a dropped connection and a gateway answer, and ends on the first refusal the app gives', async () => {
    const dropped = new TypeError("Couldn't reach the server. Please try again.")
    const gateway = new ApiError('Oops, something went wrong. Please try again.', 502)
    const tookTooLong = new ApiError('Oops, the server took too long to answer. Please try again', 503, {
      detail: 'Oops, the server took too long to answer. Please try again',
    })
    authenticatedRequestMock
      .mockResolvedValueOnce(goingOn())
      .mockRejectedValueOnce(dropped)
      .mockRejectedValueOnce(gateway)
      .mockRejectedValueOnce(tookTooLong)
    const outcome = startSaving()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10)

    await expect(outcome, 'a 503 the app answered with a reason is the save refused, not a gateway').resolves.toEqual({
      error: tookTooLong,
    })
    expect(getRequests()).toHaveLength(4)
  })

  it('keeps asking when a poll goes unanswered until its own limit, and returns the summary a later one gives', async () => {
    const unanswered = new DOMException('The request timed out', 'TimeoutError')
    authenticatedRequestMock
      .mockResolvedValueOnce(goingOn())
      .mockRejectedValueOnce(unanswered)
      .mockResolvedValueOnce(saved())
    const outcome = startSaving()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10)

    await expect(outcome).resolves.toEqual({ summary: SUMMARY })
    expect(getRequests()).toEqual([`POST ${SAVE_PATH}`, `GET ${SAVE_PATH}`, `GET ${SAVE_PATH}`])
  })

  it('stops asking when the import is stopped, with the reason it was stopped for', async () => {
    const stopped = new DOMException('Stopped', 'AbortError')
    const controller = new AbortController()
    authenticatedRequestMock.mockResolvedValueOnce(goingOn())
    const outcome = startSaving(controller.signal)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1)

    controller.abort(stopped)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10)

    await expect(outcome).resolves.toEqual({ error: stopped })
    expect(getRequests()).toEqual([`POST ${SAVE_PATH}`])
  })

  it('gives up with the server taking too long once five minutes have passed, and not before', async () => {
    authenticatedRequestMock.mockImplementation(() => Promise.resolve(goingOn()))
    let isSettled = false
    const outcome = startSaving().then((result) => {
      isSettled = true
      return result
    })

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS - 1)
    expect(isSettled, 'the save is still waited for just short of five minutes').toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const result = await outcome
    expect(result).toMatchObject({ error: { name: 'TimeoutError' } })
  })
})
