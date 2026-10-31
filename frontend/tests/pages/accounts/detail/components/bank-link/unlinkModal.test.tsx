/**
 * Covers the Unlink dialog's two choices: unlinking this account alone, keeping the connection for
 * the accounts still using it, or disconnecting the whole connection
 *
 * These tests catch the other accounts on the connection miscounted, including one waiting for its
 * bank account to be chosen again, the connection named by its provider rather than its nickname,
 * Disconnect offered before the connection has loaded, and the confirm button losing its danger
 * colour or its place before Cancel. Choosing and confirming run in the browser
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankConnection, ConnectionBankAccount } from '@/api/bank-sync'
import { UnlinkModal } from '@/pages/accounts/detail/components/bank-link/UnlinkModal'
import { createAccount, createConnection, createLink } from './fixtures'

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/modal/Shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/modal/Shell')>()),
  ModalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
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

function renderDialog(connection: BankConnection | undefined): string {
  return renderToStaticMarkup(
    <UnlinkModal
      open
      account={createAccount()}
      link={createLink()}
      connection={connection}
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
    expect(markup).toMatch(/<button[^>]*app-danger-button[^>]*>(?:(?!<\/button>).)*opacity:1[^>]*>Unlink<\/span>/s)
    expect(markup).toMatch(/opacity:0[^>]*>Disconnect<\/span><\/button>/)
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

  it('names the provider and holds back Disconnect until the connection loads', () => {
    const markup = renderDialog(undefined)
    expect(getRadio(markup, 'Disconnect SimpleFIN')).toContain('disabled=""')
  })

  it('puts Unlink before Cancel, as every confirmation that changes records does', () => {
    expect(renderDialog(createConnection())).toMatch(
      />Unlink<\/span><span[^>]*>Disconnect<\/span><\/button>.*>Cancel<\/button>/s,
    )
  })
})
