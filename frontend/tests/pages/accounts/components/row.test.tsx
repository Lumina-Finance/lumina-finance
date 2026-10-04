/**
 * Guards the account row's FX badge, which sat inside the link to the account: a tap on it on a phone
 * opened the account instead of the badge's tooltip, and a link may not contain a button. The link
 * now sits on the account's name and the badge outside it
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `${amount}` }),
}))

import AccountRow from '@/pages/accounts/components/Row'
import { createForeignAccount } from './fixtures'

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
})
