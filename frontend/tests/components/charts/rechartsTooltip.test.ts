/**
 * Covers shared Recharts tooltip helpers used by dashboard charts
 *
 * These tests catch regressions where partial Recharts hover state selects the
 * wrong data point or drops the cursor guide position
 */
import type { MouseEvent as ReactMouseEvent } from 'react'
import { describe, expect, it } from 'vitest'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'

type TestPoint = {
  label: string
  value: number
}

const points: TestPoint[] = [
  { label: 'Jan', value: 100 },
  { label: 'Feb', value: 200 },
]

describe('Recharts tooltip helpers', () => {
  it('prefers payload points before falling back to active index and label', () => {
    const pointsByLabel = new Map(points.map((point) => [point.label, point]))

    expect(getRechartsTooltipPoint({
      state: { activePayload: [{ payload: points[1] }], activeTooltipIndex: 0, activeLabel: 'Jan' },
      data: points,
      resolveLabel: (label) => pointsByLabel.get(label),
    })).toBe(points[1])
    expect(getRechartsTooltipPoint({
      state: { activeTooltipIndex: '1', activeLabel: 'Jan' },
      data: points,
      resolveLabel: (label) => pointsByLabel.get(label),
    })).toBe(points[1])
    expect(getRechartsTooltipPoint({
      state: { activeLabel: 'Feb' },
      data: points,
      resolveLabel: (label) => pointsByLabel.get(label),
    })).toBe(points[1])
  })

  it('does not treat null active indexes as the first data point', () => {
    expect(getRechartsTooltipPoint({
      state: { activeTooltipIndex: null },
      data: points,
    })).toBeUndefined()
  })

  it('keeps cursor coordinates and chart coordinates for tooltip positioning', () => {
    const event = { clientX: 120, clientY: 48 } as ReactMouseEvent<SVGGraphicsElement>
    const state: RechartsTooltipState<TestPoint> = { activeCoordinate: { x: 32 } }

    expect(getRechartsTooltipPointer(state, event)).toEqual({
      clientX: 120,
      clientY: 48,
      chartX: 32,
    })
  })
})
