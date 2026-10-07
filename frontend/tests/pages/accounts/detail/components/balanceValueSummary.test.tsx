/**
 * Guards the account balance summary's change line, which once showed a period with no change as
 * +CA$0.00 with an up arrow, so a flat period stays unsigned and arrowless while rises and falls keep
 * their sign on both the amount and the percentage
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `CA$${(amount / 100).toFixed(2)}` }),
}))

import { BalanceValueSummary } from '@/pages/accounts/detail/components/balance-chart/ValueSummary'
import { getBalanceChartSnapshot } from '@/pages/accounts/detail/utils/balanceChartViewModel'

/** Renders the summary for a period that starts at 100.00 and ends at the given balance */
function renderChange(endBalance: number) {
  const snapshot = getBalanceChartSnapshot({
    snapshots: [
      { account_id: 'account', dt: '2026-06-01', balance: 10_000 },
      { account_id: 'account', dt: '2026-06-03', balance: endBalance },
    ],
    range: '7D',
    chartMode: 'balance',
    currentBalance: endBalance,
    currency: 'CAD',
    fromDate: new Date(2026, 5, 1),
    toDate: new Date(2026, 5, 3),
    granularity: 'day',
  })
  const markup = renderToStaticMarkup(<BalanceValueSummary snapshot={snapshot} />)
  return { markup, text: markup.replace(/<[^>]+>/g, '') }
}

describe('balance summary change line', () => {
  it('shows no change as an unsigned zero with no arrow, in the financial font', () => {
    const { markup, text } = renderChange(10_000)

    expect(text).toContain('CA$0.00 (0.0%)')
    expect(text).not.toMatch(/[+−]/)
    expect(markup).not.toContain('lucide-trending')
    expect(markup).toContain('font-financial')
  })

  it('signs a rise with a plus on the amount and the percentage, beside an up arrow', () => {
    const { markup, text } = renderChange(12_500)

    expect(text).toContain('+CA$25.00 (+25.0%)')
    expect(markup).toContain('lucide-trending-up')
  })

  it('signs a fall with a true minus on the amount and the percentage, beside a down arrow', () => {
    const { markup, text } = renderChange(7_500)

    expect(text).toContain('−CA$25.00 (−25.0%)')
    expect(markup).toContain('lucide-trending-down')
  })
})
