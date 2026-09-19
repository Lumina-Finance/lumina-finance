import { describe, expect, it } from 'vitest'
import { getEditableHighlightedOption } from '@/components/dropdown/options'

const highlighted = { value: 'highlighted', label: 'Highlighted Bank' }

describe('getEditableHighlightedOption', () => {
  it('returns an eligible highlighted record', () => {
    expect(getEditableHighlightedOption([highlighted], 0, true)).toBe(highlighted)
  })

  it.each([
    { value: '', label: 'None' },
    { value: 'disabled', label: 'Disabled Bank', disabled: true },
  ])('rejects ineligible highlighted option $label', (option) => {
    expect(getEditableHighlightedOption([option], 0, true)).toBeUndefined()
  })

  it('does not return an action without a handler or exact highlighted target', () => {
    expect(getEditableHighlightedOption([highlighted], 0, false)).toBeUndefined()
    expect(getEditableHighlightedOption([highlighted], -1, true)).toBeUndefined()
    expect(getEditableHighlightedOption([], 0, true)).toBeUndefined()
  })
})
