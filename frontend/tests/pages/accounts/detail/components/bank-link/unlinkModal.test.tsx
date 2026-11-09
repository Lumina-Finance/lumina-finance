/**
 * Covers the Unlink dialogue's two choices: unlinking this account alone, keeping the connection for
 * the accounts still using it, or disconnecting the whole connection
 *
 * These tests catch the other accounts on the connection miscounted, including one waiting for its
 * bank account to be chosen again, the connection named by its provider rather than its nickname,
 * Disconnect offered before the connection has loaded or held back without a reason, the credential
 * connecting again needs named for another provider than the connection's, and the confirm button losing its danger
 * colour or its place before Cancel. Choosing and confirming run in the browser
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankConnection, BankProvidersResponse, ConnectionBankAccount } from '@/api/bank-sync'
import { UnlinkModal } from '@/pages/accounts/detail/components/bank-link/UnlinkModal'
import { createAccount, createConnection, createLink, createProviders } from './fixtures'

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/modal/Shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/modal/Shell')>()),
  ModalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
const providers = vi.hoisted(() => ({ current: undefined as BankProvidersResponse | undefined }))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useBankProviders: () => ({ data: providers.current }),
  useUnlinkBankAccount: () => ({ isPending: false, mutate: () => {} }),
  useDisconnectBankConnection: () => ({ isPending: false, mutate: () => {} }),
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: () => {} }) }))

function bankAccountLinkedTo(accountId: string | null, externalId: string): ConnectionBankAccount {
  return {
    external_id: externalId,
    name: externalId,
    institution_name: 'Harbour Bank',
    currency: 'CAD',
    custom_currency: false,
    linked_account_id: accountId,
    eligible_account_ids: [],
    signin_needed: false,
  }
}

function renderDialog(connection: BankConnection | undefined, connectionFailed = false): string {
  return renderToStaticMarkup(
    <UnlinkModal
      open
      account={createAccount()}
      link={createLink()}
      connection={connection}
      connectionFailed={connectionFailed}
      onClose={() => {}}
      onExitComplete={() => {}}
    />,
  )
}

function getRadio(markup: string, label: string): string {
  return (
    markup.match(
      new RegExp(`<button[^>]*role="radio"(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`, 's'),
    )?.[0] ?? ''
  )
}

describe('UnlinkModal', () => {
  it('names the bank account and starts on unlinking this account alone', () => {
    const markup = renderDialog(createConnection())
    expect(markup).toContain('Unlink bank account')
    expect(markup).toContain('Everyday Chequing at Harbour Bank')
    expect(getRadio(markup, 'Unlink this account')).toContain('aria-checked="true"')
    expect(getRadio(markup, 'Disconnect SimpleFIN')).toContain('aria-checked="false"')
    // The button holds the label it shows alone, so it is as wide as that label and no wider
    expect(markup).toMatch(/<button[^>]*app-danger-button[^>]*>Unlink<\/button>/)
  })

  it('keeps the connection ready for another link when no other account uses it', () => {
    const markup = renderDialog(createConnection({ accounts: [bankAccountLinkedTo('account-1', 'ACT-1')] }))
    expect(markup).toContain('The connection stays in Settings, ready for this or another account to link again.')
  })

  it('counts the other accounts on the connection, one waiting to choose again among them', () => {
    const markup = renderDialog(
      createConnection({
        nickname: 'Household',
        accounts: [
          bankAccountLinkedTo('account-1', 'ACT-1'),
          bankAccountLinkedTo('account-2', 'ACT-2'),
          bankAccountLinkedTo(null, 'ACT-3'),
        ],
        choose_again_links: [{ account_id: 'account-3', external_account_name: 'Savings' }],
      }),
    )
    expect(markup).toContain('The connection stays in Settings for the 2 other accounts using it.')
    expect(getRadio(markup, 'Disconnect Household')).not.toBe('')
  })

  it('names the provider and holds back Disconnect until the connection loads, saying so', () => {
    const disconnect = getRadio(renderDialog(undefined), 'Disconnect SimpleFIN')
    expect(disconnect).toContain('disabled=""')
    expect(disconnect).toContain('Loading this connection…')
  })

  it('says why Disconnect stays held when the connection could not load', () => {
    const disconnect = getRadio(renderDialog(undefined, true), 'Disconnect SimpleFIN')
    expect(disconnect).toContain('disabled=""')
    expect(disconnect).toContain('Couldn&#x27;t load this connection, so it can&#x27;t be disconnected right now.')
  })

  it("names the connection's own provider credential as what connecting again needs", () => {
    const simplefin = createProviders().providers[0]
    const keyed = {
      ...simplefin,
      id: 'keyed',
      name: 'Keyed',
      credential_fields: [{ key: 'api_key', label: 'API key', placeholder: 'Paste the key', max_length: 256 }],
    }
    providers.current = createProviders({ providers: [simplefin, keyed] })
    const markup = renderToStaticMarkup(
      <UnlinkModal
        open
        account={createAccount()}
        link={createLink({ provider: 'keyed', provider_name: 'Keyed', provider_site: 'Keyed' })}
        connection={createConnection({ provider: 'keyed', provider_name: 'Keyed', provider_site: 'Keyed' })}
        connectionFailed={false}
        onClose={() => {}}
        onExitComplete={() => {}}
      />,
    )
    providers.current = undefined

    expect(getRadio(markup, 'Disconnect Keyed')).toContain(
      'Unlinks every account on this connection and deletes the stored access. Connecting again needs a new API key.',
    )
    expect(markup).not.toContain('setup token')
  })

  it("says nothing of connecting again once the connection's provider is gone from the server", () => {
    providers.current = createProviders({ providers: [] })
    const disconnect = getRadio(renderDialog(createConnection()), 'Disconnect SimpleFIN')
    providers.current = undefined

    expect(disconnect).toContain('Unlinks every account on this connection and deletes the stored access.')
    expect(disconnect).not.toContain('Connecting again')
  })

  it('puts Unlink before Cancel, as every confirmation that changes records does', () => {
    expect(renderDialog(createConnection())).toMatch(/>Unlink<\/button>.*>Cancel<\/button>/s)
  })
})
