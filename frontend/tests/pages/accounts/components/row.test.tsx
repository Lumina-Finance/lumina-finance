/**
 * Guards the account row's FX badge. It sat inside the link to the account: a tap on it on a phone
 * opened the account instead of the badge's tooltip, and a link may not contain a button. The link
 * now sits on the account's name and the badge outside it, and the link is described by the rest of
 * the row. Its name carried that while it wrapped the row
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  // The row reads the currencies to shorten the credit available on a phone
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `${amount}`, currencies: [] }),
}))

import AccountRow from '@/pages/accounts/components/Row'
import { createForeignAccount, createPlan } from './fixtures'

const ACCOUNT = createForeignAccount()

describe('account row', () => {
  it('links the account through its name and keeps the FX badge outside the link', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AccountRow
          account={ACCOUNT}
          accent="positive"
          showCreditLimit={false}
          taxAdvantagedCategoryById={new Map()}
          displayCurrency="CAD"
        />
      </MemoryRouter>,
    )
    const link = markup.match(/<a\b[^>]*>(.*?)<\/a>/)

    expect(link?.[0]).toContain('href="/accounts/account-1"')
    expect(link?.[1]).toBe('Everyday Chequing')
    expect(markup).toContain('aria-label="Account balance FX status"')
  })

  it("describes the link by what the row shows beside the name, in the row's order", () => {
    const plan = createPlan()
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AccountRow
          account={createForeignAccount({
            account_kind: 'revolving',
            account_type: 'credit_card',
            tax_advantaged_category_id: plan.id,
            current_balance: -20_000,
            credit_limit: 100_000,
          })}
          accent="negative"
          showCreditLimit
          taxAdvantagedCategoryById={new Map([[plan.id, plan]])}
          displayCurrency="CAD"
        />
      </MemoryRouter>,
    )
    const describedBy = markup.match(/<a\b[^>]*\baria-describedby="([^"]*)"/)?.[1].split(' ') ?? []

    // The text of the element each id names, with the markers React leaves between joined text taken out
    const textOf = (id: string) => {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return markup
        .match(new RegExp(`<(p|span)\\b[^>]*\\bid="${escaped}"[^>]*>(.*?)</\\1>`))?.[2]
        .replaceAll('<!-- -->', '')
    }

    // The logo and the FX badge are left out: the type line names the bank, and the badge is a control of its own
    expect(describedBy.map(textOf)).toEqual(['TFSA', 'Credit card', '-20000', 'FX unavailable', '80000 avail.'])
  })
})
