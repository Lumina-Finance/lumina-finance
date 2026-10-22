/**
 * Guards the rule that keeps a blurred logo off screen: the favicon service answers an unknown site with a
 * 16px placeholder globe however large a size is asked for, and it must not be stretched into a 36px box
 */
import { describe, expect, it } from 'vitest'
import { isLogoTooSmall } from '@/utils/institutionLogo'

describe('isLogoTooSmall', () => {
  it('drops the 16px placeholder globe in a 36px box and a 20px box at any pixel ratio', () => {
    expect(isLogoTooSmall(16, 36, 1)).toBe(true)
    expect(isLogoTooSmall(16, 20, 1)).toBe(true)
    expect(isLogoTooSmall(16, 20, 2)).toBe(true)
  })

  it('keeps a logo that has a pixel for every pixel of its box, and a 152px favicon on a 3x screen', () => {
    expect(isLogoTooSmall(36, 36, 1)).toBe(false)
    expect(isLogoTooSmall(72, 36, 2)).toBe(false)
    expect(isLogoTooSmall(152, 36, 3)).toBe(false)
  })

  it('keeps a logo whose size the browser does not report, as for an SVG, or whose box is not laid out yet', () => {
    expect(isLogoTooSmall(0, 36, 2)).toBe(false)
    expect(isLogoTooSmall(16, 0, 2)).toBe(false)
  })
})
