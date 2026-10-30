import type { TransferCounterpartyScope } from '@/api/transactions/types'

export type BankProviderId = 'simplefin'

/**
 * Where a provider is connected: once in settings when one credential reaches every bank account the
 * user holds there, or inside an account's link flow when it authorizes one institution at a time
 */
export type BankProviderConnectsFrom = 'settings' | 'account'

/**
 * A provider adapter the deployment has enabled
 */
export type BankProvider = {
  id: BankProviderId
  name: string

  /** One sentence on what connecting it reaches, shown where the user chooses a provider */
  description: string
  connects_from: BankProviderConnectsFrom

  /**
   * Whether new connections may be made, which the server controls per provider
   *
   * Withdrawing an offer leaves existing connections working: they keep syncing, link further
   * accounts, reconnect and disconnect as before
   */
  offered: boolean

  /** How many calendar months back an import may start, set per deployment */
  history_limit_months: number

  /** False when the provider cannot say how much history it holds, which SimpleFIN cannot */
  advertises_history: boolean

  /**
   * How many institutions the user may link through this provider across all their connections, or
   * null for no limit. The provider itself may still limit what it allows
   */
  institution_limit: number | null

  /** Institutions with a bank account linked through this provider, each counted once toward the limit */
  institutions_in_use: string[]
}

export type BankProvidersResponse = {
  /** The single "may this user link bank accounts" check, which every linking request also makes */
  may_link: boolean

  /**
   * False when the sync worker has not checked in for 15 minutes, so nothing would run a new import or
   * sync. Adding a connection and linking are refused with a reason until it is back
   */
  sync_running: boolean
  providers: BankProvider[]
}

/**
 * Rolling 24-hour request count for one provider connection
 */
export type BankRequestBudget = {
  limit: number
  used: number

  /** ISO timestamp when the oldest counted request leaves the window, null while requests remain */
  available_again_at: string | null

  /** Whether the provider's word that its quota is spent, rather than the connection's own limit, holds the next request back */
  held_by_provider: boolean
}

export type BankConnectionStatus = 'active' | 'credential_rejected'

/**
 * One stored provider credential, owned by the user and shared by every account linked through it
 */
export type BankConnection = {
  id: string
  provider: BankProviderId
  provider_name: string

  /** The user's own name for the connection, shown in place of the provider's name when set */
  nickname: string | null

  /** Where the credential points, shown so the user can tell connections apart */
  server_label: string
  created_at: string
  status: BankConnectionStatus

  /** The bank accounts the credential last returned, kept while a rejected credential waits for a reconnect */
  accounts: ConnectionBankAccount[]

  /** The links through it that stopped syncing until the user chooses each one's bank account again */
  choose_again_links: ChooseAgainLink[]

  /**
   * True while the connection's bank accounts are waiting on a listing still to run, such as after a
   * claim or reconnect whose own listing failed. `accounts` fills in when it finishes
   */
  discovery_pending: boolean
  request_budget: BankRequestBudget
}

/**
 * A bank account a connection returns, as the connection lists it outside any one account
 */
export type ConnectionBankAccount = {
  external_id: string
  name: string
  institution_name: string

  /** ISO 4217 code, or the URL SimpleFIN uses for a custom currency */
  currency: string

  /** True for a provider-specific currency, which no account can link to */
  custom_currency: boolean
  linked_account_id: string | null

  /**
   * The Lumina accounts this bank account may be linked to: personally owned, not archived, writable,
   * in the same currency and not already linked. Empty for a custom currency
   */
  eligible_account_ids: string[]

  /**
   * True while the account linked to it through this connection waits on the user signing in to its
   * bank again at the provider. Never set on a rejected connection, which needs reconnecting first
   */
  signin_needed: boolean
}

/**
 * A link whose bank account the provider no longer lists as before, waiting for the user to choose it again
 */
export type ChooseAgainLink = {
  account_id: string

  /** The bank account's name as it was when the provider last listed it as before */
  external_account_name: string
}

export type UnavailableBankAccountReason =
  'already_linked' | 'currency_mismatch' | 'custom_currency' | 'institution_limit'

/**
 * A bank account a connection returned, described relative to the account being linked
 */
export type DiscoveredBankAccount = {
  external_id: string
  name: string
  institution_name: string

  /** ISO 4217 code, or the URL SimpleFIN uses for a custom currency */
  currency: string

  /** Provider balance in minor units of the bank account's currency, null when it can't be stored exactly */
  balance: number | null

  /** ISO timestamp the provider gives the balance as of, null when the bank gave no usable balance */
  balance_date: string | null
  linkable: boolean
  unavailable_reason: UnavailableBankAccountReason | null
  unavailable_message: string | null

  /** Whether the institution looks different from the one the account names */
  institution_differs: boolean
}

/**
 * The bank accounts a connection returned for the account being linked
 */
