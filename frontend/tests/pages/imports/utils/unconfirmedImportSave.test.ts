/**
 * Covers the saves the browser keeps past the import page, which are what stop a save that went
 * unanswered from being imported a second time after the page is left
 */
import { describe, expect, it } from 'vitest'
import { createUnconfirmedImportSaveStore, getUnconfirmedImportSavePrefix } from '@/pages/imports/utils'
import { createMemoryStorage } from './fixtures'

describe('unconfirmed import saves', () => {
  it('keeps each run apart, so another tab or account neither replaces nor clears it', () => {
    const storage = createMemoryStorage()
    let now = 1000
    const prefix = getUnconfirmedImportSavePrefix('user-1', 'firefly')
    const firstTab = createUnconfirmedImportSaveStore(storage, prefix, () => now)
    const secondTab = createUnconfirmedImportSaveStore(storage, prefix, () => now)
    const otherAccount = createUnconfirmedImportSaveStore(storage, getUnconfirmedImportSavePrefix('user-2', 'firefly'), () => now)

    firstTab.record({ runId: 'run-1', skippedCount: 2 })
    now = 2000
    secondTab.record({ runId: 'run-2', skippedCount: 0 })
    secondTab.clear('run-2')

    expect(firstTab.readOldest()).toEqual({ runId: 'run-1', skippedCount: 2, recordedAt: 1000 })
    expect(otherAccount.readOldest()).toBeNull()
  })

  it('reports a save the browser refused to keep, and reads refused storage as holding nothing', () => {
    const refused = createMemoryStorage()
    refused.setItem = () => {
      throw new DOMException('Blocked', 'SecurityError')
    }
    Object.defineProperty(refused, 'length', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
    })
    const saves = createUnconfirmedImportSaveStore(refused, getUnconfirmedImportSavePrefix('user-1', 'firefly'), () => 0)

    expect(saves.record({ runId: 'run-1', skippedCount: 0 })).toBe(false)
    expect(saves.readOldest()).toBeNull()
    expect(createUnconfirmedImportSaveStore(null, '', () => 0).record({ runId: 'run-1', skippedCount: 0 })).toBe(false)
  })
})
