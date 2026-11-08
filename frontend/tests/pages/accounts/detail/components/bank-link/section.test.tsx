/**
 * Covers what the edit modal's Bank link section shows for each kind of account: a group account
 * kept manual, an account never linked, one linked before, an archived one, and a live link with
 * its facts, status, import and the notice for whatever holds its sync back
 *
 * These tests catch a group account offered a link, the previous link's bank account, provider or
 * date dropped from the relink text, the relink button worded as a first link, an archived account
 * or bank sync not being set up leaving the button live or its reason without the link to Settings, a failed read offering a link as if there were none,
 * a linked view missing a fact, its status, Review settings or the running import, Review settings
 * offered on an account with no link, an import shown while a retry or a
 * stop holds it or dropped before it shows as done, a notice missing, worded unlike the issue, or shown for a link it doesn't apply to,
 * a notice's action losing focus to the link's own actions when the modal opens at the bank link,
 * the opening adjustment offer missing from the balance panel's foot or shown with nothing offered,
 * a history or cut-off day reminder missing, worded wrongly for what came back, holding the offer back, or
 * taking the focus the modal gives the link's actions,
 * Sync now left live for something the server refuses or without the reason, a spent budget blamed
 * on the wrong request limit, a reason of two
 * sentences ending without the full stop the others of two have, held back by a bank
 * sign-in, left greyed once its requests free up, spinning while bank sync isn't set up, even for this
 * window's press, held back by the sync its own press started rather than reading Sync started, or
 * dropping the focus it holds or the width it measures while the sync starts. Opening the flow, the tooltip,
 * the review settings, unlinking, pressing Sync now and dismissing a reminder run in the browser
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/api/accounts'
import type { AccountBankStatus, BankConnection, BankProvidersResponse } from '@/api/bank-sync'
import { bankSyncKeys, currencyKeys } from '@/api/cache/queryKeys'
import type { Currency } from '@/api/currency'
import {
  BANK_CONNECTIONS_SETTINGS_PATH,
  BANK_SYNC_NOT_SET_UP_REASON,
  GROUP_ACCOUNT_LINK_REASON,
} from '@/components/bank-link-flow/constants'
import { AuthContext, type AuthContextValue } from '@/contexts/AuthContext'
import { ToastContext, type ToastValue } from '@/contexts/ToastContext'
import { BankLinkSection } from '@/pages/accounts/detail/components/bank-link/Section'
import { describeSyncNow } from '@/pages/accounts/detail/components/bank-link/syncNow'
import { PROVIDER_UNAVAILABLE_DETAIL } from '@/utils/bankSync'
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

// The section renders from what the cache holds, so a request sent while rendering fails the test
// rather than reaching the network
// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  authenticatedFetch: vi.fn(() => Promise.reject(new Error('The section sent a request while rendering'))),
}))

// Closed throughout, and their shell reads the open modals through a store that has no server
// snapshot, so a static render can't read them
vi.mock('@/components/bank-link-flow/Modal', () => ({ BankLinkFlowModal: () => null }))
vi.mock('@/pages/accounts/detail/components/bank-link/ReviewSettingsModal', () => ({ ReviewSettingsModal: () => null }))

// User-1, with its own personal account built by the fixtures
const AUTH: AuthContextValue = {
  user: {
    id: 'user-1',
    email: 'user-1@example.com',
    first_name: 'Ada',
    last_name: null,
    tz: 'America/Toronto',
    base_currency: 'CAD',
    date_format: 'month-day-year',
    created_at: '2026-09-01T12:00:00Z',
    second_factor_reenrollment_required: false,
  },
  accessToken: 'token',
  loading: false,
  login: vi.fn(),
  verifyMfa: vi.fn(),
  signup: vi.fn(),
  confirmSignup: vi.fn(),
  setSession: vi.fn(),
  primeAccessToken: vi.fn(),
  setUser: vi.fn(),
  logout: vi.fn(),
}
const TOAST: ToastValue = { showToast: vi.fn(), dismissToast: vi.fn() }
const CURRENCIES: Currency[] = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }]

// What the cache holds for the section to read, put there before each render
const read = {
  status: undefined as AccountBankStatus | undefined,
  statusError: null as Error | null,
  providers: undefined as BankProvidersResponse | undefined,
  connections: [] as BankConnection[],
}

// The notices name what each state stops or waits on
const RECONNECT_NOTICE =
  'SimpleFIN Bridge rejected the connection this account uses. Automatic sync is stopped for every account on it until you reconnect it in Settings.'
const CHOOSE_NOTICE =
  "SimpleFIN now lists Everyday Chequing differently, so Lumina Finance can't tell whether it's the same account. Choose its bank account again to resume syncing."
const SIGN_IN_NOTICE = 'Sign in to your bank again in SimpleFIN Bridge.'
const PAUSED_NOTICE =
  'Sync is paused with 105 new items waiting for review. It resumes on its own once 50 or fewer are left.'
const WARNING_NOTICE = '85 new to review. Sync pauses at 100.'
const NOTICES = [RECONNECT_NOTICE, CHOOSE_NOTICE, SIGN_IN_NOTICE, PAUSED_NOTICE, WARNING_NOTICE]

// Static rendering escapes apostrophes, so text is matched against the escaped form
function escaped(text: string): string {
  return text.replaceAll("'", '&#x27;')
}

// The paragraph a held-back button names as its description: the reason, then a link to where
// bank sync is set up
function expectNotSetUpNote(markup: string, button: string): void {
  const reasonId = button.match(/aria-describedby="([^"]+)"/)?.[1]
  const note = markup.split(`<p id="${reasonId}"`)[1]?.split('</p>')[0] ?? ''
  expect(note).toContain(escaped(BANK_SYNC_NOT_SET_UP_REASON))
  expect(note).toContain(`href="${BANK_CONNECTIONS_SETTINGS_PATH}"`)
  expect(note).toContain('Open bank connections')
}

// Writes a date as the reminders do, with non-breaking spaces, so a phone never wraps it between its
// month and its day
function unbroken(date: string): string {
  return date.replaceAll(' ', ' ')
}

/**
 * Renders the section in the app's providers over a cache holding what `read` says. A failed read
 * stays failed on render, as it does once the app's own retries have run out. Static rendering marks
 * where one text node meets the next. Text is matched without them
 */