export type DiscoveredBankAccounts = {
  /**
   * True while a fresh listing runs, which opening the link flow asks for when the last one is over
   * an hour old. `accounts` is the previous listing until it finishes
   */
  discovery_pending: boolean
  accounts: DiscoveredBankAccount[]
}

export type ClaimSetupTokenPayload = {
  provider: BankProviderId
  setup_token: string

  /** Optional, and blank means none */
  nickname?: string | null
}

/**
 * What replacing a rejected credential did to the accounts linked through it
 */
export type ReconnectConnectionResult = {
  connection: BankConnection

  /** Accounts whose bank account came back unchanged, which resume syncing */
  resumed_account_ids: string[]

  /** Accounts whose bank account came back under a new identity, which must be chosen again */
  choose_again_account_ids: string[]

  /**
   * True when the reconnect couldn't list the connection's bank accounts, so both lists are empty
   * and the accounts are sorted out once a sync lists them
   */
  accounts_pending: boolean
}

/**
 * The permitted import start range for one account and provider
 *
 * Every date is a calendar date in YYYY-MM-DD form, computed in the user's profile timezone
 */
export type BankImportRange = {
  suggested_start: string

  /** The suggestion before the range raised it, shown so a moved start is never silent */
  default_suggestion: string
  earliest_allowed: string
  latest_allowed: string

  /** The day after the latest ledger transaction dated today or earlier, null for an empty account */
  ledger_floor: string | null
  provider_limit_date: string
  provider_history_months: number
  latest_ledger_date: string | null
}

export type LinkBankAccountPayload = {
  account_id: string
  connection_id: string
  external_account_id: string
  start_date: string
}

/**
 * The one state every surface shows for a live link, chosen by the server as the first that applies,
 * in this order: what only the user can fix (reconnect in settings, sign in to the bank at the
 * provider, choose the bank account again), an import fetching or waiting on the request budget, the
 * review pause, a sync fetching, an opening balance to confirm, the review warning, a retry, and
 * otherwise synced
 */
export type BankSyncState =
  | 'reconnect_needed'
  | 'bank_signin_needed'
  | 'choose_account'
  | 'importing'
  | 'import_waiting_on_budget'
  | 'paused'
  | 'syncing'
  | 'opening_balance'
  | 'review_warning'
  | 'retrying'
  | 'synced'

export type BankSyncFailure = {
  at: string
  reason: string
}

/**
 * A live link's sync state, with the facts its Sync details and notices word
 */
export type BankSyncStatus = {
  state: BankSyncState

  /** Kept through failed attempts, null until the link first syncs */
  last_success_at: string | null

  /** The last attempt only when it failed, since a successful one is the last success */
  last_failure: BankSyncFailure | null

  /**
   * When the next sync or retry runs, or for an import waiting on the request budget, when a request
   * frees up for its next part. Null while the link is due at once, as while its import catches up,
   * and after a rejected credential, which stops its sync until a reconnect. A bank sign-in keeps the
   * daily time the app checks again at
   */
  next_attempt_at: string | null

  /** The next sync is due before the connection's request budget frees a request, so it waits for one */
  waiting_on_budget: boolean

  /**
   * Whether the provider's word that its quota is spent, rather than the connection's own limit over
   * the last 24 hours, holds the connection's next request back
   */
  held_by_provider: boolean

  /**
   * A worker is syncing the link, which the state shows as syncing unless a state outranks it, such as
   * a bank sign-in
   */
  sync_running: boolean

  /**
   * The user asked to sync the link now, the sync is due and no worker has started it yet. The state
   * stays the one before it, since it reads as syncing only once a worker runs it. A sync waiting for
   * the request budget isn't due until a request frees up
   */
  sync_requested: boolean

  /** New posted items awaiting their first review, the count the warning and the pause read */
  waiting_new_count: number

  /** Both false while only the user can restart the sync, since the count no longer decides when it syncs */
  paused: boolean
  review_warning: boolean
}

/**
 * Why an import runs: a first link, a link made again after the account was unlinked, or a bank
 * account chosen again after the provider stopped recognizing the linked one, each from a new import
 * start, or the catch-up after a rejected credential was replaced, which resumes where syncing stopped
 */
export type BankImportKind = 'initial' | 'relink' | 'choose_again' | 'reconnect'

/**
 * Where an import stands. It runs while a sync fetches its next part or could fetch it now. It waits
 * while a failed attempt waits to retry, the bank needs a sign-in, or the provider refused the
 * connection's credential, and waits on the budget until the connection's request budget frees a
 * request, when its link's `sync.next_attempt_at` says when its next part can
 */
export type BankImportState = 'running' | 'waiting' | 'waiting_on_budget' | 'complete'

/**
 * Progress of the import that runs when an account is linked or reconnected, which always
 * completes regardless of the review backlog
 */
