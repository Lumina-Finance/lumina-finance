/**
 * Covers what the link flow's bank account step lists: each bank account with its balance and
 * institution, the server's reason on one that can't be linked, the institution warning, the
 * connection dropdown, and how a relink and a choice made again point back to the old bank account
 *
 * These tests catch an unavailable bank account hidden or offered as linkable, its reason reworded
 * or not shown in the danger colour, a balance written in a currency the provider made up, the
 * dropdown shown for a single connection, and the callout or the like-before notes missing or
 * swapped between a relink and a choice made again. Choosing, switching connections and continuing
 * run in the browser
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveredBankAccount } from '@/api/bank-sync'
import { BankAccountStep } from '@/components/bank-link-flow/BankAccountStep'
import type { LinkFlowMode, PreviousBankAccount } from '@/components/bank-link-flow/wording'
import { formatCurrency } from '@/utils/formatCurrency'
import { TEST_CURRENCIES, createAccount, createBankAccount, createConnection } from './fixtures'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: TEST_CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, TEST_CURRENCIES),
  }),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', tz: 'America/Toronto' }, accessToken: 'token' }),
}))

const PREVIOUS: PreviousBankAccount = {
  externalAccountId: 'ACT-1',
  name: 'Everyday Chequing',
  institution: 'Harbour Bank',
  providerName: 'SimpleFIN',
}

function renderStep({
  accounts = [createBankAccount()],
  connections = [createConnection()],
  mode = 'link',
  previous = null,
}: {
  accounts?: DiscoveredBankAccount[]
  connections?: ReturnType<typeof createConnection>[]
  mode?: LinkFlowMode
  previous?: PreviousBankAccount | null
} = {}): string {
  return renderToStaticMarkup(
    <BankAccountStep
      account={createAccount()}
      mode={mode}
      previous={previous}
      connections={connections}
      connection={connections[0]}
      onConnectionChange={() => {}}
      discovered={{ discovery_pending: false, accounts }}
      discoveredError={null}
      chosenId={null}
      onChoose={() => {}}
      disabled={false}
      onOpenSettings={() => {}}
    />,
  )
}

/** The markup of the one choice card naming this bank account */
function cardFor(markup: string, name: string): string {
  const cards = markup.split('role="radio"').slice(1).filter((card) => card.includes(`>${name}<`))
  expect(cards).toHaveLength(1)
  return cards[0]
}

describe('the bank account step', () => {
  it('lists each bank account with its balance and institution, and none chosen', () => {
    const markup = renderStep()

    const card = cardFor(markup, 'Everyday Chequing')
    expect(card).toContain('$1,250.00')
    expect(card).toContain('Harbour Bank')
    expect(markup).not.toContain('aria-checked="true"')
    expect(markup).toContain('Missing a bank account? Add it in SimpleFIN Bridge, or add another connection in')
  })

  it("lists a bank account that can't be linked as unavailable, with the server's reason in the danger colour", () => {
    const markup = renderStep({
      accounts: [
        createBankAccount({ external_id: 'ACT-2', name: 'Travel Card', currency: 'USD', linkable: false, unavailable_reason: 'currency_mismatch', unavailable_message: 'In USD, but Everyday is in CAD' }),
        createBankAccount({ external_id: 'ACT-3', name: 'Points', currency: 'https://example.com/points', balance: 900, linkable: false, unavailable_reason: 'custom_currency', unavailable_message: "Uses a currency of its own, which Lumina Finance can't track" }),
      ],
    })

    const travel = cardFor(markup, 'Travel Card')
    expect(travel).toMatch(/disabled=""/)
    expect(travel).toContain('color:var(--app-negative)">In USD, but Everyday is in CAD<')
    const points = cardFor(markup, 'Points')
    expect(points).toMatch(/disabled=""/)
    expect(points).not.toContain('9.00')
    expect(points).toContain('Uses a currency of its own, which Lumina Finance can&#x27;t track')
  })

  it('warns, in the warning colour, when the institution differs from the one on the account', () => {
    const markup = renderStep({ accounts: [createBankAccount({ institution_differs: true })] })

    expect(cardFor(markup, 'Everyday Chequing')).toContain(
      'color:var(--app-warning-text)">The institution differs from the one on Everyday. That can be normal for a card issued through another bank.<',
    )
  })

  it('offers a choice of connection only when there is more than one', () => {
    expect(renderStep()).not.toContain('>Connection<')
    expect(renderStep({ connections: [createConnection(), createConnection({ id: 'connection-2', nickname: 'Joint banks' })] }))
      .toContain('>Connection<')
  })

  it('names the bank account unlinked before, and marks the same account and one under the same name', () => {
    const markup = renderStep({
      mode: 'relink',
      previous: PREVIOUS,
      accounts: [createBankAccount(), createBankAccount({ external_id: 'ACT-9' })],
    })

    expect(markup).toContain(
      'Previously linked to Everyday Chequing at Harbour Bank. After a reconnect, SimpleFIN can list the same bank account differently, so check the name and balance before continuing.',
    )
    expect(markup).toContain('Harbour Bank · Same account as before')
    expect(markup).toContain('Harbour Bank · Same name as before')
  })

  it('names the bank account the provider now lists differently when choosing it again', () => {
    const markup = renderStep({ mode: 'choose_again', previous: PREVIOUS, accounts: [createBankAccount({ external_id: 'ACT-9' })] })

    expect(markup).toContain(
      'SimpleFIN now lists Everyday Chequing at Harbour Bank differently. Check the name and balance, then choose the bank account Everyday should follow.',
    )
    expect(markup).not.toContain('Previously linked to')
  })
})
