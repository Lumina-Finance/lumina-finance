import { describe, expect, it } from 'vitest'
import { EMOJI_PICKER_STYLES } from '@/components/category-icon-selector/emojiPickerStyles'

describe('EMOJI_PICKER_STYLES', () => {
  it('takes every colour from the app tokens, so both themes follow the app', () => {
    expect(EMOJI_PICKER_STYLES).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(EMOJI_PICKER_STYLES).not.toMatch(/\brgba?\(/)
    expect(EMOJI_PICKER_STYLES).not.toMatch(/\bhsla?\(/)
  })

  it('leaves the glyph font of the emoji cells alone', () => {
    expect(EMOJI_PICKER_STYLES).not.toMatch(/\.category button\s*{[^}]*font-family/)
  })

  it('still eases the cell wash and drops it under reduced motion', () => {
    expect(EMOJI_PICKER_STYLES).toContain('var(--app-ease-curve)')
    expect(EMOJI_PICKER_STYLES).toContain('prefers-reduced-motion: reduce')
  })
})
