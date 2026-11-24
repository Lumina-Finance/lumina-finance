/**
 * Guards the edit dialogue of an account the server keeps read-only. Its identity and details sit in a
 * disabled fieldset under the reason, since the server refuses a change to them, each field held back in
 * the transaction form's muted look. Archiving and deleting stay outside it, open
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '@/api/accounts'
import { ToastContext, type ToastValue } from '@/contexts/ToastContext'
import { EDIT_ACCOUNT_IDENTITY_FIELD_IDS } from '@/pages/accounts/detail/constants/accountDetail'
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

/** The opening tag of the input or textarea with this id */
function fieldTag(markup: string, id: string): string {
  return new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(markup)?.[0] ?? ''
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

  it('marks the account read-only in a pill and disables the fieldset holding the name and details', () => {
    const markup = renderDialogue(account)
    const { opening, fieldset } = splitAtFieldset(markup)

    expect(markup).toMatch(
      new RegExp(
        `data-testid="read-only-reason-pill"[^>]*><span class="min-w-0 truncate">Read-only</span><span class="sr-only">\\. ${REASON}`,
      ),
    )
    expect(opening).toContain('disabled=""')
    expect(fieldset).toContain('Everyday')
  })

  it("holds back the name, institution and notes in the transaction form's muted look", () => {
    const { fieldset } = splitAtFieldset(renderDialogue(account))

    for (const id of [EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name, EDIT_ACCOUNT_IDENTITY_FIELD_IDS.notes]) {
      const field = fieldTag(fieldset, id)
      expect(field).toContain('disabled=""')
      expect(field).toContain('disabled:opacity-60')
    }
    expect(fieldset).toContain('app-dropdown-glass-disabled')
  })

  it('greys out Save changes, described by the reason', () => {
    const markup = renderDialogue(account)
    const save = /<button\b[^>]*data-testid="account-submit"[^>]*>/.exec(markup)?.[0] ?? ''

    expect(save).toContain('aria-disabled="true"')
    expect(save).toMatch(/aria-describedby="[^"]+"/)
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
    expect(fieldTag(markup, EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name)).not.toContain('disabled=""')
    expect(markup).not.toContain('app-dropdown-glass-disabled')
    expect(/<button\b[^>]*data-testid="account-submit"[^>]*>/.exec(markup)?.[0]).not.toContain('aria-disabled')
  })
})
