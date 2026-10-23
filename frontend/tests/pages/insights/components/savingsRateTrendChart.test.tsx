/**
 * Guards the savings rate trend chart's value axis, whose negative ticks were written with a hyphen
 * while the figures and tooltips of the same chart used the true minus
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SavingsRateYAxisTick } from '@/pages/insights/components/savings-rate-trend-card/Chart'

/** Renders the tick the axis draws for a value */
function renderTick(value: number) {
  return renderToStaticMarkup(createElement('svg', null, createElement(SavingsRateYAxisTick, { payload: { value } })))
}

describe('savings rate axis ticks', () => {
  it.each([
    [-100, '−100%'],
    [-50, '−50%'],
    [0, '0%'],
    [50, '50%'],
  ])('writes a tick of %s as %s', (value, text) => {
    expect(renderTick(value)).toContain(`>${text}</text>`)
  })
})
