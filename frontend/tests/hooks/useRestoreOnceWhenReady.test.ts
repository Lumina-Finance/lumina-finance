import { describe, expect, it, vi } from 'vitest'
import { createRestoreOnceController } from '@/hooks/useRestoreOnceWhenReady'

describe('one-time restoration controller', () => {
  it('waits for a value and consumes it once across unrelated updates', () => {
    const controller = createRestoreOnceController(true)
    const restore = vi.fn()
    const laterRestore = vi.fn()

    controller.consume(null, restore)
    controller.consume(null, vi.fn())
    controller.consume('500000', restore)
    controller.consume('600000', laterRestore)

    expect(restore).toHaveBeenCalledOnce()
    expect(restore).toHaveBeenCalledWith('500000')
    expect(laterRestore).not.toHaveBeenCalled()
  })

  it('resets only from the supplied condition', () => {
    const controller = createRestoreOnceController(false)
    const restore = vi.fn()

    controller.consume('ignored', restore)
    controller.reset(false)
    controller.consume('also ignored', restore)
    controller.reset(true)
    controller.consume('restored', restore)

    expect(restore).toHaveBeenCalledOnce()
    expect(restore).toHaveBeenCalledWith('restored')
  })

  it('rearms only on a false-to-true open transition', () => {
    const controller = createRestoreOnceController(false, false)
    const restore = vi.fn()

    controller.recordOpen(false, true)
    controller.consume('closed', restore)
    controller.recordOpen(true, true)
    controller.consume('first opening', restore)
    controller.recordOpen(true, true)
    controller.consume('rerender', restore)
    controller.recordOpen(false, true)
    controller.recordOpen(true, false)
    controller.consume('known on reopen', restore)
    controller.recordOpen(false, false)
    controller.recordOpen(true, true)
    controller.consume('later opening', restore)

    expect(restore.mock.calls).toEqual([
      ['first opening'],
      ['later opening'],
    ])
  })

  it('can consume an already-pending restoration while closed', () => {
    const controller = createRestoreOnceController(true, true)
    const restore = vi.fn()

    controller.recordOpen(false, true)
    controller.consume('restored while closed', restore)

    expect(restore).toHaveBeenCalledOnce()
    expect(restore).toHaveBeenCalledWith('restored while closed')
  })

  it.each([
    ['empty account or budget field', ''],
    ['numeric zero', 0],
    ['zero lower bound', { min: '0', max: '' }],
    ['empty range object', { min: '', max: '' }],
  ])('treats %s as ready', (_case, readyValue) => {
    const controller = createRestoreOnceController(true)
    const restore = vi.fn()

    controller.consume(readyValue, restore)

    expect(restore).toHaveBeenCalledOnce()
    expect(restore).toHaveBeenCalledWith(readyValue)
  })

  it('keeps a pending account or budget restoration until an empty value is ready', () => {
    const controller = createRestoreOnceController(true)
    const restore = vi.fn()

    controller.consume(null, restore)
    controller.consume('', restore)

    expect(restore).toHaveBeenCalledOnce()
    expect(restore).toHaveBeenCalledWith('')
  })

  it('clears pending before the restore callback can trigger another consumption', () => {
    const controller = createRestoreOnceController(true)
    const values: string[] = []

    controller.consume('first', (value) => {
      values.push(value)
      controller.consume('second', (nestedValue) => values.push(nestedValue))
    })

    expect(values).toEqual(['first'])
  })

  it('keeps independent field restorations separate', () => {
    const accountController = createRestoreOnceController(true)
    const budgetController = createRestoreOnceController(true)
    const restored: string[] = []

    accountController.consume('500000', (value) => restored.push(`account:${value}`))
    accountController.consume('600000', (value) => restored.push(`account:${value}`))
    budgetController.consume('', (value) => restored.push(`budget:${value}`))

    expect(restored).toEqual(['account:500000', 'budget:'])
  })
})
