/**
 * Covers the Unlink dialogue: it unlinks this account alone, and points to Settings for disconnecting
 * the whole connection
 *
 * These tests catch a choice to disconnect coming back, the account or bank account named wrongly, the
 * connection named by its provider rather than its nickname, or before it loads by anything but its
 * provider, the line about disconnecting losing its link to Settings, and the confirm button losing its
 * danger colour or its place before Cancel. Confirming, closing and the link to Settings run in the browser
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankConnection } from '@/api/bank-sync'
import { UnlinkModal } from '@/pages/accounts/detail/components/bank-link/UnlinkModal'
import { createAccount, createConnection, createLink } from './fixtures'

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/modal/Shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/modal/Shell')>()),
  ModalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => () => {},
}))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useUnlinkBankAccount: () => ({ isPending: false, mutate: () => {} }),
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: () => {} }) }))

/** Static rendering escapes apostrophes and marks where one text node meets the next */
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
    .replaceAll('<!-- -->', '')
    .replaceAll('&#x27;', "'")
}

describe('UnlinkModal', () => {
  it('names the bank account, says new bank transactions stop coming in, and offers no choice to disconnect', () => {
    const markup = renderDialog(createConnection())
    expect(markup).toContain('Unlink bank account')
    expect(markup).toContain('Everyday Chequing at Harbour Bank')
    expect(markup).toContain('New transactions from the bank stop coming into Everyday.')
    expect(markup).not.toContain('role="radio"')
    expect(markup).not.toMatch(/>Disconnect</)
  })

  it.each([
    { connection: createConnection(), name: 'SimpleFIN' },
    { connection: createConnection({ nickname: 'Household' }), name: 'Household' },
    { connection: undefined, name: 'SimpleFIN' },
  ])('says $name is disconnected from every account in Settings, linking there', ({ connection, name }) => {
    expect(renderDialog(connection)).toMatch(
      new RegExp(
        `To disconnect ${name} from every account, please open the connection in <button[^>]*>Settings</button>\\.`,
      ),
    )
  })

  it('puts Unlink before Cancel in the danger colour, as every confirmation that changes records does', () => {
    const markup = renderDialog(createConnection())
    expect(markup).toMatch(/<button[^>]*app-danger-button[^>]*>Unlink<\/button>/)
    expect(markup).toMatch(/>Unlink<\/button>.*>Cancel<\/button>/s)
  })
})
