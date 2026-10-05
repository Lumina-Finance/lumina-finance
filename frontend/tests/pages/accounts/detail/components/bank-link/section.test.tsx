/**
 * Covers what the edit modal's Bank link section shows for each kind of account: a group account
 * kept manual, an account never linked, one linked before, an archived one, and a live link with
 * its facts, status and import
 *
 * These tests catch a group account offered a link, the previous link's bank account, provider or
 * date dropped from the relink text, the relink button worded as a first link, an archived account
 * or a paused worker leaving the button live, a failed read offering a link as if there were none,
 * and a linked view missing a fact, its status or the running import. Opening the flow, the tooltip
 * and unlinking run in the browser
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/api/accounts'
import type { AccountBankStatus, BankProvidersResponse } from '@/api/bank-sync'
import { GROUP_ACCOUNT_LINK_REASON, LINKING_PAUSED_REASON } from '@/components/bank-link-flow/constants'
import { BankLinkSection } from '@/pages/accounts/detail/components/bank-link/Section'
import { describeBankSync } from '@/pages/accounts/detail/components/bank-link/status'
import { createAccount, createImport, createLink, createPreviousLink, createProviders, createStatus } from './fixtures'

const read = vi.hoisted(() => ({
  ownPersonal: true,
  status: undefined as AccountBankStatus | undefined,
  statusError: null as Error | null,
  providers: undefined as BankProvidersResponse | undefined,
}))

vi.mock('@/pages/accounts/detail/components/bank-link/useAccountBankLink', () => ({
  useAccountBankLink: () => ({
    ownPersonal: read.ownPersonal,
    status: read.status,
    statusError: read.statusError,
    providers: read.providers,
    shown: true,
    syncLabel: describeBankSync(read.ownPersonal, read.status, read.statusError !== null),
  }),
}))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useBankConnections: () => ({ data: [] }),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', tz: 'America/Toronto' }, accessToken: 'token' }),
}))
vi.mock('@/components/bank-link-flow/Modal', () => ({ BankLinkFlowModal: () => null }))

// Static rendering escapes apostrophes, so text is matched against the escaped form
function escaped(text: string): string {
  return text.replaceAll("'", '&#x27;')
}

function renderSection(account: Account = createAccount()): string {
  return renderToStaticMarkup(<BankLinkSection account={account} sectionNumber="03" />)
}

function getButton(markup: string, label: string): string {
  return markup.match(new RegExp(`<button(?:(?!</button>).)*${label}</button>`, 's'))?.[0] ?? ''
}

beforeEach(() => {
  read.ownPersonal = true
  read.status = createStatus()
  read.statusError = null
  read.providers = createProviders()
})

describe('BankLinkSection', () => {
  it('keeps a group account manual, with no way to link it', () => {
    read.ownPersonal = false
    read.status = undefined
    const markup = renderSection(createAccount({ group_id: 'group-1' }))
    expect(markup).toContain(`${escaped(GROUP_ACCOUNT_LINK_REASON)} Its transactions stay manual.`)
    expect(markup).not.toContain('Link bank account')
  })

  it('offers a first link to an account never linked', () => {
    const markup = renderSection()
    expect(markup).toContain('Bank link')
    expect(markup).toContain('Link this account to one of the bank accounts on your connections to bring in its transactions automatically.')
    expect(getButton(markup, 'Link bank account')).not.toContain('aria-disabled')
  })

  it('names the previous link and offers to reconnect it', () => {
    read.status = createStatus({ previous_link: createPreviousLink() })
    const markup = renderSection()
    expect(markup).toContain(
      'Previously linked to Everyday Chequing at Harbour Bank through SimpleFIN, until Sep 20, 2026. Reconnecting fetches what the bank reported since then.',
    )
    expect(getButton(markup, 'Reconnect bank account')).not.toBe('')
    expect(markup).not.toContain('Link bank account')
  })

  it('refuses a link on an archived account, and while the sync worker is down, saying why', () => {
    const archived = renderSection(createAccount({ is_archived: true }))
    expect(getButton(archived, 'Link bank account')).toContain('aria-disabled="true"')
    expect(archived).toContain('Archived accounts are read-only')

    read.providers = createProviders({ sync_running: false })
    const paused = renderSection()
    expect(getButton(paused, 'Link bank account')).toContain('aria-disabled="true"')
    expect(paused).toContain(escaped(LINKING_PAUSED_REASON))
  })

  it('shows a live link with its facts, its status, the running import and a way to unlink', () => {
    read.status = createStatus({ link: createLink({ import: createImport() }) })
    const markup = renderSection()
    for (const fact of ['Bank account', 'Everyday Chequing', 'Institution', 'Harbour Bank', 'Through', 'SimpleFIN', 'History from', 'Jun 1, 2026']) {
      expect(markup).toContain(fact)
    }
    expect(markup).toContain('Status')
    // The count shows once, on the import's progress, and the status reads plainly as importing
    expect(markup).toContain('style="opacity:1">Importing</span>')
    expect(markup).toContain('Importing from Jun 1, 2026')
    expect(markup).toContain('12 found · 1 of 2')
    expect(markup).toMatch(/role="progressbar"[^>]*aria-valuemax="2"[^>]*aria-valuenow="1"/)
    expect(getButton(markup, 'Unlink')).not.toBe('')
    expect(markup).not.toContain('Link bank account')
  })

  it('shows the failure when the link cannot load, rather than offering a link', () => {
    read.status = undefined
    read.statusError = new Error('Failed to fetch')
    const markup = renderSection()
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Bank link could not load')
    expect(markup).not.toContain('Link bank account')
  })

  it('leaves the import out of a live link with none running', () => {
    read.status = createStatus({ link: createLink() })
    const markup = renderSection()
    expect(markup).toContain('Linked')
    expect(markup).not.toContain('role="progressbar"')
  })
})
