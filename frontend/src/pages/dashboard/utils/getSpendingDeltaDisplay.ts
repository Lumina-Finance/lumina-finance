import { getAmountSign, getAmountSignColor } from '@/utils/negativeAmount'

export type SpendingDeltaDisplay = {
  color: string
  arrow: 'up' | 'down' | null
}

/**
 * Returns how the spending comparison shows its change against the previous period, which is already
 * rounded to the tenth it is written in. Spending less is the good direction, so a fall takes the
 * positive colour. A change of zero has no direction, so it takes the neutral colour and no arrow
 */
export function getSpendingDeltaDisplay(deltaPct: number): SpendingDeltaDisplay {
  const sign = getAmountSign(deltaPct)
  return {
    color: getAmountSignColor(getAmountSign(-deltaPct)),
    arrow: sign === 0 ? null : sign > 0 ? 'up' : 'down',
  }
}
