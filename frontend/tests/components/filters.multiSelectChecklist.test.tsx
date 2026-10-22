/**
 * Guards the checklist's opt-in details: the credit utilization chooser shows each account's type
 * and institution in its row, while the filter panels' rows stay a label and a check
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { filterChecklistOptions } from '@/components/filters/filterChecklistOptions'
import { MultiSelectChecklist } from '@/components/filters/MultiSelectChecklist'
import { getFilterOptionStyle } from '@/components/filters/optionAppearance'
import type { OptionItem } from '@/components/filters/OptionList'

function render(options: OptionItem[]): string {
  return renderToStaticMarkup(
    <MultiSelectChecklist
      options={options}
      selectedValues={['a']}
      searchPlaceholder="Search accounts"
      fillHeight={false}
      onToggle={vi.fn()}
    />,
  )
}

describe('multi-select checklist details', () => {
  it('names each row by its label, type and institution, leaving the institution out when there is none', () => {
    const markup = render([
      { value: 'a', label: 'Travel Card', details: { type: 'Credit card', institution: 'Harbor Credit Union' } },
      { value: 'b', label: 'Cash Card', details: { type: 'Line of credit', institution: null } },
    ])

    expect(markup).toContain('Credit card')
    expect(markup).toContain('Harbor Credit Union')
    expect(markup).toContain('Line of credit')
    expect(markup.match(/ · /g)).toHaveLength(1)
    // The row with no logo keeps a logo slot, so its text starts where the other rows' text does
    expect(markup.match(/>\$</g)).toHaveLength(2)
  })

  it('searches the type and institution as well as the label, and only the label for a filter option', () => {
    const options: OptionItem[] = [
      { value: 'a', label: 'Travel Card', details: { type: 'Credit card', institution: 'Harbor Credit Union' } },
      { value: 'b', label: 'Home line', details: { type: 'Line of credit', institution: null } },
      { value: 'c', label: 'Harbor' },
    ]

    expect(filterChecklistOptions(options, ' HARBOR ').map((option) => option.value)).toEqual(['a', 'c'])
    expect(filterChecklistOptions(options, 'line of').map((option) => option.value)).toEqual(['b'])
    expect(filterChecklistOptions(options, 'credit card').map((option) => option.value)).toEqual(['a'])
    expect(filterChecklistOptions(options, '  ')).toBe(options)
  })

  it('keeps the filter panels on the plain accent and gives only a list with details the darker selected text', () => {
    expect(getFilterOptionStyle(true).color).toBe('var(--app-accent)')
    expect(getFilterOptionStyle(true, true).color).toBe('var(--app-accent-on-page-tint)')
    expect(getFilterOptionStyle(false, true).color).toBe(getFilterOptionStyle(false).color)

    const withDetails = render([{ value: 'a', label: 'Travel Card', details: { type: 'Credit card', institution: null } }])
    const filterRow = render([{ value: 'a', label: 'Travel Card' }])
    expect(withDetails).toContain('color:var(--app-accent-on-page-tint)')
    expect(filterRow).toContain('color:var(--app-accent)')
  })

  it('draws a filter row as a label and a check only', () => {
    const markup = render([
      { value: 'a', label: 'Travel Card' },
      { value: 'b', label: 'Cash Card' },
    ])

    expect(markup).toContain('Travel Card')
    expect(markup).not.toContain(' · ')
    expect(markup).not.toContain('>$<')
    expect(markup).toContain('space-y-1 ')
    expect(markup).not.toContain('space-y-1.5')
  })

  it('spaces the rows of a list with details one step wider than the filter panels', () => {
    const markup = render([{ value: 'a', label: 'Travel Card', details: { type: 'Credit card', institution: null } }])

    expect(markup).toContain('space-y-1.5')
    expect(markup).not.toContain('space-y-1 ')
  })
})
