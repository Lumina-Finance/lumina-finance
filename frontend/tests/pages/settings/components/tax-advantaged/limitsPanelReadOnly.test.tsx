/**
 * Guards a read-only category's yearly limits: Add year and each year's delete are held back with the
 * check's sentence as their reason, so the user learns why rather than meeting a refused save
 */
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `${amount}`, currencies: [] }),
}))

import TaxAdvantagedLimitsPanel from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/panels/LimitsPanel'

const REASON = 'This server allows no more of these'

const PLAN: TaxAdvantagedCategory = {
  id: 'plan-1',
  category_owner_user_id: 'user-1',
  group_id: null,
  name: 'Roth IRA',
  tax_treatment: 'tax_free',
  currency: 'USD',
  lifetime_contribution_limit: null,
  accrued_contributions: 0,
  counts_internal_transfers: false,
  accrued_lifetime_contribution_limit: null,
  current_year_contribution_limit: 700_000,
  current_year_withdrawal_limit: null,
  ytd_contributions: 0,
  ytd_withdrawals: 0,
  lifetime_contributions: 0,
  lifetime_withdrawals: 0,
  created_at: '2026-01-01T00:00:00Z',
  read_only_reason: null,
}

function renderPanel(plan: TaxAdvantagedCategory) {
  return renderToStaticMarkup(
    <TaxAdvantagedLimitsPanel
      deleteConfirmYear={null}
      hasLifetimePriorActivity={false}
      hasScrollableLimitRows={false}
      limitDeleteButtonRef={createRef()}
      limitError={null}
      limitsLoading={false}
      onDeleteLimit={() => {}}
      onSelectLimitYear={() => {}}
      onStartNewLimitForm={() => {}}
      pendingDeleteLimitYear={null}
      plan={plan}
      selectedLimitYear={null}
      showAddTaxYear={false}
      sortedLimits={[
        {
          tax_advantaged_category_id: plan.id,
          year: 2026,
          contribution_limit: 700_000,
          withdrawal_limit: null,
          accrued_contributions: 0,
          accrued_withdrawals: 0,
        },
      ]}
    />,
  )
}

/** Returns the opening tag of the button whose text or label contains the given words */
function buttonTag(markup: string, words: string) {
  return [...markup.matchAll(/<button\b[^>]*>(?:(?!<\/button>).)*<\/button>/g)]
    .map((match) => match[0])
    .find((button) => button.includes(words))
    ?.match(/^<button\b[^>]*>/)?.[0]
}

describe('a read-only category’s yearly limits', () => {
  it('holds back Add year and the year’s delete with the sentence', () => {
    const markup = renderPanel({ ...PLAN, read_only_reason: REASON })

    for (const words of ['Add year', 'Delete 2026 limits']) {
      const tag = buttonTag(markup, words)
      expect(tag).toContain('aria-disabled="true"')
      const describedBy = tag?.match(/aria-describedby="([^"]+)"/)?.[1]
      expect(markup).toContain(`<span id="${describedBy}" hidden="">${REASON}</span>`)
    }
  })

  it('leaves both available while the category can change', () => {
    const markup = renderPanel(PLAN)

    expect(buttonTag(markup, 'Add year')).not.toContain('aria-disabled="true"')
    expect(buttonTag(markup, 'Delete 2026 limits')).not.toContain('aria-disabled="true"')
  })
})
