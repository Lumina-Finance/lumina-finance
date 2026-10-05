/**
 * Covers the identity card's Bank sync fact: the account's status label with its dot, as a button
 * into the edit modal's Bank link section, and left out where the page shows no bank sync
 *
 * These tests catch the fact shown to a user the deployment lets link nothing, the label and the
 * dot disagreeing, and the button losing the name that says where it leads. Opening the section
 * runs in the browser
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountBankStatus } from '@/api/bank-sync'
import { BankSyncFact } from '@/pages/accounts/detail/components/bank-link/BankSyncFact'
import { describeBankSync } from '@/pages/accounts/detail/components/bank-link/status'
import { createAccount, createImport, createLink, createStatus } from './fixtures'

const read = vi.hoisted(() => ({ shown: true, status: undefined as AccountBankStatus | undefined }))

vi.mock('@/pages/accounts/detail/components/bank-link/useAccountBankLink', () => ({
  useAccountBankLink: () => ({ shown: read.shown, syncLabel: describeBankSync(true, read.status, false) }),
}))

function renderFact(): string {
  return renderToStaticMarkup(<BankSyncFact account={createAccount()} onOpen={() => {}} />)
}

beforeEach(() => {
  read.shown = true
  read.status = createStatus()
})

describe('BankSyncFact', () => {
  it('opens the Bank link section from the account status label', () => {
    const markup = renderFact()
    expect(markup).toContain('Bank sync')
    expect(markup).toMatch(/<button[^>]*aria-label="Bank sync: Not linked. Open bank link"/)
    expect(markup).toContain('background:transparent;border:1.5px solid var(--app-text-subtle)')
  })

  it('shows a running import with the working dot', () => {
    read.status = createStatus({ link: createLink({ import: createImport() }) })
    const markup = renderFact()
    expect(markup).toContain('aria-label="Bank sync: Importing · 1 of 2. Open bank link"')
    expect(markup).toContain('Importing · 1 of 2')
    expect(markup).toContain('background:var(--app-bank);border:1.5px solid var(--app-bank)')
  })

  it('leaves the fact out where the page shows no bank sync', () => {
    read.shown = false
    expect(renderFact()).toBe('')
  })
})
