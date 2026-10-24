/**
 * Guards how the spending comparison shows its change. A change of zero used to read as a fall, in
 * the positive colour with a down arrow, though spending neither rose nor fell
 */
import { describe, expect, it } from 'vitest'
import { getSpendingDeltaDisplay } from '@/pages/dashboard/utils/getSpendingDeltaDisplay'

describe('spending comparison change', () => {
  it.each([
    [-12.5, 'var(--app-positive)', 'down'],
    [3.1, 'var(--app-negative)', 'up'],
    [0, 'var(--app-text)', null],
    [-0, 'var(--app-text)', null],
  ])('shows a change of %s in %s with the %s arrow', (deltaPct, color, arrow) => {
    expect(getSpendingDeltaDisplay(deltaPct)).toEqual({ color, arrow })
  })
})
