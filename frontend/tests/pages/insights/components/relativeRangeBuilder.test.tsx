/**
 * Guards the custom range builder's message for an amount past the 20 years a report covers. The
 * message sits on the amount field so the user sees why Apply does nothing
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SavedInsightsRangeQualifier, SavedInsightsRangeUnit } from '@/api/insights'
import { RelativeRangeBuilder } from '@/pages/insights/components/RelativeRangeBuilder'

function drawBuilder(amount: number, unit: SavedInsightsRangeUnit, qualifier: SavedInsightsRangeQualifier = 'past') {
  return renderToStaticMarkup(
    <RelativeRangeBuilder
      amount={amount}
      unit={unit}
      qualifier={qualifier}
      onAmountChange={() => undefined}
      onUnitChange={() => undefined}
      onQualifierChange={() => undefined}
    />,
  )
}

describe('relative range builder amount', () => {
  it('shows no message for an amount within 20 years', () => {
    const markup = drawBuilder(240, 'month')

    expect(markup).not.toContain('Can cover at most 20 years')
    expect(markup).toContain('aria-invalid="false"')
  })

  it('shows the message on the amount field for one past 20 years', () => {
    const markup = drawBuilder(241, 'month')

    expect(markup).toContain('Can cover at most 20 years')
    expect(markup).toContain('aria-invalid="true"')
  })

  it('shows no message for This, as it has no amount to be too long', () => {
    expect(drawBuilder(1, 'year', 'this')).not.toContain('Can cover at most 20 years')
  })
})