function renderSection(account: Account = createAccount(), autoFocus = false): string {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } },
  })
  client.setQueryData(currencyKeys.list(), CURRENCIES)
  client.setQueryData(bankSyncKeys.providers(), read.providers)
  client.setQueryData(bankSyncKeys.connections(), read.connections)
  client.setQueryData(bankSyncKeys.accountStatus(account.id), read.status)
  if (read.statusError) {
    client
      .getQueryCache()
      .build(client, { queryKey: bankSyncKeys.accountStatus(account.id) })
      .setState({
        status: 'error',
        error: read.statusError,
        errorUpdateCount: 1,
      })
  }

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={AUTH}>
        <ToastContext.Provider value={TOAST}>
          <MemoryRouter>
            <BankLinkSection account={account} sectionNumber="03" autoFocus={autoFocus} />
          </MemoryRouter>
        </ToastContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  ).replaceAll('<!-- -->', '')
}

function getButton(markup: string, label: string): string {
  return markup.match(new RegExp(`<button(?:(?!</button>).)*${label}</button>`, 's'))?.[0] ?? ''
}

// Sync now's label sits inside its feedback wrapper, beside the copy it measures its width by, and
// gives way to a spinner or a tick. Those are labelled instead
function getSyncNowButton(markup: string): string {
  return (
    markup.match(
      /<button(?:(?!<\/button>).)*(?:Sync now|aria-label="Starting sync"|aria-label="Sync started")(?:(?!<\/button>).)*<\/button>/s,
    )?.[0] ?? ''
  )
}

// Synced an hour ago and due again in three hours. That is what Sync now normally meets
function linkSynced(sync = createSync()): AccountBankStatus {
  return createStatus({
    link: createLink({ state: sync.state === 'choose_account' ? 'choose_account' : 'active', sync }),
  })
}

