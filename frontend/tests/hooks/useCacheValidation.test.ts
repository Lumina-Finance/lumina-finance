import { describe, expect, it, vi } from 'vitest'
import { createHeldRunner, createHoldGate } from '@/hooks/useCacheValidation'

/**
 * Guards the hold that keeps the cache check, and so the transaction list, from refreshing while a
 * modal is open: the deferred check runs once when the last hold ends, and a modal that unmounts
 * while open (a sign-out, say) releases its hold instead of blocking refreshes for good. The
 * releases here are what the hook's effect cleanup returns on close and on unmount
 */
function setUp() {
  const gate = createHoldGate()
  const task = vi.fn()
  const runner = createHeldRunner(gate, task)
  return { gate, task, runner }
}

describe('cache validation hold', () => {
  it('holds while a modal is open and runs the skipped check once on release', () => {
    const { gate, task, runner } = setUp()

    const release = gate.hold()
    expect(gate.isHeld()).toBe(true)
    expect(runner.attempt()).toBe(false)
    expect(task).not.toHaveBeenCalled()

    release()
    expect(task).toHaveBeenCalledOnce()
    expect(gate.isHeld()).toBe(false)
    expect(runner.attempt()).toBe(true)
  })

  it('stays held until the second of two modals closes', () => {
    const { gate, task, runner } = setUp()
    const releaseFirst = gate.hold()
    const releaseSecond = gate.hold()
    runner.attempt()

    releaseFirst()
    expect(gate.isHeld()).toBe(true)
    expect(runner.attempt()).toBe(false)
    expect(task).not.toHaveBeenCalled()

    releaseSecond()
    expect(gate.isHeld()).toBe(false)
    expect(task).toHaveBeenCalledOnce()
  })

  it('does not run a check that was never skipped', () => {
    const { gate, task } = setUp()

    const release = gate.hold()
    release()

    expect(task).not.toHaveBeenCalled()
  })

  it('frees later refreshes when a modal unmounts while open, even if cleanup runs twice', () => {
    const { gate, task, runner } = setUp()
    const releaseOnUnmount = gate.hold()
    runner.attempt()

    releaseOnUnmount()
    releaseOnUnmount()

    expect(gate.isHeld()).toBe(false)
    expect(runner.attempt()).toBe(true)
    expect(task).toHaveBeenCalledOnce()

    // A repeated release must not leave a negative count that a later hold cancels out
    const releaseNext = gate.hold()
    expect(gate.isHeld()).toBe(true)
    releaseNext()
    expect(gate.isHeld()).toBe(false)
  })

  it('stops hearing releases after dispose', () => {
    const { gate, task, runner } = setUp()
    const release = gate.hold()
    runner.attempt()

    runner.dispose()
    release()

    expect(task).not.toHaveBeenCalled()
  })
})
