/**
 * Guards a budget the check keeps read-only, as its currency is another than the user's main one: its
 * card looks archived, with a "Read-only" pill in the status's place and no spending summary, while a
 * budget that can change keeps its status and summary
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BaseBudget, Budget } from '@/api/budgets'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `${amount}`, currencies: [] }),
}))

import BudgetCard from '@/pages/budgets/components/budget-card/Card'

const REASON = 'This server allows no more of these'

const BUDGET: BaseBudget = {
  id: 'budget-1',
  owner_id: 'user-1',
  group_id: null,
  name: 'Travel',
  currency: 'USD',
  recurrence_freq: 'monthly',
  instance_length: 1,
  recurrence_weekday: null,
  recurrence_dom: 1,
  recurrence_month: null,
  recurs: true,
  created_at: '2026-01-01T00:00:00Z',
  is_archived: false,
  category_ids: [],
  read_only_reason: null,
}

const PERIOD = {
  id: 'period-1',
  base_budget_id: 'budget-1',
  period_start: '2026-11-01',
  period_end: '2026-11-30',
  overall_limit: 60_000,
} as Budget

function renderCard(baseBudget: BaseBudget) {
  return renderToStaticMarkup(
    <BudgetCard
      baseBudget={baseBudget}
      latestPeriod={PERIOD}
      categoryNames={[]}
      utilization={undefined}
      onOpen={() => {}}
    />,
  )
}

/** The card's own style attribute */
function cardStyle(markup: string): string | undefined {
  return markup.match(/<article data-testid="budget-card-budget-1"[^>]*style="([^"]*)"/)?.[1]
}

describe('a read-only budget’s card', () => {
  it('looks archived, with the pill in the status’s place and no summary', () => {
    const markup = renderCard({ ...BUDGET, read_only_reason: REASON })

    expect(cardStyle(markup)).toContain('border-top:5px solid var(--app-text-muted)')
    expect(markup).toMatch(/<article data-testid="budget-card-budget-1"[^>]*class="[^"]*opacity-80/)
    expect(markup).toContain('data-testid="read-only-reason-pill"')
    expect(markup).toContain(REASON)
    expect(markup).not.toContain('On track')
    expect(markup).not.toContain('used of')
    expect(markup).toContain('No upcoming periods')
    // The card is the control and the one stop, so Enter or Space opens the budget from the card alone
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1)
    expect(markup).toMatch(/<article data-testid="budget-card-budget-1"[^>]*tabindex="0"/)
  })

  it('keeps its status and summary while the budget can change', () => {
    const markup = renderCard(BUDGET)

    expect(markup).not.toContain('read-only-reason-pill')
    expect(cardStyle(markup)).not.toContain('var(--app-text-muted)')
    expect(markup).toContain('used of')
  })
})
