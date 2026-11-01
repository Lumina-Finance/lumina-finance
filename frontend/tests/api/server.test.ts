/**
 * Covers the shared request limit, which stops a request the server never answers from leaving a
 * screen loading forever, while a caller's own abort, such as stopping an import, still works
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFromServer, SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { answerNever } from './fixtures'

// Short enough to keep the suite fast, long enough that a caller's abort lands first
const TEST_TIMEOUT_MS = 50

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(answerNever)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchFromServer', () => {
  it('fails a request the server never answers once the limit passes', async () => {
    await expect(fetchFromServer('/transactions', { timeoutMs: TEST_TIMEOUT_MS })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it("still aborts with the caller's own reason before the limit", async () => {
    const controller = new AbortController()
    const request = fetchFromServer('/transactions/import/runs', {
      signal: controller.signal,
      timeoutMs: TEST_TIMEOUT_MS,
    })
    const stopped = new DOMException('Stopped', 'AbortError')

    controller.abort(stopped)

    await expect(request).rejects.toBe(stopped)
  })

  // An import stopped between batches sends its next batch with a signal that has already aborted,
  // which must not go out and upload the rest of the file
  it("sends nothing on when the caller's signal had already aborted", async () => {
    const controller = new AbortController()
    const stopped = new DOMException('Stopped', 'AbortError')
    controller.abort(stopped)

    await expect(fetchFromServer('/transactions/import/runs', { signal: controller.signal })).rejects.toBe(stopped)
  })

  // Screens show an error's message as it stands, so a request that never got an answer must already
  // carry the friendly sentence, wherever the screen shows it from
  it('fails a dropped connection with the friendly sentence, still as a TypeError', async () => {
    const dropped = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValueOnce(dropped)

    const failure: unknown = await fetchFromServer('/accounts/account_1').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({ message: SERVER_UNREACHABLE_MESSAGE, cause: dropped })
  })

  it("leaves a caller's abort and an answered request alone", async () => {
    const stopped = new DOMException('Stopped', 'AbortError')
    fetchMock.mockRejectedValueOnce(stopped)
    await expect(fetchFromServer('/accounts')).rejects.toBe(stopped)

    const answer = new Response('{"detail":"That name is already used"}', { status: 409 })
    fetchMock.mockResolvedValueOnce(answer)
    await expect(fetchFromServer('/budgets')).resolves.toBe(answer)
  })
})
