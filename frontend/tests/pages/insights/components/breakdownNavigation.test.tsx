import { cloneElement, createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BreakdownEntry } from '@/pages/insights/types/incomeExpenseBreakdown'

const captured = vi.hoisted(() => ({ animating: false, sectors: [] as ReactElement<{ onClick: () => void; onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => void }>[] }))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  PieChart: ({ children }: { children: ReactNode }) => createElement('svg', null, children),
  Pie: ({ data, shape }: { data: BreakdownEntry[]; shape: (props: unknown) => typeof captured.sectors[number] }) => {
    const sectors = data.map((payload) => cloneElement(shape({ payload, isAnimating: captured.animating, cx: 100, cy: 100, innerRadius: 40, outerRadius: 90, startAngle: 0, endAngle: 40 }), { key: payload.id }))
    captured.sectors.push(...sectors)
    return sectors
  },
  Cell: () => null,
  Sector: () => createElement('path', { d: 'M0 0L10 10' }),
}))
vi.mock('motion/react', () => ({
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  },
}))
vi.mock('@/hooks/useMoneyFormatters', () => ({ useMoneyFormatters: () => ({ formatCurrency: (amount: number) => String(amount) }) }))

import { IncomeExpensePieChart } from '@/pages/insights/components/income-expense-breakdown-card/PieChart'

const entries: BreakdownEntry[] = Array.from({ length: 7 }, (_, index) => ({
  id: `category-${index}`, name: `Category ${index}`, categoryKind: index === 6 ? 'income' : 'expense', amount: 100 - index,
}))

/** Renders the actual chart and its custom sector actions, replacing only Recharts geometry */
function render(onCategorySelect: (id: string) => void) {
  return renderToStaticMarkup(<IncomeExpensePieChart mode="expense" entries={entries} total={700} displayCurrency="CAD" animationKey="test" shouldReduceMotion onCategorySelect={onCategorySelect} />)
}

beforeEach(() => {
  captured.sectors = []
  captured.animating = false
})

describe('breakdown sector navigation', () => {
  it('gives every category a named focusable action, including ordinary entries beyond the legend', () => {
    const markup = render(vi.fn())
    for (const entry of entries) expect(markup).toContain(`aria-label="View ${entry.name} transactions"`)
    expect(markup.match(/role="button" tabindex="0"/g)).toHaveLength(7)
  })

  it('routes the actual clicked sector category without imposing its expense chart mode', () => {
    const onSelect = vi.fn()
    render(onSelect)
    captured.sectors[6].props.onClick()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('category-6')
  })

  it.each(['Enter', ' '])('activates the actual sector with %s and consumes the key', (key) => {
    const onSelect = vi.fn()
    render(onSelect)
    const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    captured.sectors[5].props.onKeyDown(event)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('category-5')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('leaves other chart keys alone', () => {
    const onSelect = vi.fn()
    render(onSelect)
    const event = { key: 'ArrowRight', preventDefault: vi.fn(), stopPropagation: vi.fn() }
    captured.sectors[0].props.onKeyDown(event)
    expect(onSelect).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('withholds focusability and pointer or keyboard activation while sector geometry changes', () => {
    captured.animating = true
    const onSelect = vi.fn()
    const markup = render(onSelect)
    expect(markup.match(/tabindex="-1" aria-disabled="true"/g)).toHaveLength(7)
    captured.sectors[0].props.onClick()
    for (const key of ['Enter', ' ']) {
      captured.sectors[0].props.onKeyDown({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    }
    expect(onSelect).not.toHaveBeenCalled()
  })
})
