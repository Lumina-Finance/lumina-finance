/**
 * Guards the spending comparison header's badge for the average line. It shows for a rate that is missing
 * and for amounts left out because converting them is refused, and not for an average with no gap
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FxStatus } from '@/api/shared/fx'
import { SpendingComparisonHeader } from '@/pages/dashboard/widgets/spending-comparison/Header'

const REASON = 'This server allows no more of these'

function render(averageFxStatus: FxStatus | undefined) {
  return renderToStaticMarkup(
    <SpendingComparisonHeader
      spendingRange="MTD"
      fxStatus={undefined}
      averageFxStatus={averageFxStatus}
      showAverage
      onRangeChange={() => undefined}
    />,
  )
}

describe('spending comparison header average badge', () => {
  it('shows the badge for an average with a missing rate or with amounts left out, giving the reason', () => {
    expect(render({ state: 'incomplete', missing_pairs: [{ base: 'USD', quote: 'CAD' }] })).toContain(
      'aria-label="Average FX status"',
    )

    const withheld = render({ state: 'none', missing_pairs: [], withheld_reason: REASON })
    expect(withheld).toContain('aria-label="Average FX status"')
    expect(withheld).toContain(REASON)
  })

  it('leaves the badge out of an average that needed no conversion', () => {
    expect(render({ state: 'none', missing_pairs: [] })).not.toContain('aria-label="Average FX status"')
    expect(render(undefined)).not.toContain('aria-label="Average FX status"')
  })
})
