/**
 * Guards the checklist's opt-in detail columns: the credit utilization chooser shows each account's type
 * and institution in its row, while the filter panels' rows stay a label and a check
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { filterChecklistOptions } from '@/components/filters/filterChecklistOptions'
import { MultiSelectChecklist } from '@/components/filters/MultiSelectChecklist'
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
    // The row with no logo keeps the logo column, so its text lines up with the rows that have one
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

  it('draws a filter row as a label and a check only', () => {
    const markup = render([
      { value: 'a', label: 'Travel Card' },
      { value: 'b', label: 'Cash Card' },
    ])

    expect(markup).toContain('Travel Card')
    expect(markup).not.toContain(' · ')
    expect(markup).not.toContain('>$<')
  })
})
