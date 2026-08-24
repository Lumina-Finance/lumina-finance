/**
 * Tests the colours every chart mark, meter and progress bar draws from, so a bar on one page and a
 * bar on another cannot end up different shades of the same colour
 */
import { describe, expect, it } from 'vitest'
import { getValueMarkColor } from '@/utils/valueMarkColor'

describe('value mark colours', () => {
  it('gives each tone the colour charts already use', () => {
    expect(getValueMarkColor('positive')).toBe('var(--app-chart-positive)')
    expect(getValueMarkColor('accent')).toBe('var(--app-accent)')
    expect(getValueMarkColor('negative')).toBe('var(--app-chart-negative)')
  })

  it('keeps the green and the red apart from the colours text is written in', () => {
    expect(getValueMarkColor('positive')).not.toBe('var(--app-positive)')
    expect(getValueMarkColor('negative')).not.toBe('var(--app-negative)')
  })
})
