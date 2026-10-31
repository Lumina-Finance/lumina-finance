/**
 * Covers the emoji picker's data load, whose failure text the category icon selector shows as it
 * stands, so a dropped connection must not reach it as the browser's "Failed to fetch"
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { loadEmojiMartData } from '@/components/category-icon-selector/emojiMartData'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadEmojiMartData', () => {
  it('fails with the friendly sentence when the connection drops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(loadEmojiMartData()).rejects.toMatchObject({ message: SERVER_UNREACHABLE_MESSAGE })
  })
})
