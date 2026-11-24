/**
 * Guards a read-only category's account links. Linking or unlinking changes the account, so the toggles
 * are held back with a "Read-only" pill above the list while the category is read-only, and on one
 * account's row with the pill while only that account is
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import { createPlan } from '@tests/pages/accounts/components/fixtures'
import { createAccount } from '@tests/components/transactions/transaction-modal/utils/fixtures'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `${amount}`, currencies: [] }),
}))

import TaxAdvantagedAccountLinksPanel from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/panels/AccountLinksPanel'

const REASON = 'Records in USD are read-only. They can be archived or deleted'

const BROKERAGE = createAccount({ id: 'brokerage', name: 'Brokerage', currency: 'USD' })
const SAVINGS = createAccount({ id: 'savings', name: 'Savings', currency: 'USD' })

function renderPanel(planReason: string | null, accounts: AccountsOverview[]): string {
  return renderToStaticMarkup(
    <TaxAdvantagedAccountLinksPanel
      accountError={null}
      bindableAccounts={accounts}
      linkedAccountsCount={0}
      onToggleAccount={() => {}}
      pendingAccountId={null}
      plan={createPlan({ currency: 'USD', read_only_reason: planReason })}
    />,
  )
}

/** The opening tag of the checkbox named `label` */
function checkbox(markup: string, label: string): string {
  return new RegExp(`<input\\b[^>]*aria-label="${label}"[^>]*>`).exec(markup)?.[0] ?? ''
}

describe('the account links of a read-only category', () => {
  it('holds every toggle back, each described by the pill above the list holding the reason', () => {
    const markup = renderPanel(REASON, [BROKERAGE, SAVINGS])
    const pills = [...markup.matchAll(/<span id="([^"]+)" data-testid="read-only-reason-pill" tabindex="0"/g)]
    const reasonId = pills[0]?.[1]

    // One pill above the list covers every row, so no row repeats it, and no lasting sentence shows
    expect(pills).toHaveLength(1)
    expect(markup).toContain(`<span class="sr-only">. ${REASON}</span>`)
    expect(markup).not.toContain('role="note"')
    for (const label of ['Link Brokerage', 'Link Savings']) {
      expect(checkbox(markup, label)).toContain('disabled=""')
      expect(checkbox(markup, label)).toContain(`aria-describedby="${reasonId}"`)
    }
  })

  it("holds back only a read-only account's toggle, with the reason in a pill on its row", () => {
    const markup = renderPanel(null, [{ ...BROKERAGE, read_only_reason: REASON }, SAVINGS])
    const brokerage = checkbox(markup, 'Link Brokerage')
    const pillId = brokerage.match(/aria-describedby="([^"]+)"/)?.[1]

    expect(brokerage).toContain('disabled=""')
    expect(markup).toContain(`<span id="${pillId}" data-testid="read-only-reason-pill"`)
    expect(checkbox(markup, 'Link Savings')).not.toContain('disabled=""')
    expect(checkbox(markup, 'Link Savings')).not.toContain('aria-describedby')
  })

  it('leaves the toggles open on a category and accounts that take writes', () => {
    const markup = renderPanel(null, [BROKERAGE, SAVINGS])

    expect(checkbox(markup, 'Link Brokerage')).not.toContain('disabled=""')
    expect(markup).not.toContain(REASON)
  })
})
