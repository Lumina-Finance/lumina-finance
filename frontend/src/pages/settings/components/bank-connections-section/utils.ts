import type {
  BankConnection,
  BankProvider,
  ConnectionBankAccount,
  CredentialField,
  ReconnectConnectionResult,
} from '@/api/bank-sync'
import type { SyncStatusTone } from '@/components/display/SyncStatusDot'
import { connectionName, countNoun, credentialNoun, providerSiteName } from '@/utils/bankSync'
import { formatRelativeFutureTime } from '@/utils/relativeTime'

/**
 * Says what is wrong with a value pasted in one of the provider's fields before it is sent, or null
 * when its length is fine, in the words the server would use. The field says how long it may be
 *
 * @param site - The provider's site, where the user copies the value from
 */
export function describeCredentialLength(field: CredentialField, site: string, value: string): string | null {
  const noun = credentialNoun(field.label)
  return value.length > field.max_length
    ? `That ${noun} is too long. Copy only the ${noun} from ${site} and try again`
    : null
}

/** Looks up an account's name by its id, or undefined while the accounts are loading */
export type AccountNameLookup = (accountId: string) => string | undefined

/**
 * Joins names into one phrase, as in "Harbour Bank, Tidewater Credit Union and Northshore Bank"
 */
function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Counts the bank accounts linked to an account, through this connection or another reaching them too
 */
function countLinked(accounts: ConnectionBankAccount[]): number {
  return accounts.filter((account) => account.linked_account_id !== null).length
}

/**
 * How many of the connection's bank accounts are linked, out of all it returns, as its row and modal
 * say it. A bank account whose link waits under Mismatch detected doesn't count as linked
 */
export function countLinkedBankAccounts(connection: BankConnection): { linked: number; total: number } {
  return { linked: countLinked(listShownBankAccounts(connection)), total: connection.accounts.length }
}

/**
 * The connection's bank accounts as settings shows and counts them. A link waiting on Choose bank
 * account has stopped and shows under Mismatch detected, so a bank account it still points at, as one
 * whose currency changed does, shows as not linked rather than twice
 */
export function listShownBankAccounts(connection: BankConnection): ConnectionBankAccount[] {
  const waiting = new Set(connection.choose_again_links.map((link) => link.account_id))
  return connection.accounts.map((account) =>
    account.linked_account_id !== null && waiting.has(account.linked_account_id)
      ? { ...account, linked_account_id: null }
      : account,
  )
}

/**
 * The institutions whose bank login behind the connection needs the user to sign in again at the
 * provider, in the order the connection lists them. The server flags none on a rejected connection,
 * and its reconnect comes first
 */
export function listSignInInstitutions(connection: BankConnection): string[] {
  return [
    ...new Set(
      connection.accounts.filter((account) => account.signin_needed).map((account) => account.institution_name),
    ),
  ]
}

/**
 * The status a connection shows in settings, as its dot's tone and its label: whether its credential
 * still works, and otherwise whether a bank login behind it needs signing in to again
 */
export function describeConnectionStatus(connection: BankConnection): { tone: SyncStatusTone; label: string } {
  // Nothing the user does here resumes it, but nothing is broken either, so it takes the watch colour
  if (!connection.provider_available) return { tone: 'review', label: 'Provider unavailable' }
  if (connection.status === 'credential_rejected') return { tone: 'stopped', label: 'Reconnect needed' }
  if (listSignInInstitutions(connection).length > 0) return { tone: 'stopped', label: 'Bank sign-in needed' }
  return { tone: 'ok', label: 'OK' }
}

/**
 * What the user does about a bank sign-in, shown beside the connection's status, or null when no bank
 * needs one
 */
export function describeSignInDetail(connection: BankConnection): string | null {
  const institutions = listSignInInstitutions(connection)
  if (institutions.length === 0) return null
  return `Sign in to ${joinNames(institutions)} again in ${providerSiteName(connection)}. The app checks daily.`
}

/**
 * Whether a connection matches the settings search: its nickname, provider, server, institutions,
 * bank accounts or the accounts they are linked to
 *
 * @param query - The search as typed, matched without regard to case or surrounding spaces
 */
export function matchesConnectionSearch(
  connection: BankConnection,
  query: string,
  accountNameFor: AccountNameLookup,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  return [
    connection.nickname ?? '',
    connection.provider_name,
    connection.server_label,
    ...connection.accounts.flatMap((account) => [
      account.name,
      account.institution_name,
      account.linked_account_id ? (accountNameFor(account.linked_account_id) ?? '') : '',
    ]),
  ].some((text) => text.toLowerCase().includes(needle))
}

/**
 * Whether a connection a claim saved is done being added: its bank accounts listed, or a listing due.
 * The server saves a connection before it lists them, so a read partway through the claim has neither
 */
export function isClaimSettled(connection: BankConnection): boolean {
  return connection.accounts.length > 0 || connection.discovery_pending
}

/**
 * The confirmation once a connection is added. A claim whose listing of bank accounts failed keeps
 * the connection and lists them in the background, so it says they are on the way rather than none
 */
export function describeConnected(connection: BankConnection): string {
  const name = connectionName(connection)
  if (connection.discovery_pending && connection.accounts.length === 0) {
    return `${name} connected. Its bank accounts will appear here shortly.`
  }
  return `${name} connected with ${countNoun(connection.accounts.length, 'bank account')}. Link each one from the account it belongs to.`
}