export type BankImportProgress = {
  kind: BankImportKind
  state: BankImportState
  requested_start: string
  windows_total: number
  windows_done: number
  items_found: number

  /** Earliest booked transaction the provider returned, null until one arrives */
  earliest_returned_date: string | null
}

/**
 * The link between one account and one bank account, as linking answers it, without its status
 */
export type BankAccountLink = {
  account_id: string
  connection_id: string
  provider: BankProviderId
  provider_name: string
  external_account_id: string
  external_account_name: string
  institution_name: string

  /** The calendar day, in the user's profile timezone, from which the bank supplies the account's transactions */
  import_start: string
  linked_at: string
}

/**
 * What an account last linked to, kept after unlinking so a later link reads as a relink and can
 * be checked against the bank account the provider returns this time
 */
export type PreviousBankLink = {
  provider_name: string
  external_account_id: string
  external_account_name: string
  institution_name: string
  unlinked_at: string
}

/**
 * Where a live link stands: syncing, or waiting for the user to choose its bank account again after
 * the provider started listing it differently
 */
export type BankLinkState = 'active' | 'choose_account'

/**
 * A live link with its import and sync status, as the account's page and the list of links read it
 */
export type BankLink = BankAccountLink & {
  state: BankLinkState

  /**
   * Null while the link shows no import's progress: no import runs, it waits for its bank account to
   * be chosen again, or it catches up after a reconnect. Never `complete`
   */
  import: BankImportProgress | null
  sync: BankSyncStatus

  /**
   * The last import or catch-up that fell short, null when none did or the user dismissed it, or when
   * it got nothing and a later sync has since brought booked history from the day it asked from
   */
  history_reminder: BankHistoryReminder | null

  /**
   * The latest day kept though it brought back as many transactions as the provider sends at once,
   * so some of that day's may be missing, as YYYY-MM-DD. Null when no day did or the user dismissed it
   */
  cut_off_day: string | null
}

/**
 * The reminder an import or catch-up raises when it returns less history than it asked for. Unverified,
 * since a quiet account can simply have had no activity early on
 */
export type BankHistoryReminder = {
  /** The first day the import or catch-up asked from, as YYYY-MM-DD */
  requested_start: string

  /** The earliest booked day it got, more than a week after the requested start, or null when it got none */
  earliest_returned: string | null
}

/**
 * The bank's balance for a linked account beside the ledger's at the end of the bank's balance date,
 * in the account currency's minor units. It only informs, so a difference never adjusts the ledger
 */
export type BankBalance = {
  /** Null when the bank's balance can't be read exactly in the account's currency, which isn't compared */
  amount: number | null

  /** Null when the bank gives none or it can't be read exactly */
  available: number | null

  /** Whether the bank gave an available balance that can't be read exactly, which shows as unavailable */
  available_unreadable: boolean

  /** The moment the bank gives the balance as of */
  balance_date: string

  /** The account's balance at the end of the balance date's day in the user's profile timezone */
  ledger_balance: number

  /** The ledger against the bank, ledger minus bank, null while the amount is */
  difference: number | null
}

/**
 * One account's bank link, read only for the user's own personal accounts. The server refuses any
 * other account, so a group account is never read
 */
export type AccountBankStatus = {
  account_id: string
  link: BankLink | null

  /** What the account was last linked to, only when it has no live link */
  previous_link: PreviousBankLink | null

  /** Only for a live link that has synced and follows its bank account as the provider lists it */
  balance: BankBalance | null

  /** Only while the opening adjustment is offered and the balances compare */
  opening_adjustment: OpeningAdjustment | null
}

export type ReviewDecision = 'review' | 'trust'

export type ReviewPreferences = {
  new_transactions: ReviewDecision
  corrections: ReviewDecision
  removals: ReviewDecision
}

export type BankField = 'date' | 'amount' | 'description'

/**
 * The bank fields a correction can change
 */
export type CorrectableBankField = BankField

/**
 * The bank fields the ledger row can differ from, which count as the user's own once they do and
 * which Restore bank value puts back. The ledger has no description of its own to edit
 */
export type EditableBankField = Extract<BankField, 'date' | 'amount'>

/**
 * The values a bank supplies for one booked transaction
 */
export type BankValues = {
  date: string

  /**
   * Signed minor units, money out negative. Null when the bank sent more decimal places than the
   * currency holds, which is never rounded: `raw_amount` holds it and the user enters the amount
   */
  amount: number | null

  /** The amount exactly as the bank sent it, given only when `amount` is null */
  raw_amount: string | null
  description: string
}

export type BankReviewItemKind = 'new' | 'correction' | 'removal'

/**
 * One item waiting in the review inbox, outside the ledger and every calculation until acted on
 */
