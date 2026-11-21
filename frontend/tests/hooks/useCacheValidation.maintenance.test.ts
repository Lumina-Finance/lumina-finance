/**
 * Guards what the check does around a maintenance: it asks again by itself while one lasts, fetches
 * the app data once more when it ends, and leaves the data under an open dialogue as it was until
 * the dialogue closes
 */
import { describe, expect, it, vi } from 'vitest'
import { createHoldGate, createMaintenanceReaction } from '@/hooks/useCacheValidation'

function setUp() {
  const gate = createHoldGate()
  const retry = vi.fn()
  const refetch = vi.fn()
  const reaction = createMaintenanceReaction(gate, { refetch, retry })
  return { gate, reaction, refetch, retry }
}

describe('the check around a maintenance', () => {
  it('asks again as a maintenance starts, without fetching the app data', () => {
    const { reaction, refetch, retry } = setUp()

    reaction.onChange(true)

    expect(retry).toHaveBeenCalledOnce()
    expect(refetch).not.toHaveBeenCalled()
  })

  it('fetches the app data again as it ends', () => {
    const { reaction, refetch, retry } = setUp()

    reaction.onChange(true)
    reaction.onChange(false)

    expect(refetch).toHaveBeenCalledOnce()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('leaves the data under an open dialogue as it was until the dialogue closes', () => {
    const { gate, reaction, refetch } = setUp()
    const release = gate.hold()

    reaction.onChange(true)
    reaction.onChange(false)
    expect(refetch).not.toHaveBeenCalled()

    release()
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('fetches nothing for a maintenance that ended while the page was no longer listening', () => {
    const { gate, reaction, refetch } = setUp()
    const release = gate.hold()

    reaction.onChange(false)
    reaction.dispose()
    release()

    expect(refetch).not.toHaveBeenCalled()
  })
})