/**
 * The confirmation once a rejected connection takes a new credential: how many of its accounts resume
 * syncing and how many need their bank account chosen again, or that they wait on a listing still to run
 */
export function describeReconnected(result: ReconnectConnectionResult): string {
  const parts = [`${connectionName(result.connection)} reconnected.`]
  if (result.accounts_pending) {
    parts.push('Linked accounts pick up once their bank accounts are listed again.')
    return parts.join(' ')
  }

  const resumed = result.resumed_account_ids.length
  const chooseAgain = result.choose_again_account_ids.length
  if (resumed > 0) parts.push(`${countNoun(resumed, 'account')} ${resumed === 1 ? 'resumes' : 'resume'} syncing.`)
  if (chooseAgain > 0) {
    parts.push(
      `${countNoun(chooseAgain, 'account')} ${chooseAgain === 1 ? 'needs its bank account' : 'need their bank accounts'} chosen again.`,
    )
  }
  return parts.join(' ')
}

/**
 * The institutions linked through the provider against the user's limit, as the connection's fact
 * and the explanation beside it
 *
 * @param provider - The provider as the server describes it, undefined while it loads
 */
export function describeInstitutionAllowance(
  provider: BankProvider | undefined,
  providerName: string,
): { value: string; hint: string } {
  const counted = `Counts each institution with a linked bank account once, across all your ${providerName} connections.`
  if (!provider) return { value: '—', hint: counted }

  const inUse = provider.institutions_in_use.length
  if (provider.institution_limit === null) {
    return {
      value: `${inUse} · no limit`,
      hint: `${counted} Lumina Finance sets no limit on institutions for ${providerName}, though ${providerName} may set limits of its own.`,
    }
  }
  return { value: `${inUse} of ${provider.institution_limit}`, hint: counted }
}

/**
 * Explains the connection's request count beside it: the cap Lumina Finance keeps each connection
 * under (the deployment configures it), and once it's spent, when automatic syncs pick up
 */
export function describeRequestBudget(connection: BankConnection): string {
  const { limit, used, available_again_at: availableAgainAt } = connection.request_budget
  if (limit === null) return 'Lumina Finance sends this connection no requests while its provider is unavailable.'
  const cap = `Lumina Finance makes up to ${countNoun(limit, 'request')} a day for each connection. Automatic syncs and Sync now share them across every account linked through it.`
  if (used < limit || !availableAgainAt) return cap
  return `${cap} Automatic syncs wait until one frees up ${formatRelativeFutureTime(availableAgainAt)}.`
}

export interface InstitutionGroup {
  name: string

  /** Set when a bank login here needs signing in to again. The row shows it in red */
  signInNeeded: boolean

  /** Set when linking one of its free bank accounts would go over the institution limit */
  overLimit: boolean
  linked: number
  bankAccounts: ConnectionBankAccount[]
}

/**
 * The connection's bank accounts gathered by institution, in the order the connection lists them
 *
 * An institution not yet in use can't take a link once the limit is reached. That matters only
 * where it still has a bank account that could be linked
 */
export function groupInstitutions(
  connection: BankConnection,
  allowance: { institutionLimit: number | null; institutionsInUse: string[] },
): InstitutionGroup[] {
  const signIn = new Set(listSignInInstitutions(connection))
  const limitReached =
    allowance.institutionLimit !== null && allowance.institutionsInUse.length >= allowance.institutionLimit
  const shown = listShownBankAccounts(connection)
  const names = [...new Set(shown.map((account) => account.institution_name))]

  return names.map((name) => {
    const bankAccounts = shown.filter((account) => account.institution_name === name)
    const hasLinkable = bankAccounts.some((account) => account.linked_account_id === null && !account.custom_currency)
    return {
      name,
      signInNeeded: signIn.has(name),
      overLimit:
        connection.status === 'active' && limitReached && hasLinkable && !allowance.institutionsInUse.includes(name),
      linked: countLinked(bankAccounts),
      bankAccounts,
    }
  })
}

/**
 * Whether an institution matches the search over a connection's institutions, by its own name or one
 * of its bank accounts'
 */
export function matchesInstitutionSearch(group: InstitutionGroup, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    !needle ||
    [group.name, ...group.bankAccounts.map((account) => account.name)].some((text) =>
      text.toLowerCase().includes(needle),
    )
  )
}

/**
 * Why the links waiting to choose their bank account again stopped syncing, for the Mismatch
 * detected group's tooltip, naming the bank account and its account when there is only one
 */
export function describeMismatch(connection: BankConnection, accountNameFor: AccountNameLookup): string {
  const links = connection.choose_again_links
  if (links.length === 1) {
    const [link] = links
    const account = accountNameFor(link.account_id) ?? 'The account'
    return `${connection.provider_name} now lists ${link.external_account_name} differently, so Lumina Finance can't tell whether it's the same account. ${account} won't sync until you choose its bank account again.`
  }
  return `${connection.provider_name} now lists some bank accounts differently, so Lumina Finance can't tell whether they're the same ones. Their accounts won't sync until you choose each one's bank account again.`
}
