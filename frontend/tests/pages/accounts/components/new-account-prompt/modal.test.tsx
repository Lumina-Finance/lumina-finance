/**
 * Covers what the prompt after a new account asks: how the account stays up to date, linked to a
 * bank account or kept manual with a starting balance, and only the starting balance for a user the
 * deployment lets link nothing
 *
 * These tests catch linking offered to a user who fails the bank-linking check or on a deployment with
 * no provider, a group account, one with nothing to link to or one asked while bank sync isn't
 * set up left able to choose linking or without the reason, bank sync's reason without the link to
 * Settings, a group account sent to Settings for what it can't do there, a rejected connection counted as one
 * that can link, Keep it manual chosen by default
 * when linking is available, its starting balance shown before it is chosen, a liability's field not
 * asking for the amount owed, the connections read for a user who is offered no linking, and the prompt
 * opening before the bank reads settle. Choosing,
 * continuing and the balance's typing run in the browser
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { BankConnection, BankProvidersResponse } from '@/api/bank-sync'
import {
  BANK_CONNECTIONS_SETTINGS_PATH,
  BANK_SYNC_NOT_SET_UP_REASON,
  GROUP_ACCOUNT_LINK_REASON,
  NOTHING_TO_LINK_REASON,
} from '@/components/bank-link-flow/constants'
import NewAccountPromptModal from '@/pages/accounts/components/new-account-prompt/Modal'
import { formatCurrencySymbol } from '@/utils/formatCurrency'
import { createAccount, createConnection, createProviders } from './fixtures'

const reads = vi.hoisted(() => ({
  providers: undefined as BankProvidersResponse | undefined,
  providersPending: false,
  connections: undefined as BankConnection[] | undefined,
  connectionsPending: false,

  // Whether each render's connections read was allowed to run
  connectionReadsEnabled: [] as boolean[],
}))

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/modal/Shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/modal/Shell')>()),
  ModalShell: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useBankProviders: () => ({ data: reads.providers, isPending: reads.providersPending }),
  useBankConnections: (options?: { enabled?: boolean }) => {
    reads.connectionReadsEnabled.push(options?.enabled ?? true)
    return { data: reads.connections, isPending: reads.connectionsPending }
  },
}))
vi.mock('@/api/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/accounts')>()),
  useRecordStartingBalance: () => ({ isPending: false, mutate: () => {} }),
}))
vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: [
      { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
      // The seeded table's own symbol, which the field must not show in place of the reader's
      { id: 'CHF', name: 'Swiss Franc', symbol: 'Fr.', minor_unit_exponent: 2 },
    ],
  }),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => () => {},
}))

const LINK_DESCRIPTION = 'Choose one of the bank accounts on your connections.'

// Static rendering escapes apostrophes, so text is matched against the escaped form
function escaped(text: string): string {
  return text.replaceAll("'", '&#x27;')
}

function renderPrompt(account: AccountsOverview = createAccount()): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <NewAccountPromptModal open account={account} onClose={() => {}} onExitComplete={() => {}} />
    </MemoryRouter>,
  )
}

function getRadio(markup: string, label: string): string {
  return (
    markup.match(
      new RegExp(`<button[^>]*role="radio"(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`, 's'),
    )?.[0] ?? ''
  )
}

beforeEach(() => {
  reads.providers = createProviders()
  reads.providersPending = false
  reads.connections = [createConnection()]
  reads.connectionsPending = false
  reads.connectionReadsEnabled = []
})

describe('NewAccountPromptModal', () => {
  it('reads the connections only where linking is offered', () => {
    for (const providers of [createProviders({ mayLink: false }), { ...createProviders(), providers: [] }, undefined]) {
      reads.providers = providers
      reads.connectionReadsEnabled = []
      renderPrompt()
      expect(reads.connectionReadsEnabled).toEqual([false])
    }

    reads.providers = createProviders()
    reads.connectionReadsEnabled = []
    renderPrompt()
    expect(reads.connectionReadsEnabled).toEqual([true])
  })

  it('asks how the account stays up to date, with linking chosen and no starting balance yet', () => {
    const markup = renderPrompt()
    expect(markup).toContain('Keep it up to date')
    expect(markup).toContain('Everyday created')
    expect(getRadio(markup, 'Link a bank account')).toContain('aria-checked="true"')
    expect(getRadio(markup, 'Link a bank account')).toContain(LINK_DESCRIPTION)
    expect(getRadio(markup, 'Keep it manual')).toContain('aria-checked="false"')
    expect(getRadio(markup, 'Keep it manual')).toContain('You can link a bank later.')
    expect(markup).not.toContain('Starting balance')
    expect(markup).toContain('Decide later')
    expect(markup).toContain('Continue')
  })

  it('refuses linking a group account, keeping it manual with its starting balance', () => {
    const markup = renderPrompt(createAccount({ group_id: 'group-1' }))
    const link = getRadio(markup, 'Link a bank account')
    expect(link).toContain('disabled=""')
    expect(link).toContain(escaped(GROUP_ACCOUNT_LINK_REASON))
    expect(link).not.toContain(LINK_DESCRIPTION)
    expect(getRadio(markup, 'Keep it manual')).toContain('aria-checked="true"')
    expect(markup).toContain('Starting balance')
    expect(markup).toContain('Your starting balance is recorded as a balance adjustment dated today.')
  })

  it('refuses linking with no working connection while no provider is open to a new one', () => {
    reads.providers = createProviders({ offered: false })
    reads.connections = [createConnection({ status: 'credential_rejected' })]
    const link = getRadio(renderPrompt(), 'Link a bank account')
    expect(link).toContain('disabled=""')
    expect(link).toContain(NOTHING_TO_LINK_REASON)
  })

  it("refuses linking while bank sync isn't set up, linking to Settings and keeping it manual with its starting balance", () => {
    reads.providers = { ...createProviders(), sync_running: false }
    const markup = renderPrompt()
    const link = getRadio(markup, 'Link a bank account')
    expect(link).toContain('disabled=""')
    expect(link).toContain(escaped(BANK_SYNC_NOT_SET_UP_REASON))
    expect(markup).toContain(`href="${BANK_CONNECTIONS_SETTINGS_PATH}"`)
    expect(markup).toContain('Open bank connections')
    expect(getRadio(markup, 'Keep it manual')).toContain('aria-checked="true"')
    expect(markup).toContain('Starting balance')
  })

  it("refuses linking a group account for being one while bank sync isn't set up too, with no link to Settings", () => {
    reads.providers = { ...createProviders(), sync_running: false }
    const markup = renderPrompt(createAccount({ group_id: 'group-1' }))
    expect(getRadio(markup, 'Link a bank account')).toContain(escaped(GROUP_ACCOUNT_LINK_REASON))
    expect(markup).not.toContain('Open bank connections')
  })

  it('offers linking through a working connection after its provider stops taking new ones', () => {
    reads.providers = createProviders({ offered: false })
    expect(getRadio(renderPrompt(), 'Link a bank account')).not.toContain('disabled=""')
  })

  it('offers linking with no connection yet while a provider is open to one', () => {
    reads.connections = []
    expect(getRadio(renderPrompt(), 'Link a bank account')).toContain('aria-checked="true"')
  })

  it('asks only for the starting balance where the user may link nothing', () => {
    for (const providers of [createProviders({ mayLink: false }), { ...createProviders(), providers: [] }]) {
      reads.providers = providers
      const markup = renderPrompt()
      expect(markup).toContain('Add a starting balance')
      expect(markup).not.toContain('Keep it up to date')
      expect(markup).not.toContain('role="radio"')
      expect(markup).toContain('Starting balance')
      expect(markup).toContain('Skip')
    }
  })

  it('asks a liability for the amount owed', () => {
    reads.providers = createProviders({ mayLink: false })
    expect(renderPrompt(createAccount({ account_kind: 'revolving' }))).toContain('Starting amount owed')
  })

  it('writes the starting balance symbol as the rest of the app does, with room for a longer one', () => {
    reads.providers = createProviders({ mayLink: false })
    const markup = renderPrompt(createAccount({ currency: 'CHF' }))
    const symbol = formatCurrencySymbol('CHF')
    expect(symbol).not.toBe('Fr.')
    expect(markup).toContain(`aria-hidden="true">${symbol}</span>`)
    expect(markup).not.toContain('>Fr.</span>')
    const input = markup.match(/<input[^>]*id="new-account-starting-balance"[^>]*>/)?.[0] ?? ''
    expect(input).toMatch(/style="padding-left:[^"]+"/)
  })

  it('opens without waiting on the connections where linking is not offered', () => {
    reads.providers = createProviders({ mayLink: false })
    reads.connectionsPending = true
    expect(renderPrompt()).toContain('Add a starting balance')
  })

  it('waits for the bank reads before opening', () => {
    reads.providersPending = true
    expect(renderPrompt()).toBe('')

    reads.providersPending = false
    reads.connectionsPending = true
    expect(renderPrompt()).toBe('')
  })
})
