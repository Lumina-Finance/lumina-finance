/**
 * Guards the account page's identity card on an account the server keeps read-only: the card is faded,
 * its reason shows in a pill under the institution, and the Sync now icon beside the link is held back
 * with that reason. The edit button stays, since archiving and deleting are in the dialogue it opens
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '@/api/accounts'
import { ToastContext, type ToastValue } from '@/contexts/ToastContext'
import {
  createAccount,
  createConnection,
  createLink,
  createProviders,
  createStatus,
} from '@tests/pages/accounts/detail/components/bank-link/fixtures'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `${amount}`, currencies: [] }),
}))

// A live link read from the bank, on a connection with its requests to spare
vi.mock('@/pages/accounts/detail/components/bank-link/useAccountBankLink', () => ({
  useAccountBankLink: () => ({
    status: createStatus({ link: createLink() }),
    statusError: null,
    providers: createProviders(),
    shown: true,
    syncLabel: { label: 'Synced 1 hour ago', tone: 'ok', pulse: false, details: [] },
    ownPersonal: true,
  }),
}))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useBankConnections: () => ({ data: [createConnection()] }),
}))

import AccountIdentityCard from '@/pages/accounts/detail/components/identity/Card'

const TOAST: ToastValue = { showToast: vi.fn(), dismissToast: vi.fn() }
const REASON = 'Records in USD are read-only. They can be archived or deleted'

function renderCard(account: Account): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ToastContext.Provider value={TOAST}>
        <AccountIdentityCard
          account={account}
          linkedTaxAdvantagedCategory={undefined}
          linkedTaxAdvantagedCategoryError={null}
          onEdit={() => {}}
          onOpenBankSync={() => {}}
        />
      </ToastContext.Provider>
    </QueryClientProvider>,
  )
}

/** The opening tag of the button named `label` */
function buttonTag(markup: string, label: string): string {
  return new RegExp(`<button\\b[^>]*aria-label="${label}"[^>]*>`).exec(markup)?.[0] ?? ''
}

describe('the identity card of a read-only account', () => {
  it('fades the card and shows the reason in a pill, leaving the edit button open', () => {
    const markup = renderCard(createAccount({ currency: 'USD', read_only_reason: REASON }))

    expect(markup).toMatch(/^<section class="app-card[^"]*" style="[^"]+"/)
    expect(markup).toMatch(
      new RegExp(`data-testid="read-only-reason-pill"[^>]*><span class="min-w-0 truncate">${REASON}`),
    )
    expect(buttonTag(markup, 'Edit account')).not.toContain('aria-disabled')
  })

  it('holds the Sync now icon back with the reason', () => {
    const markup = renderCard(createAccount({ currency: 'USD', read_only_reason: REASON }))

    expect(buttonTag(markup, 'Sync now')).toContain('aria-disabled="true"')
  })

  it('leaves the card and the icon as they are on an account that takes writes', () => {
    const markup = renderCard(createAccount())

    expect(markup).toMatch(/^<section class="app-card[^"]*">/)
    expect(markup).not.toContain('read-only-reason-pill')
    // The icon's class styles a held-back state, so the check reads the attribute itself
    expect(buttonTag(markup, 'Sync now')).not.toContain('aria-disabled="true"')
  })
})
