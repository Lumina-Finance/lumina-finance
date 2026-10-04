/**
 * Guards the account row's FX badge, which sat inside the link to the account: a tap on it on a phone
 * opened the account instead of the badge's tooltip, and a link may not contain a button. The link
 * now sits on the account's name and the badge outside it. Also guards the row's keyboard focus,
 * which showed only as a tint too faint to find
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

  it('rings the whole row in the accent focus outline while the link has keyboard focus', () => {
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
    const linkClasses = markup.match(/<a\b[^>]*class="([^"]*)"/)?.[1].split(/\s+/)

    expect(linkClasses).toEqual(expect.arrayContaining([
      'after:inset-0',
      'focus-visible:after:outline-2',
      'focus-visible:after:outline-[var(--app-accent)]',
    ]))
  })
})
