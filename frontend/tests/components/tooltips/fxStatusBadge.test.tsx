/**
 * Guards the FX badge's reason for amounts left out of a total because converting them is refused:
 * it reads in the neutral tone and takes the tooltip's place over any message a caller supplies, so a
 * total that left something out never reads as a failed or finished conversion
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'

const REASON = 'This server allows no more of these'

function render(fxStatus: FxStatus, getMessage?: (fxStatus: FxStatus) => string | undefined) {
  return renderToStaticMarkup(<FxStatusBadge label="FX status" fxStatus={fxStatus} getMessage={getMessage} />)
}

// Reads the tone from the badge's own tag, whatever order its attributes come in
const tone = (markup: string) =>
  /<[^>]*aria-label="FX status"[^>]*>/.exec(markup)?.[0].match(/data-fx-tone="(\w+)"/)?.[1]

describe('FX status badge with a reason for leaving amounts out', () => {
  it('shows the reason in the neutral tone instead of a caller message, whatever state the status is in', () => {
    const override = () => 'Some amounts could not be converted'
    const states = ['none', 'complete', 'incomplete'] as const

    for (const state of states) {
      const markup = render({ state, missing_pairs: [], withheld_reason: REASON }, override)

      expect(markup, state).toContain(REASON)
      expect(markup, state).not.toContain('could not be converted')
      expect(tone(markup), state).toBe('gray')
    }
  })

  it('still names the missing pairs beside the reason', () => {
    const markup = render({
      state: 'incomplete',
      missing_pairs: [{ base: 'EUR', quote: 'CAD' }],
      withheld_reason: REASON,
    })

    expect(markup).toContain('Missing: EUR/CAD')
  })

  it('keeps the caller message and the state tone when there is no reason', () => {
    const markup = render({ state: 'incomplete', missing_pairs: [] }, () => 'Some amounts could not be converted')

    expect(markup).toContain('Some amounts could not be converted')
    expect(tone(markup)).toBe('red')
  })
})
