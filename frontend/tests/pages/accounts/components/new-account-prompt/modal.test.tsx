/**
 * Covers what the prompt after a new account asks: how the account stays up to date, linked to a
 * bank account or kept manual with a starting balance, and only the starting balance for a user the
 * deployment lets link nothing
 *
 * These tests catch linking offered to a user who fails the bank-linking check or on a deployment with
 * no provider, a group account, one with nothing to link to or one asked while bank sync isn't
 * running left able to choose linking or without the reason, a group account told it can link once
 * bank sync is back, a rejected connection counted as one
 * that can link, Keep it manual chosen by default
 * when linking is available, its starting balance shown before it is chosen, a liability's field not
 * asking for the amount owed, and the prompt opening before the bank reads settle. Choosing,
 * continuing and the balance's typing run in the browser
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { BankConnection, BankProvidersResponse } from '@/api/bank-sync'
import {
  GROUP_ACCOUNT_LINK_REASON,
  LINKING_PAUSED_REASON,
  NOTHING_TO_LINK_REASON,
} from '@/components/bank-link-flow/constants'
import NewAccountPromptModal from '@/pages/accounts/components/new-account-prompt/Modal'
import { createAccount, createConnection, createProviders } from './fixtures'

const reads = vi.hoisted(() => ({
  providers: undefined as BankProvidersResponse | undefined,
  providersPending: false,
  connections: undefined as BankConnection[] | undefined,
  connectionsPending: false,
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
  useBankConnections: () => ({ data: reads.connections, isPending: reads.connectionsPending }),
}))
vi.mock('@/api/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/accounts')>()),
  useRecordStartingBalance: () => ({ isPending: false, mutate: () => {} }),
}))
vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }],
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
    <NewAccountPromptModal open account={account} onClose={() => {}} onExitComplete={() => {}} />,
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
})

describe('NewAccountPromptModal', () => {
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

  it('refuses linking while bank sync is not running, keeping it manual with its starting balance', () => {
    reads.providers = { ...createProviders(), sync_running: false }
    const markup = renderPrompt()
    const link = getRadio(markup, 'Link a bank account')
    expect(link).toContain('disabled=""')
    expect(link).toContain(escaped(LINKING_PAUSED_REASON))
    expect(getRadio(markup, 'Keep it manual')).toContain('aria-checked="true"')
    expect(markup).toContain('Starting balance')
  })

  it('refuses linking a group account for being one while bank sync is not running too', () => {
    reads.providers = { ...createProviders(), sync_running: false }
    expect(getRadio(renderPrompt(createAccount({ group_id: 'group-1' })), 'Link a bank account')).toContain(
      escaped(GROUP_ACCOUNT_LINK_REASON),
    )
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
