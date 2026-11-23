/**
 * Guards the edit dialogue of an account the server keeps read-only. Its identity and details sit in a
 * disabled fieldset under the reason, since the server refuses a change to them, and archiving and
 * deleting stay outside it, open
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '@/api/accounts'
import { ToastContext, type ToastValue } from '@/contexts/ToastContext'
import { createAccount } from '@tests/pages/accounts/detail/components/bank-link/fixtures'

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/modal/Shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/modal/Shell')>()),
  ModalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
// Closed throughout, and their shell reads the open modals through a store with no server snapshot
vi.mock('@/components/reference-modals/InstitutionModal', () => ({ default: () => null }))
vi.mock('@/pages/accounts/detail/components/bank-link/useAccountBankLink', () => ({
  useAccountBankLink: () => ({ status: undefined, statusError: null, providers: undefined, shown: false }),
}))
vi.mock('@/api/currency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/currency')>()),
  useCurrencies: () => ({ data: [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }] }),
}))
vi.mock('@/api/tax-advantaged-categories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/tax-advantaged-categories')>()),
  useTaxAdvantagedCategories: () => ({ data: [], error: null, isError: false }),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', tz: 'America/Toronto', base_currency: 'CAD' }, accessToken: 'token' }),
}))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  authenticatedFetch: vi.fn(() => Promise.reject(new Error('The dialogue sent a request while rendering'))),
}))

import EditAccountIdentityModal from '@/pages/accounts/detail/components/edit-identity/Modal'

const TOAST: ToastValue = { showToast: vi.fn(), dismissToast: vi.fn() }
const REASON = 'Records in USD are read-only. They can be archived or deleted'

function renderDialogue(account: Account): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastContext.Provider value={TOAST}>
        <MemoryRouter>
          <EditAccountIdentityModal
            open
            account={account}
            onClose={() => {}}
            onDeleteStarted={() => {}}
            onDeleted={() => {}}
            onDeleteFailed={() => {}}
          />
        </MemoryRouter>
      </ToastContext.Provider>
    </QueryClientProvider>,
  ).replaceAll('<!-- -->', '')
}

/** What sits inside the dialogue's fieldset, and what follows it */
function splitAtFieldset(markup: string): { fieldset: string; opening: string; after: string } {
  const start = markup.indexOf('<fieldset')
  const end = markup.indexOf('</fieldset>')
  return {
    opening: /<fieldset\b[^>]*>/.exec(markup)?.[0] ?? '',
    fieldset: markup.slice(start, end),
    after: markup.slice(end),
  }
}

describe('the edit dialogue of a read-only account', () => {
  const account = createAccount({ currency: 'USD', read_only_reason: REASON })

  it('shows the reason in a pill and disables the fieldset holding the name and details', () => {
    const markup = renderDialogue(account)
    const { opening, fieldset } = splitAtFieldset(markup)

    expect(markup).toMatch(
      new RegExp(`data-testid="read-only-reason-pill"[^>]*><span class="min-w-0 truncate">${REASON}`),
    )
    expect(opening).toContain('disabled=""')
    expect(fieldset).toContain('Everyday')
  })

  it('leaves archiving and deleting outside the fieldset', () => {
    const { fieldset, after } = splitAtFieldset(renderDialogue(account))

    expect(after).toMatch(/Archive/)
    expect(after).toMatch(/Delete/)
    expect(fieldset).not.toMatch(/Archive account/)
  })

  it('leaves the fieldset enabled on an account that takes writes', () => {
    const markup = renderDialogue(createAccount())

    expect(splitAtFieldset(markup).opening).not.toContain('disabled')
    expect(markup).not.toContain('read-only-reason-pill')
  })
})
