import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: { span: ({ children }: { children: ReactNode }) => createElement('span', null, children) },
}))

describe('selected filter chips', () => {
  it('shows the empty selection message without selections', () => {
    expect(renderToStaticMarkup(<ActiveFilterChips chips={[]} />)).toContain('No filters applied')
  })

  it.each([1, 12])('keeps all %i full labels and removal names', (count) => {
    const labels = Array.from({ length: count }, (_, index) => `Long institution ${index} with a name extending beyond the panel width`)
    const markup = renderToStaticMarkup(<ActiveFilterChips chips={labels.map((label) => ({ key: label, label, onRemove: vi.fn() }))} />)
    for (const label of labels) {
      expect(markup).toContain(`aria-label="Remove ${label}"`)
      expect(markup).toContain(label)
    }
    expect(markup.match(/type="button"/g)).toHaveLength(count)
    expect(markup).toContain('aria-label="Selected filters"')
  })
})
