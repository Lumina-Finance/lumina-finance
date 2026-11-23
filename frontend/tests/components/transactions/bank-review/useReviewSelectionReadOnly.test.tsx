/**
 * Guards which new bank items a bulk edit can tick. Adding an item writes it to its account, so an item on
 * an account the server keeps read-only can't be ticked, and its box gives that account's reason. Items on
 * accounts that take writes tick as before
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createReviewItem } from '@tests/components/transactions/bank-review/fixtures'

const READ_ONLY = 'Records in USD are read-only. They can be archived or deleted'

// Everyday takes writes, and the US card is kept read-only
vi.mock('@/components/transactions/hooks/useBankItemScope', () => ({
  useBankItemScope: () => ({
    accountIds: undefined,
    isInScope: true,
    accountById: new Map([
      ['everyday', { id: 'everyday', name: 'Everyday', currency: 'CAD', read_only_reason: null }],
      ['us-card', { id: 'us-card', name: 'US card', currency: 'USD', read_only_reason: READ_ONLY }],
    ]),
  }),
}))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useReviewItems: () => ({
    isFetching: false,
    data: {
      pages: [
        {
          items: [createReviewItem('grocer', 'new', 'everyday'), createReviewItem('diner', 'new', 'us-card')],
          counts: { new: 2 },
        },
      ],
    },
  }),
}))

import { useReviewSelection } from '@/components/transactions/bank-review/useReviewSelection'

function runHook() {
  let selection: ReturnType<typeof useReviewSelection> | undefined
  function HookProbe() {
    selection = useReviewSelection(undefined, 1000)
    return null
  }
  renderToStaticMarkup(<HookProbe />)
  if (!selection) throw new Error('The hook did not run')
  return selection.rowSelection
}

describe('ticking new bank items on a read-only account', () => {
  it("can't tick an item on a read-only account, and gives that account's reason", () => {
    const rows = runHook()

    expect(rows.isSelectable('diner')).toBe(false)
    expect(rows.readOnlyReasonFor?.('diner')).toBe(READ_ONLY)
  })

  it('ticks an item on an account that takes writes, with no reason', () => {
    const rows = runHook()

    expect(rows.isSelectable('grocer')).toBe(true)
    expect(rows.readOnlyReasonFor?.('grocer')).toBeUndefined()
  })
})
