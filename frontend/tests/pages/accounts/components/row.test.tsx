/**
 * Guards the account row's FX badge. It sat inside the link to the account: a tap on it on a phone
 * opened the account instead of the badge's tooltip, and a link may not contain a button. The link
 * now sits on the account's name and the badge outside it, and the link is described by the rest of
 * the row. Its name carried that while it wrapped the row. The credit available is read where the width
 * draws it, since a screen reader reads a named element that is hidden itself, a credit line a phone hides
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  // The row reads the currencies to shorten the credit available on a phone
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `${amount}`, currencies: [] }),
}))

import AccountRow from '@/pages/accounts/components/Row'
import { findById, isDrawn, parseMarkup, readElement } from '@tests/utils/readMarkup'
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

  it('says a balance stays out of the totals, with the FX badge giving the reason, when converting it is refused', () => {
    const reason = 'This server allows no more of these'
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AccountRow
          account={createForeignAccount({
            base_currency_current_balance: 0,
            current_balance_fx_status: { state: 'none', missing_pairs: [], withheld_reason: reason },
          })}
          accent="positive"
          showCreditLimit={false}
          taxAdvantagedCategoryById={new Map()}
          displayCurrency="CAD"
        />
      </MemoryRouter>,
    )

    expect(markup).toContain('Not in totals')
    expect(markup).not.toContain('FX unavailable')
    expect(markup).toContain('aria-label="Account balance FX status"')
    expect(markup).toContain(reason)

    // No z-index around the badge, since one would hold its tooltip under the sticky institution header
    const wrapper = markup.split('aria-label="Account balance FX status"')[0].split('<span').at(-2) ?? ''
    expect(wrapper).not.toMatch(/\bz-\d+/)
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
    // The logo and the FX badge are left out: the type line names the bank, and the badge is a control of its own
    expect(describedTexts(markup, 1024)).toEqual(['TFSA', 'Credit card', '-20000', 'FX unavailable', '80000 avail.'])
  })

  it('greys out an account in another currency the check keeps read-only, with its reason in a pill the link names', () => {
    const reason = 'This server allows no more of these'
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AccountRow
          account={createForeignAccount({ read_only_reason: reason })}
          accent="positive"
          showCreditLimit={false}
          taxAdvantagedCategoryById={new Map()}
          displayCurrency="CAD"
        />
      </MemoryRouter>,
    )
    const row = markup.match(/<div data-testid="account-row-account-1"[^>]*style="([^"]*)"/)

    expect(row?.[1]).toContain('--app-text:var(--app-text-muted)')
    expect(markup).toContain('data-testid="read-only-reason-pill"')
    expect(describedTexts(markup, 1024)).toEqual(['Checking', reason, '50000', 'FX unavailable'])
  })

  it('shows no pill and draws the row as usual while the account can change', () => {
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

    expect(markup).not.toContain('read-only-reason-pill')
    expect(markup).not.toContain('--app-text:var(--app-text-muted)')
  })

  it('reads the credit available in the place each width draws it', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AccountRow
          account={createForeignAccount({
            account_kind: 'revolving',
            account_type: 'credit_card',
            current_balance: -20_000,
            credit_limit: 100_000,
          })}
          accent="negative"
          showCreditLimit
          taxAdvantagedCategoryById={new Map()}
          displayCurrency="CAD"
        />
      </MemoryRouter>,
    )

    // A phone draws it after the type, and wider screens under the balance
    expect(describedTexts(markup, 375)).toEqual(['Credit card · 80000 avail.', '-20000', 'FX unavailable', ''])
    expect(describedTexts(markup, 1024)).toEqual(['Credit card', '-20000', 'FX unavailable', '80000 avail.'])
  })
})

// Tailwind's `min-[750px]` is the width the row switches from its phone layout to its wide one
function pageThreshold(variant: string): number | null {
  const match = variant.match(/^min-\[(\d+)px\]$/)
  return match ? Number(match[1]) : null
}

/** What each id the account link is described by names, as a screen reader reads it with the page `width` wide */
function describedTexts(markup: string, width: number): string[] {
  const tree = parseMarkup(markup)
  const describedBy = markup.match(/<a\b[^>]*\baria-describedby="([^"]*)"/)?.[1].split(' ') ?? []
  const isDrawnAtWidth = (attributes: string) => isDrawn(attributes, width, pageThreshold)
  return describedBy.map((id) => {
    const element = findById(tree, id)
    return element ? readElement(element, isDrawnAtWidth, true) : `missing ${id}`
  })
}
