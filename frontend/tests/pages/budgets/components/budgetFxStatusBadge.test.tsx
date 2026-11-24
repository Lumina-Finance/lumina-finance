/**
 * Guards a budget's FX badge when its total left out spending because converting it is refused: the
 * badge turns red and says the budget counts only its own currency before giving the reason
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FxStatus } from '@/api/shared/fx'
import BudgetFxStatusBadge from '@/pages/budgets/components/shared/FxStatusBadge'

const REASON = 'This server allows no more of these'
const MESSAGE = 'This budget counts only spending from accounts in its own currency'

function render(fxStatus: FxStatus, readOnly = false) {
  return renderToStaticMarkup(<BudgetFxStatusBadge label="Budget FX status" fxStatus={fxStatus} readOnly={readOnly} />)
}

// Reads the tone from the badge's own tag, whatever order its attributes come in
const tone = (markup: string) =>
  /<[^>]*aria-label="Budget FX status"[^>]*>/.exec(markup)?.[0].match(/data-fx-tone="(\w+)"/)?.[1]

describe('a budget’s FX badge', () => {
  it('turns red and says what the budget counts before the reason when spending was left out', () => {
    const markup = render({ state: 'none', missing_pairs: [], withheld_reason: REASON })

    expect(tone(markup)).toBe('red')
    expect(markup.indexOf(MESSAGE)).toBeGreaterThanOrEqual(0)
    expect(markup.indexOf(REASON)).toBeGreaterThan(markup.indexOf(MESSAGE))
  })

  it('stays grey and says only that other currencies are left out on a read-only budget', () => {
    const markup = render({ state: 'none', missing_pairs: [], withheld_reason: REASON }, true)

    expect(tone(markup)).toBe('gray')
    expect(markup).toContain('Spending in other currencies isn&#x27;t counted in this budget')
    expect(markup).not.toContain(MESSAGE)
    expect(markup).not.toContain(REASON)
  })

  it('keeps its usual tone and message when nothing was left out', () => {
    const markup = render({ state: 'complete', missing_pairs: [] })

    expect(tone(markup)).toBe('blue')
    expect(markup).not.toContain(MESSAGE)
  })
})
