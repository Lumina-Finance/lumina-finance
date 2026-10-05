/**
 * Tests the relative time phrases, so a rewrite catches a unit picked too large or too small, or a
 * phrase read in the browser's language rather than the product's
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from '@/utils/relativeTime'

const NOW = new Date('2026-10-05T12:00:00Z')

function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString()
}

// A browser set to French, whose formatters fall back to French when they name no locale
class FrenchByDefault extends Intl.RelativeTimeFormat {
  constructor(locales?: Intl.LocalesArgument, options?: Intl.RelativeTimeFormatOptions) {
    super(locales ?? 'fr', options)
  }
}

/** Loads the helper afresh in a browser set to French, since its formatter is built as the module loads */
async function loadInFrenchBrowser() {
  vi.stubGlobal('Intl', Object.create(Intl, { RelativeTimeFormat: { value: FrenchByDefault } }))
  vi.resetModules()
  return import('@/utils/relativeTime')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('relative time', () => {
  it('names the largest unit that fits', () => {
    expect(formatRelativeTime(secondsAgo(5 * 60))).toBe('5 minutes ago')
    expect(formatRelativeTime(secondsAgo(3 * 60 * 60))).toBe('3 hours ago')
    expect(formatRelativeTime(secondsAgo(24 * 60 * 60))).toBe('yesterday')
  })

  it('says just now for anything under 45 seconds ago', () => {
    expect(formatRelativeTime(secondsAgo(30))).toBe('just now')
  })

  it('reads in Canadian English in a browser set to French', async () => {
    const { formatRelativeTime: formatInFrenchBrowser } = await loadInFrenchBrowser()

    expect(formatInFrenchBrowser(secondsAgo(3 * 60 * 60))).toBe('3 hours ago')
    expect(formatInFrenchBrowser(secondsAgo(24 * 60 * 60))).toBe('yesterday')
  })
})
