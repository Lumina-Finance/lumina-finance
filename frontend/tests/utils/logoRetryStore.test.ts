/**
 * Guards the logo retry rules: a logo that failed to load is drawn again when asked to, a hard failure is
 * attempted only a few times, a failure while offline does not count against a logo, and a row that mounts
 * right after a failure leaves it alone
 */
import { describe, expect, it, vi } from 'vitest'
import { createLogoRetryStore, LOGO_RETRY_DELAY_MS, MAX_LOGO_FAILURES } from '@/utils/logoRetryStore'

const LOGO = 'https://logos.example/bank.png'
const OTHER_LOGO = 'https://logos.example/other.png'

function createStore(online = true) {
  const clock = { online, time: 0 }
  const store = createLogoRetryStore(
    () => clock.online,
    () => clock.time,
  )
  return { store, clock }
}

describe('logo retry store', () => {
  it('keeps a failed logo dropped until the connection or page asks for a retry, then draws it again', () => {
    const { store } = createStore()

    store.fail(LOGO)
    expect(store.isDropped(LOGO)).toBe(true)

    store.retryAll()
    expect(store.isDropped(LOGO)).toBe(false)
  })

  it('retries every dropped logo at once, and tells its listeners only when one came back', () => {
    const { store } = createStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.retryAll()
    expect(listener).not.toHaveBeenCalled()

    store.fail(LOGO)
    store.fail(OTHER_LOGO)
    listener.mockClear()
    store.retryAll()

    expect(listener).toHaveBeenCalledOnce()
    expect(store.isDropped(LOGO)).toBe(false)
    expect(store.isDropped(OTHER_LOGO)).toBe(false)
  })

  it('leaves a logo that just failed alone when a row mounts, and draws it again once the delay has passed', () => {
    const { store, clock } = createStore()

    store.fail(LOGO)
    clock.time = LOGO_RETRY_DELAY_MS - 1
    store.retry(LOGO)
    expect(store.isDropped(LOGO)).toBe(true)

    clock.time = LOGO_RETRY_DELAY_MS
    store.retry(LOGO)
    expect(store.isDropped(LOGO)).toBe(false)
  })

  it('counts several rows failing on the same load as one failure', () => {
    const { store } = createStore()

    for (let row = 0; row < MAX_LOGO_FAILURES + 2; row += 1) store.fail(LOGO)
    store.retryAll()

    expect(store.isDropped(LOGO)).toBe(false)
  })

  it('stops retrying a logo that has failed the most times it may', () => {
    const { store, clock } = createStore()

    for (let attempt = 0; attempt < MAX_LOGO_FAILURES; attempt += 1) {
      expect(store.isDropped(LOGO)).toBe(false)
      store.fail(LOGO)
      store.retryAll()
    }
    clock.time = LOGO_RETRY_DELAY_MS * 2
    store.retry(LOGO)
    store.retryAll()

    expect(store.isDropped(LOGO)).toBe(true)
  })

  it('does not count a failure while offline, so a logo is still retried when the connection returns', () => {
    const { store, clock } = createStore(false)

    for (let attempt = 0; attempt < MAX_LOGO_FAILURES + 2; attempt += 1) {
      store.fail(LOGO)
      store.retryAll()
    }
    clock.online = true
    store.fail(LOGO)
    store.retryAll()

    expect(store.isDropped(LOGO)).toBe(false)
  })

  it('forgets earlier failures once the logo loads', () => {
    const { store } = createStore()

    for (let attempt = 0; attempt < MAX_LOGO_FAILURES - 1; attempt += 1) {
      store.fail(LOGO)
      store.retryAll()
    }
    store.succeed(LOGO)
    store.fail(LOGO)
    store.retryAll()
    store.fail(LOGO)
    store.retryAll()

    expect(store.isDropped(LOGO)).toBe(false)
  })
})
