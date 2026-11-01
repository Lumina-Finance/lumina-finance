/**
 * Covers the emoji picker's data load, whose failure text the category icon selector shows as it
 * stands, so a dropped connection must not reach it as the browser's "Failed to fetch", and a
 * failed load must not stick, since the next click on the icon button has to try the download again
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const FRIENDLY_SENTENCE = "Couldn't reach the server. Please try again."

// The loader keeps its promise at module level, so each test loads a fresh copy of it
async function freshLoader() {
  vi.resetModules()
  return import('@/components/category-icon-selector/emojiMartData')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadEmojiMartData', () => {
  it('fails with the friendly sentence when the connection drops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { loadEmojiMartData } = await freshLoader()

    await expect(loadEmojiMartData()).rejects.toMatchObject({ message: FRIENDLY_SENTENCE })
  })

  it('fetches again after a failure and can succeed', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ emojis: { smile: {} } }) })
    vi.stubGlobal('fetch', fetchMock)
    const { getCachedEmojiMartData, loadEmojiMartData } = await freshLoader()

    await expect(loadEmojiMartData()).rejects.toMatchObject({ message: FRIENDLY_SENTENCE })
    await expect(loadEmojiMartData()).resolves.toEqual({ emojis: { smile: {} } })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getCachedEmojiMartData()).toEqual({ emojis: { smile: {} } })
  })

  it('fetches again after a failed response status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ emojis: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    const { loadEmojiMartData } = await freshLoader()

    await expect(loadEmojiMartData()).rejects.toThrow('Failed to load emoji data.')
    await expect(loadEmojiMartData()).resolves.toEqual({ emojis: {} })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares one download between calls made while it is in flight', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emojis: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    const { loadEmojiMartData } = await freshLoader()

    await Promise.all([loadEmojiMartData(), loadEmojiMartData()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
