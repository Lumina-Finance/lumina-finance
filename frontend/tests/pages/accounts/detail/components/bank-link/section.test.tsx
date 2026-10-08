/**
 * Covers what the edit modal's Bank link section shows for each kind of account: a group account
 * kept manual, an account never linked, one linked before, an archived one, and a live link with
 * its facts, status, import and the notice for whatever holds its sync back
 *
 * These tests catch a group account offered a link, the previous link's bank account, provider or
 * date dropped from the relink text, the relink button worded as a first link, an archived account
 * or a paused worker leaving the button live, a failed read offering a link as if there were none,
 * a linked view missing a fact, its status or the running import, an import shown while a retry or a
 * stop holds it or dropped before it shows as done, a notice missing, worded unlike the issue, or shown for a link it doesn't apply to,
 * a notice's action losing focus to the link's own actions when the modal opens at the bank link,
 * the opening adjustment offer missing from the balance panel's foot or shown with nothing offered,
 * Sync now left live for something the server refuses or without the reason, a reason of two
 * sentences ending without the full stop the others of two have, held back by a bank
 * sign-in, left greyed once its requests free up, spinning while the worker is down, or dropping the
 * focus it holds or the width it measures while the sync starts. Opening the flow, the tooltip,
 * unlinking and pressing Sync now run in the browser
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/api/accounts'
import type { AccountBankStatus, BankConnection, BankProvidersResponse } from '@/api/bank-sync'
import { GROUP_ACCOUNT_LINK_REASON, LINKING_PAUSED_REASON } from '@/components/bank-link-flow/constants'
import type { ActionFeedbackStatus } from '@/components/feedback/ActionButton'
import { BankLinkSection } from '@/pages/accounts/detail/components/bank-link/Section'
import { describeBankSync } from '@/pages/accounts/detail/components/bank-link/status'
import { SYNC_PAUSED_REASON } from '@/pages/accounts/detail/components/bank-link/syncNow'
import {
  createAccount,
  createConnection,
  createImport,
  createLink,
  createPreviousLink,
  createProviders,
  createStatus,
  createSync,
} from './fixtures'

const read = vi.hoisted(() => ({
  ownPersonal: true,
  status: undefined as AccountBankStatus | undefined,
  statusError: null as Error | null,
  providers: undefined as BankProvidersResponse | undefined,
  connections: [] as BankConnection[],
  syncFeedback: 'idle' as ActionFeedbackStatus,
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
  useBankConnections: () => ({ data: read.connections }),
  useSyncBankAccount: () => ({ mutateAsync: vi.fn() }),
  useRecordOpeningAdjustment: () => ({ isPending: false, mutate: vi.fn() }),
  useSkipOpeningAdjustment: () => ({ isPending: false, mutate: vi.fn() }),
}))
vi.mock('@/hooks/useMoneyFormatters', async () => {
  const { formatCurrency, formatMovedAmount } = await import('@/utils/formatCurrency')
  const currencies = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }]
  return {
    useMoneyFormatters: () => ({
      currencies,
      formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, currencies),
      formatMovedAmount: (amount: number, currency: string) => formatMovedAmount(amount, currency, currencies),
    }),
  }
})
vi.mock('@/hooks/useCurrencyListState', () => ({ useCurrencyListState: () => 'ready' }))
vi.mock('@/components/currency/CurrencyUnavailableTooltip', () => ({ CurrencyUnavailableTooltip: () => null }))
vi.mock('@/hooks/useActionFeedback', () => ({
  useActionFeedback: () => ({ status: read.syncFeedback, isPending: read.syncFeedback !== 'idle', run: vi.fn() }),
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', tz: 'America/Toronto' }, accessToken: 'token' }),
}))
vi.mock('@/components/bank-link-flow/Modal', () => ({ BankLinkFlowModal: () => null }))
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
}))

// The notices name what each state stops or waits on
const RECONNECT_NOTICE = 'SimpleFIN Bridge rejected the connection this account uses. Automatic sync is stopped for every account on it until you reconnect it in Settings with a new setup token.'
const CHOOSE_NOTICE = "SimpleFIN now lists Everyday Chequing differently, so Lumina Finance can't tell whether it's the same account. Choose its bank account again to resume syncing."
const SIGN_IN_NOTICE = 'Sign in to your bank again in SimpleFIN Bridge.'
const PAUSED_NOTICE = 'Sync is paused with 105 new items waiting for review. It resumes on its own once 50 or fewer are left.'
const WARNING_NOTICE = '85 new to review. Sync pauses at 100.'
const NOTICES = [RECONNECT_NOTICE, CHOOSE_NOTICE, SIGN_IN_NOTICE, PAUSED_NOTICE, WARNING_NOTICE]

// Static rendering escapes apostrophes, so text is matched against the escaped form
function escaped(text: string): string {
  return text.replaceAll("'", '&#x27;')
}

// Static rendering marks where one text node meets the next, which text is matched without
function renderSection(account: Account = createAccount()): string {
  return renderToStaticMarkup(<BankLinkSection account={account} sectionNumber="03" />).replaceAll('<!-- -->', '')
}

function getButton(markup: string, label: string): string {
  return markup.match(new RegExp(`<button(?:(?!</button>).)*${label}</button>`, 's'))?.[0] ?? ''
}

// Sync now's label sits inside its feedback wrapper, beside the copy it measures its width by, and
// gives way to a spinner or a tick, which are labelled instead
function getSyncNowButton(markup: string): string {
  return markup.match(/<button(?:(?!<\/button>).)*(?:Sync now|aria-label="Starting sync"|aria-label="Sync started")(?:(?!<\/button>).)*<\/button>/s)?.[0] ?? ''
}

// Synced an hour ago and due again in three hours, which is what Sync now normally meets
function linkSynced(sync = createSync()): AccountBankStatus {
  return createStatus({ link: createLink({ state: sync.state === 'choose_account' ? 'choose_account' : 'active', sync }) })
}

beforeEach(() => {
  // Noon in Toronto, the clock the link fixtures are set against
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T16:00:00Z'))
  read.ownPersonal = true
  read.status = createStatus()
  read.statusError = null
  read.providers = createProviders()
  read.connections = [createConnection()]
  read.syncFeedback = 'idle'
})

afterEach(() => {
  vi.useRealTimers()
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
    // Archiving lasts, so its reason sits beside the button as the button's description
    const archived = renderSection(createAccount({ is_archived: true }))
    const archivedButton = getButton(archived, 'Link bank account')
    expect(archivedButton).toContain('aria-disabled="true"')
    const reasonId = archivedButton.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(archived).toContain(`<p id="${reasonId}" class="text-sm" style="color:var(--app-text-muted)">Archived accounts are read-only</p>`)

    read.providers = createProviders({ sync_running: false })
    const paused = renderSection()
    expect(getButton(paused, 'Link bank account')).toContain('aria-disabled="true"')
    expect(paused).toContain(escaped(LINKING_PAUSED_REASON))
  })

  it('marks its control for the modal to focus only when the modal opens at the bank link', () => {
    const atBankLink = renderToStaticMarkup(<BankLinkSection account={createAccount()} sectionNumber="03" autoFocus />)
    expect(getButton(atBankLink, 'Link bank account')).toContain('data-modal-initial-focus="true"')
    expect(getButton(renderSection(), 'Link bank account')).not.toContain('data-modal-initial-focus')
  })

  it('shows a live link with its facts, its status, the running import and a way to unlink', () => {
    read.status = createStatus({ link: createLink({ import: createImport(), sync: createSync({ state: 'importing', last_success_at: null }) }) })
    const markup = renderSection()
    for (const fact of ['Bank account', 'Everyday Chequing', 'Institution', 'Harbour Bank', 'Through', 'SimpleFIN', 'History from', 'Jun 1, 2026']) {
      expect(markup).toContain(fact)
    }
    expect(markup).toContain('Status')
    expect(markup).toContain('Importing · 1 of 2</span>')
    expect(markup).toContain('Importing from Jun 1, 2026')
    expect(markup).toContain('12 found · 1 of 2')
    expect(markup).toMatch(/role="progressbar"[^>]*aria-valuemax="2"[^>]*aria-valuenow="1"/)
    expect(getButton(markup, 'Unlink')).not.toBe('')
    expect(markup).not.toContain('Link bank account')
  })

  it('offers the opening adjustment at the foot of the balance panel only while there is one', () => {
    const balance = {
      amount: 125000,
      available: null,
      available_unreadable: false,
      balance_date: '2026-10-03T22:00:00Z',
      ledger_balance: 100000,
      difference: -25000,
    }
    const link = createLink({ sync: createSync({ state: 'opening_balance' }) })
    read.status = createStatus({ link, balance, opening_adjustment: { amount: 25000, adjustment_date: '2026-05-31' } })
    const markup = renderSection(createAccount({ current_balance: 100000 }))

    expect(markup).toContain('Opening balance to confirm')
    expect(markup).toMatch(/As of .*Record the difference as an opening adjustment on May 31, 2026, so your ledger starts at SimpleFIN&#x27;s balance\./s)

    // Skipped, the gap stays and the status no longer asks for the opening balance
    read.status = createStatus({ link: createLink({ sync: createSync({ state: 'synced' }) }), balance, opening_adjustment: null })
    expect(renderSection()).not.toContain('Record the difference')
  })

  it('shows the failure when the link cannot load, rather than offering a link', () => {
    read.status = undefined
    read.statusError = new Error('Failed to fetch')
    const markup = renderSection()
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Bank link could not load')
    expect(markup).not.toContain('Link bank account')
  })

  it('leaves the import and every notice out of a synced link', () => {
    read.status = createStatus({ link: createLink() })
    const markup = renderSection()
    expect(markup).toContain('Synced 1 hour ago</span>')
    expect(markup).not.toContain('role="progressbar"')
    for (const notice of NOTICES) expect(markup).not.toContain(escaped(notice))
  })

  it.each([
    ['a rejected connection, with a way to Settings', createSync({ state: 'reconnect_needed' }), RECONNECT_NOTICE, 'Open settings'],
    ['a bank account to choose again, with a way to choose it', createSync({ state: 'choose_account' }), CHOOSE_NOTICE, 'Choose bank account'],
    ['a bank asking for its sign-in again', createSync({ state: 'bank_signin_needed' }), SIGN_IN_NOTICE, null],
    ['a sync paused for review', createSync({ state: 'paused', paused: true, waiting_new_count: 105 }), PAUSED_NOTICE, null],
    ['a review backlog nearing the pause', createSync({ state: 'review_warning', review_warning: true, waiting_new_count: 85 }), WARNING_NOTICE, null],
  ])('shows one notice for %s', (_, sync, notice, action) => {
    read.status = createStatus({ link: createLink({ state: sync.state === 'choose_account' ? 'choose_account' : 'active', sync }) })
    const markup = renderSection()
    for (const other of NOTICES) expect(markup.includes(escaped(other))).toBe(other === notice)
    if (action) expect(getButton(markup, action)).toContain('data-bank-link-action="true"')
  })

  it('shows the import while it waits on the request budget, as while it runs', () => {
    read.status = createStatus({
      link: createLink({ import: createImport({ state: 'waiting_on_budget' }), sync: createSync({ state: 'import_waiting_on_budget' }) }),
    })
    expect(renderSection()).toContain('role="progressbar"')
  })

  it('holds a finished import as done once the status has moved on to synced', () => {
    read.status = createStatus({ link: createLink({ import: createImport({ state: 'complete', windows_done: 2 }), sync: createSync() }) })
    const markup = renderSection()
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('Imported from Jun 1, 2026')
  })

  // The import keeps its progress for when it goes on, but saying it is importing would contradict the status
  it.each([
    ['a retry', createSync({ state: 'retrying', last_failure: { at: '2026-10-05T15:50:00Z', reason: "SimpleFIN Bridge couldn't be reached" } })],
    ['a rejected connection', createSync({ state: 'reconnect_needed', next_attempt_at: null })],
    ['a bank asking for its sign-in again', createSync({ state: 'bank_signin_needed' })],
  ])('leaves out an import that %s holds', (_, sync) => {
    read.status = createStatus({ link: createLink({ import: createImport({ state: 'waiting' }), sync }) })
    const markup = renderSection()
    expect(markup).not.toContain('role="progressbar"')
    expect(markup).not.toContain('Importing from Jun 1, 2026')
  })

  it('keeps the review notices through a sync, since they follow the backlog rather than the state', () => {
    read.status = createStatus({ link: createLink({ sync: createSync({ state: 'syncing', review_warning: true, waiting_new_count: 85 }) }) })
    expect(renderSection()).toContain(WARNING_NOTICE)
  })

  it.each([
    [
      "a notice's action ahead of the link's own actions, passing over Sync now while the notice holds it",
      createStatus({ link: createLink({ state: 'choose_account', sync: createSync({ state: 'choose_account' }) }) }),
      ['Choose bank account', 'Unlink'],
    ],
    ['Sync now ahead of Unlink while a sync can run', linkSynced(), ['Sync now', 'Unlink']],
    [
      'Unlink alone while the import holds Sync now, since focus would open the reason over the section',
      createStatus({ link: createLink({ import: createImport(), sync: createSync({ state: 'importing', last_success_at: null }) }) }),
      ['Unlink'],
    ],
  ])('marks for the modal to focus %s', (_, status, expected) => {
    read.status = status
    const markup = renderToStaticMarkup(<BankLinkSection account={createAccount()} sectionNumber="03" autoFocus />)
    const marked = [
      ...markup.matchAll(/<button[^>]*data-modal-initial-focus="true"[^>]*>(?:(?!<\/button>).)*?([A-Z][a-z]+(?: [a-z]+)*)(?:<\/span>)*<\/button>/gs),
    ]
    expect(marked.map((match) => match[1])).toEqual(expected)
  })

  it.each([
    [
      // A worker fetching the import's next part runs a sync too, which the import's own reason outranks
      'an import runs',
      createStatus({
        link: createLink({ import: createImport(), sync: createSync({ state: 'importing', last_success_at: null, sync_running: true }) }),
      }),
      'The import is still running',
    ],
    ['a sync runs', linkSynced(createSync({ state: 'syncing', sync_running: true })), 'A sync is already running'],
    [
      'a sync runs under a bank sign-in, which shows over it, since a second sync would spend another request',
      linkSynced(createSync({ state: 'bank_signin_needed', sync_running: true })),
      'A sync is already running',
    ],
    ['the connection needs reconnecting', linkSynced(createSync({ state: 'reconnect_needed' })), 'Reconnect SimpleFIN in Settings before syncing'],
    ['the bank account has to be chosen again', linkSynced(createSync({ state: 'choose_account' })), 'Choose the bank account again before syncing'],
    [
      'the review pause holds the sync',
      linkSynced(createSync({ state: 'paused', paused: true, waiting_new_count: 105 })),
      'Syncing is paused until 50 or fewer new items are waiting for review',
    ],
  ])('disables Sync now while %s, saying why', (_, status, reason) => {
    read.status = status
    const markup = renderSection()
    expect(getSyncNowButton(markup)).toContain('aria-disabled="true"')
    expect(markup).toContain(escaped(reason))
  })

  it('disables Sync now while the connection has spent its requests, saying when more are available', () => {
    read.status = linkSynced()
    read.connections = [createConnection({ request_budget: { limit: 20, used: 20, available_again_at: '2026-10-05T19:00:00Z' } })]
    const markup = renderSection()
    expect(getSyncNowButton(markup)).toContain('aria-disabled="true"')
    expect(markup).toContain(escaped("This connection has used today's 20 SimpleFIN requests. More are available in 3 hours."))
  })

  it('offers Sync now again once the spent requests free up, though the connection still reads as spent', () => {
    read.status = linkSynced()
    read.connections = [createConnection({ request_budget: { limit: 20, used: 20, available_again_at: '2026-10-05T16:05:00Z' } })]
    expect(renderSection()).toContain(escaped("This connection has used today's 20 SimpleFIN requests. More are available in 5 minutes."))

    vi.setSystemTime(new Date('2026-10-05T16:05:00Z'))
    const markup = renderSection()

    expect(getSyncNowButton(markup)).not.toContain('aria-disabled')
    expect(markup).not.toContain('More are available')
  })

  it.each([
    ['idle', 'nothing asked for', createSync()],
    ['idle', 'a sync asked for in any window, which nothing starts until the worker is back', createSync({ sync_requested: true })],
    ['loading', 'this window waiting for the worker to start the sync', createSync({ sync_requested: true })],
  ] as const)('disables Sync now while the sync worker is down, with %s feedback and %s, saying why', (feedback, _, sync) => {
    read.syncFeedback = feedback
    read.status = linkSynced(sync)
    read.providers = createProviders({ sync_running: false })
    const markup = renderSection()
    expect(getSyncNowButton(markup)).toContain('aria-disabled="true"')
    expect(getSyncNowButton(markup)).not.toContain('aria-label="Starting sync"')
    expect(markup).toContain(escaped(SYNC_PAUSED_REASON))
  })

  it.each([
    ['a synced link', createSync()],
    ['a bank asking for its sign-in again, so the user can check straight after signing in', createSync({ state: 'bank_signin_needed' })],
  ])('offers Sync now on %s', (_, sync) => {
    read.status = linkSynced(sync)
    const button = getSyncNowButton(renderSection())
    expect(button).toContain('Sync now')
    expect(button).not.toContain('aria-disabled')
  })

  it.each([
    ['until a worker starts a sync asked for in any window', 'idle', createSync({ sync_requested: true }), 'Starting sync'],
    ['while this window waits for the worker', 'loading', createSync({ sync_requested: true }), 'Starting sync'],
    ['once the worker has started it', 'success', createSync({ state: 'syncing', sync_running: true }), 'Sync started'],
  ] as const)('reads %s as the sync starting, keeping focus and the width of its label', (_, feedback, sync, label) => {
    read.syncFeedback = feedback
    read.status = linkSynced(sync)
    const button = getSyncNowButton(renderSection())
    expect(button).toContain(`aria-label="${label}"`)
    expect(button).toContain(`aria-busy="${feedback !== 'success'}"`)
    expect(button).not.toMatch(/ (aria-)?disabled/)

    // The hidden label the width is measured from, kept for a button the modal opens while the sync starts
    expect(button).toMatch(/<span[^>]* aria-hidden="true"[^>]*>(?:(?!<\/button>).)*Sync now/s)
  })
})