beforeEach(() => {
  // Noon in Toronto, the clock the link fixtures are set against
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T16:00:00Z'))
  read.status = createStatus()
  read.statusError = null
  read.providers = createProviders()
  read.connections = [createConnection()]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BankLinkSection', () => {
  it('keeps a group account manual, with no way to link it', () => {
    read.status = undefined
    const markup = renderSection(createAccount({ group_id: 'group-1' }))
    expect(markup).toContain(`${escaped(GROUP_ACCOUNT_LINK_REASON)} Its transactions stay manual.`)
    expect(markup).not.toContain('Link bank account')
  })

  it('offers a first link to an account never linked', () => {
    const markup = renderSection()
    expect(markup).toContain('Bank link')
    expect(markup).toContain(
      'Link this account to one of the bank accounts on your connections to bring in its transactions automatically.',
    )
    expect(getButton(markup, 'Link bank account')).not.toContain('aria-disabled')
    expect(markup).not.toContain('Review settings')
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

  it("refuses a link on an archived account, and while bank sync isn't set up, saying why under the button", () => {
    // Both reasons last, so each sits under the button as the button's description
    const archived = renderSection(createAccount({ is_archived: true }))
    const archivedButton = getButton(archived, 'Link bank account')
    expect(archivedButton).toContain('aria-disabled="true"')
    const reasonId = archivedButton.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(archived).toContain(
      `<p id="${reasonId}" class="text-sm" style="color:var(--app-text-muted)">Archived accounts are read-only</p>`,
    )

    read.providers = createProviders({ sync_running: false })
    const paused = renderSection()
    const pausedButton = getButton(paused, 'Link bank account')
    expect(pausedButton).toContain('aria-disabled="true"')
    expectNotSetUpNote(paused, pausedButton)
    expect(archived).not.toContain('Open bank connections')
  })

  it('marks its control for the modal to focus only when the modal opens at the bank link', () => {
    const atBankLink = renderSection(createAccount(), true)
    expect(getButton(atBankLink, 'Link bank account')).toContain('data-modal-initial-focus="true"')
    expect(getButton(renderSection(), 'Link bank account')).not.toContain('data-modal-initial-focus')
  })

  it('shows a live link with its facts, its status, the running import, its review settings and a way to unlink', () => {
    read.status = createStatus({
      link: createLink({ import: createImport(), sync: createSync({ state: 'importing', last_success_at: null }) }),
    })
    const markup = renderSection()
    for (const fact of [
      'Bank account',
      'Everyday Chequing',
      'Institution',
      'Harbour Bank',
      'Through',
      'SimpleFIN',
      'History from',
      'Jun 1, 2026',
    ]) {
      expect(markup).toContain(fact)
    }
    expect(markup).toContain('Status')
    expect(markup).toContain('Importing · 1 of 2</span>')
    expect(markup).toContain('Importing from Jun 1, 2026')
    expect(markup).toContain('12 found · 1 of 2')
    expect(markup).toMatch(/role="progressbar"[^>]*aria-valuemax="2"[^>]*aria-valuenow="1"/)
    expect(getButton(markup, 'Review settings')).not.toBe('')
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
    read.status = createStatus({
      link,
      balance,
      opening_adjustment: { amount: 25000, waiting_amount: 0, adjustment_date: '2026-05-31' },
    })
    const markup = renderSection(createAccount({ current_balance: 100000 }))

    expect(markup).toContain('Opening balance to confirm')
    expect(markup).toMatch(/As of .*Record an opening adjustment on May 31, 2026/s)

    // Skipped, the gap stays and the status no longer asks for the opening balance
    read.status = createStatus({
      link: createLink({ sync: createSync({ state: 'synced' }) }),
      balance,
      opening_adjustment: null,
    })
    expect(renderSection()).not.toContain('Record an opening adjustment')
  })

  it.each([
    [
      'less history than it asked for',
      { requested_start: '2026-06-01', earliest_returned: '2026-06-09' },
      'Less history than requested',
      `SimpleFIN returned transactions from ${unbroken('Jun 9, 2026')}, not ${unbroken('Jun 1, 2026')}. This is likely a limit on how much history the bank keeps.`,
    ],
    [
      'no history at all',
      { requested_start: '2026-06-01', earliest_returned: null },
      'No history returned yet',
      `No posted transactions from ${unbroken('Jun 1, 2026')} have come back from SimpleFIN yet. If you used this account since then, some may be missing.`,
    ],
  ])(
    "reminds of an import or catch-up that returned %s, never blaming the bank's history limit when nothing came back, with a ✕ to dismiss it",
    (_, reminder, title, body) => {
      read.status = createStatus({ link: createLink({ history_reminder: reminder }) })
      const markup = renderSection()
      expect(markup).toContain(`>${title}</p>`)
      expect(markup).toContain(`>${escaped(body)}</p>`)
      expect(markup.match(/aria-label="Dismiss"/g)).toHaveLength(1)
      expect(markup).not.toContain('Some transactions may be missing')
    },
  )

  it('reminds of a day that brought back as many transactions as the provider sends at once, with a ✕ to dismiss it', () => {
    read.status = createStatus({ link: createLink({ cut_off_day: '2026-10-03' }) })
    const markup = renderSection()
    expect(markup).toContain('>Some transactions may be missing</p>')
    expect(markup).toContain(
      `>SimpleFIN returned as many transactions for ${unbroken('Oct 3, 2026')} as it sends at once, so some from that day may be missing.</p>`,
    )
    expect(markup.match(/aria-label="Dismiss"/g)).toHaveLength(1)
    expect(markup).not.toContain('history the bank keeps')
  })

  it('shows both reminders ahead of the balances, with the opening adjustment offer still at their foot', () => {
    read.status = createStatus({
      link: createLink({
        sync: createSync({ state: 'opening_balance' }),
        history_reminder: { requested_start: '2026-06-01', earliest_returned: null },
        cut_off_day: '2026-10-03',
      }),
      balance: {
        amount: 125000,
        available: null,
        available_unreadable: false,
        balance_date: '2026-10-03T22:00:00Z',
        ledger_balance: 100000,
        difference: -25000,
      },
      opening_adjustment: { amount: 25000, waiting_amount: 0, adjustment_date: '2026-05-31' },
    })
    const markup = renderSection(createAccount({ current_balance: 100000 }))
    const order = [
      'No history returned yet',
      'Some transactions may be missing',
      'As of ',
      'Record an opening adjustment',
    ].map((text) => markup.indexOf(text))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
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
    expect(markup).not.toContain('aria-label="Dismiss"')
  })

  it.each([
    [
      'a rejected connection, with a way to Settings',
      createSync({ state: 'reconnect_needed' }),
      RECONNECT_NOTICE,
      'Open settings',
    ],
    [
      'a bank account to choose again, with a way to choose it',
      createSync({ state: 'choose_account' }),
      CHOOSE_NOTICE,
      'Choose bank account',
    ],
    ['a bank asking for its sign-in again', createSync({ state: 'bank_signin_needed' }), SIGN_IN_NOTICE, null],
    [
      'a sync paused for review',
      createSync({ state: 'paused', paused: true, waiting_new_count: 105 }),
      PAUSED_NOTICE,
      null,
    ],
    [
      'a review backlog nearing the pause',
      createSync({ state: 'review_warning', review_warning: true, waiting_new_count: 85 }),
      WARNING_NOTICE,
      null,
    ],
  ])('shows one notice for %s', (_, sync, notice, action) => {
    read.status = createStatus({
      link: createLink({ state: sync.state === 'choose_account' ? 'choose_account' : 'active', sync }),
    })
    const markup = renderSection()
    for (const other of NOTICES) expect(markup.includes(escaped(other))).toBe(other === notice)
    if (action) expect(getButton(markup, action)).toContain('data-bank-link-action="true"')
  })

  it('says a provider removed from the server stops the link, in place of the notice its state would show', () => {
    read.status = createStatus({
      link: createLink({ provider_available: false, sync: createSync({ state: 'reconnect_needed' }) }),
    })
    const markup = renderSection()
    expect(markup).toContain(escaped(PROVIDER_UNAVAILABLE_DETAIL))
    expect(markup).toContain('Provider unavailable')
    for (const notice of NOTICES) expect(markup).not.toContain(escaped(notice))
  })

  it('shows the import while it waits on the request budget, as while it runs', () => {
    read.status = createStatus({
      link: createLink({
        import: createImport({ state: 'waiting_on_budget' }),
        sync: createSync({ state: 'import_waiting_on_budget' }),
      }),
    })
    expect(renderSection()).toContain('role="progressbar"')
  })

  it('holds a finished import as done once the status has moved on to synced', () => {
    read.status = createStatus({
      link: createLink({ import: createImport({ state: 'complete', windows_done: 2 }), sync: createSync() }),
    })
    const markup = renderSection()
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('Imported from Jun 1, 2026')
  })

  // The import keeps its progress for when it goes on, but saying it is importing would contradict the status
  it.each([
    [
      'a retry',
      createSync({
        state: 'retrying',
        last_failure: { at: '2026-10-05T15:50:00Z', reason: "SimpleFIN Bridge couldn't be reached" },
      }),
    ],
    ['a rejected connection', createSync({ state: 'reconnect_needed', next_attempt_at: null })],
    ['a bank asking for its sign-in again', createSync({ state: 'bank_signin_needed' })],
  ])('leaves out an import that %s holds', (_, sync) => {
    read.status = createStatus({ link: createLink({ import: createImport({ state: 'waiting' }), sync }) })
    const markup = renderSection()
    expect(markup).not.toContain('role="progressbar"')
    expect(markup).not.toContain('Importing from Jun 1, 2026')
  })

  it('keeps the review notices through a sync, since they follow the backlog rather than the state', () => {
    read.status = createStatus({
      link: createLink({ sync: createSync({ state: 'syncing', review_warning: true, waiting_new_count: 85 }) }),
    })
    expect(renderSection()).toContain(WARNING_NOTICE)
  })

  it.each([
    [
      "a notice's action ahead of the link's own actions, passing over Sync now while the notice holds it",
      createStatus({ link: createLink({ state: 'choose_account', sync: createSync({ state: 'choose_account' }) }) }),
      ['Choose bank account', 'Review settings', 'Unlink'],
    ],
    [
      'Sync now ahead of Review settings and Unlink while a sync can run',
      linkSynced(),
      ['Sync now', 'Review settings', 'Unlink'],
    ],
    [
      'Review settings first while the import holds Sync now, since focus would open the reason over the section',
      createStatus({
        link: createLink({ import: createImport(), sync: createSync({ state: 'importing', last_success_at: null }) }),
      }),
      ['Review settings', 'Unlink'],
    ],
  ])('marks for the modal to focus %s', (_, status, expected) => {
    read.status = status
    const markup = renderSection(createAccount(), true)
    const marked = [
      ...markup.matchAll(
        /<button[^>]*data-modal-initial-focus="true"[^>]*>(?:(?!<\/button>).)*?([A-Z][a-z]+(?: [a-z]+)*)(?:<\/span>)*<\/button>/gs,
      ),
    ]
    expect(marked.map((match) => match[1])).toEqual(expected)
  })

  it.each([
    [
      // A worker fetching the import's next part runs a sync too. The import's own reason outranks the sync's
      'an import runs',
      createStatus({
        link: createLink({
          import: createImport(),
          sync: createSync({ state: 'importing', last_success_at: null, sync_running: true }),
        }),
      }),
      'The import is still running',
    ],
    ['a sync runs', linkSynced(createSync({ state: 'syncing', sync_running: true })), 'A sync is already running'],
    [
      'a sync runs under a bank sign-in, which shows over it, since a second sync would spend another request',
      linkSynced(createSync({ state: 'bank_signin_needed', sync_running: true })),
      'A sync is already running',
    ],
    [
      'the connection needs reconnecting',
      linkSynced(createSync({ state: 'reconnect_needed' })),
      'Reconnect SimpleFIN in Settings before syncing',
    ],
    [
      'the bank account has to be chosen again',
      linkSynced(createSync({ state: 'choose_account' })),
      'Choose the bank account again before syncing',
    ],
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
    read.connections = [
      createConnection({
        request_budget: { limit: 20, used: 20, available_again_at: '2026-10-05T19:00:00Z', held_by_provider: false },
      }),
    ]
    const markup = renderSection()
    expect(getSyncNowButton(markup)).toContain('aria-disabled="true"')
    expect(markup).toContain(
      escaped(
        'This connection has used its 20 SimpleFIN requests in the last 24 hours. More are available in 3 hours.',
      ),
    )
  })

  it("disables Sync now while SimpleFIN's own limit holds the connection's requests, saying so", () => {
    read.status = linkSynced()
    read.connections = [
      createConnection({
        request_budget: { limit: 20, used: 20, available_again_at: '2026-10-05T19:00:00Z', held_by_provider: true },
      }),
    ]
    const markup = renderSection()
    expect(getSyncNowButton(markup)).toContain('aria-disabled="true"')
    expect(markup).toContain(
      escaped('SimpleFIN says this connection has reached its request limit. More are available in 3 hours.'),
    )
  })

  it('offers Sync now again once the spent requests free up, though the connection still reads as spent', () => {
    read.status = linkSynced()
    read.connections = [
      createConnection({
        request_budget: { limit: 20, used: 20, available_again_at: '2026-10-05T16:05:00Z', held_by_provider: false },
      }),
    ]
    expect(renderSection()).toContain(
      escaped(
        'This connection has used its 20 SimpleFIN requests in the last 24 hours. More are available in 5 minutes.',
      ),
    )

    vi.setSystemTime(new Date('2026-10-05T16:05:00Z'))
    const markup = renderSection()

    expect(getSyncNowButton(markup)).not.toContain('aria-disabled')
    expect(markup).not.toContain('More are available')
  })

  it.each([
    ['nothing asked for', createSync()],
    [
      'a sync asked for in any window, which nothing starts until the worker is back',
      createSync({ sync_requested: true }),
    ],
  ])("disables Sync now while bank sync isn't set up, with %s, saying why under the actions", (_, sync) => {
    read.status = linkSynced(sync)
    read.providers = createProviders({ sync_running: false })
    const markup = renderSection()
    expect(getSyncNowButton(markup)).toContain('aria-disabled="true"')
    expect(getSyncNowButton(markup)).not.toContain('aria-label="Starting sync"')
    expectNotSetUpNote(markup, getSyncNowButton(markup))
  })

  it('prints no reason under the actions while another reason holds Sync now back first', () => {
    read.status = linkSynced(createSync({ state: 'syncing', sync_running: true }))
    read.providers = createProviders({ sync_running: false })
    expect(renderSection()).not.toContain('Open bank connections')
  })

  it.each([
    ['a synced link', createSync()],
    [
      'a bank asking for its sign-in again, so the user can check straight after signing in',
      createSync({ state: 'bank_signin_needed' }),
    ],
  ])('offers Sync now on %s', (_, sync) => {
    read.status = linkSynced(sync)
    const button = getSyncNowButton(renderSection())
    expect(button).toContain('Sync now')
    expect(button).not.toContain('aria-disabled')
  })

  it('reads as the sync starting until a worker starts a sync asked for in any window, keeping focus and the width of its label', () => {
    read.status = linkSynced(createSync({ sync_requested: true }))
    const button = getSyncNowButton(renderSection())
    expect(button).toContain('aria-label="Starting sync"')
    expect(button).toContain('aria-busy="true"')
    expect(button).not.toMatch(/ (aria-)?disabled/)

    // The hidden label the width is measured from, kept for a button the modal opens while the sync starts
    expect(button).toMatch(/<span[^>]* aria-hidden="true"[^>]*>(?:(?!<\/button>).)*Sync now/s)
  })
})

// What this window's own press shows lives in the button's state. A static render can't drive it
describe('describeSyncNow', () => {
  it("reads Sync started once the worker has started this window's sync, rather than as held back by it", () => {
    const link = createLink({ sync: createSync({ state: 'syncing', sync_running: true }) })
    expect(describeSyncNow('success', link, createConnection(), createProviders())).toEqual({
      status: 'success',
      block: null,
    })
  })

  it('holds Sync now back while the provider is gone from the server, saying why', () => {
    const link = createLink({ provider_available: false })
    expect(describeSyncNow('idle', link, createConnection(), createProviders())).toEqual({
      status: 'idle',
      block: PROVIDER_UNAVAILABLE_DETAIL,
    })
  })

  it("stops reading as starting this window's sync once bank sync isn't set up, saying why instead", () => {
    const link = createLink({ sync: createSync({ sync_requested: true }) })
    const providers = createProviders({ sync_running: false })
    expect(describeSyncNow('loading', link, createConnection(), providers)).toEqual({
      status: 'idle',
      block: BANK_SYNC_NOT_SET_UP_REASON,
    })
  })
})
