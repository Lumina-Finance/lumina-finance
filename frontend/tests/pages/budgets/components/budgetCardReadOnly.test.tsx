/**
 * Guards a budget the check keeps read-only, as its currency is another than the user's main one: its
 * card is greyed out with the sentence in a pill, and a budget that can change shows neither
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BaseBudget } from '@/api/budgets'

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

function renderCard(baseBudget: BaseBudget) {
  return renderToStaticMarkup(
    <BudgetCard
      baseBudget={baseBudget}
      latestPeriod={undefined}
      categoryNames={[]}
      utilization={undefined}
      onOpen={() => {}}
    />,
  )
}

describe('a read-only budget’s card', () => {
  it('is greyed out with the sentence in a pill', () => {
    const markup = renderCard({ ...BUDGET, read_only_reason: REASON })
    const card = markup.match(/<article data-testid="budget-card-budget-1"[^>]*style="([^"]*)"/)

    expect(card?.[1]).toContain('--app-text:var(--app-text-muted)')
    expect(markup).toContain('data-testid="read-only-reason-pill"')
    expect(markup).toContain(REASON)
    // The card is the control and the one stop, so Enter or Space opens the budget from the card alone
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1)
    expect(markup).toMatch(/<article data-testid="budget-card-budget-1"[^>]*tabindex="0"/)
  })

  it('shows neither while the budget can change', () => {
    const markup = renderCard(BUDGET)

    expect(markup).not.toContain('read-only-reason-pill')
    expect(markup).not.toContain('--app-text:var(--app-text-muted)')
  })
})