export type BankReviewItem = {
  id: string
  kind: BankReviewItemKind
  account_id: string
  provider: BankProviderId
  provider_name: string
  received_at: string

  /** Moves on whenever the bank changes the item, so bulk approval applies only what was previewed */
  version: number

  /** The bank's values: the whole item for a new one, the proposal for a correction */
  bank: BankValues

  /** The ledger transaction a correction or removal is about */
  transaction_id: string | null

  /** The approved ledger values a correction would change */
  current: BankValues | null
  changed_fields: CorrectableBankField[]

  /** The fields the correction changes that the user had edited */
  protected_fields: EditableBankField[]
}

/**
 * How many items wait of each kind, across every page of the list
 */
export type BankReviewCounts = Record<BankReviewItemKind, number>

/**
 * One account's new items waiting for review, and whether its sync is paused or warned for them,
 * which the review block's notice reads
 */
export type BankReviewBacklog = Pick<BankLink, 'account_id'> &
  Pick<BankSyncStatus, 'waiting_new_count' | 'review_warning' | 'paused'>

/**
 * One page of the review inbox, newest first
 */
export type BankReviewPage = {
  items: BankReviewItem[]
  counts: BankReviewCounts

  /** Passed back to read the page after this one, null on the last page */
  next_cursor: string | null
}

export type AddReviewItemPayload = {
  category_id: string
  merchant_id: string
  dt: string

  /** Signed minor units, money out negative. Required, so an item whose bank amount is null gets one */
  amount: number
  notes?: string | null
  tag_ids?: string[]
  counterparty_account_id?: string | null
  counterparty_account_scope?: TransferCounterpartyScope | null
}

/**
 * The kinds of item bulk approval applies. New items stay waiting, since each needs a merchant and
 * category before it is added
 */
export type BulkApprovalKind = Exclude<BankReviewItemKind, 'new'>

export type BulkApprovalGroup = {
  kind: BulkApprovalKind
  count: number

  /** Signed change to account balances in minor units, summed per currency, leaving out any currency it doesn't move */
  net_effect: { currency: string; amount: number }[]
  items: BankReviewItem[]
}

/**
 * What bulk approval would apply, with a group for each kind that has items, corrections first
 */
export type BulkApprovalPreview = {
  groups: BulkApprovalGroup[]

  /** New items in scope, which stay waiting */
  excluded_count: number
}

/**
 * One previewed item to apply, at the version the preview showed
 */
export type BulkApprovalItem = {
  id: string
  version: number
}

export type BulkApprovalPayload = {
  items: BulkApprovalItem[]
}

export type BulkApprovalResult = {
  corrected: number
  removed: number

  /**
   * Items sent that still wait for review, because the bank changed them since the preview or a check
   * refused them. One decided elsewhere since isn't counted
   */
  failed: number

  /** The items applied, which no longer wait */
  applied_ids: string[]
}

/**
 * A read-only unsettled bank transaction, outside the ledger and review
 */
export type PendingBankTransaction = {
  id: string
  account_id: string
  date: string

  /** Signed minor units, money out negative, null when it can't be stored exactly */
  amount: number | null

  /** The amount exactly as the bank sent it, given only when `amount` is null */
  raw_amount: string | null
  description: string

  /**
   * When the request that brought it was sent. An account that can't sync keeps its earlier pending
   * transactions, so this is how old they may be
   */
  observed_at: string
}

/**
 * A booked bank record of no amount, listed for awareness and kept out of the ledger, review and
 * every total until the user dismisses it or the bank drops it
 */
export type BankHold = {
  id: string
  account_id: string
  date: string
  description: string

  /** When the request that brought it was sent */
  observed_at: string
}

/**
 * Where a ledger transaction came from, carried on every transaction response and null on one the
 * user entered by hand
 */
export type TransactionBankSource = {
  provider: BankProviderId
  provider_name: string

  /** The latest values the bank supplied */
  bank_values: BankValues

  /** The fields whose ledger value differs from the bank's, which a trusted correction leaves alone */
  edited_fields: EditableBankField[]

  /** The waiting correction or removal about this transaction, if any */
  review_item_id: string | null
}

/**
 * The one-time offer, once the import is reviewed, to record the gap between the bank's balance and
 * the ledger's as an opening adjustment, leaving out the items still waiting for review, which the
 * bank's balance already holds
 */
export type OpeningAdjustment = {
  /**
   * The bank's balance minus the ledger's on the balance date, less waiting_amount, in minor units
   * signed as the ledger keeps them
   */
  amount: number

  /**
   * How much approving the items waiting for review as the bank sent them would move the ledger by
   * the balance date, in signed minor units, zero when nothing waiting changes it
   */
  waiting_amount: number

  /** The day before the import start, the latest day the bank doesn't supply, as YYYY-MM-DD */
  adjustment_date: string
}

export type UnlinkResult = {
  unlinked_account_ids: string[]
}
