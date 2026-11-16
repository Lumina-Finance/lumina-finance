import type { AccountsOverview } from '@/api/accounts'
import { isAnsweredByApp } from '@/api/auth'
import type { BankConnection, FinishBankAuthorizationResult, ReconnectConnectionResult } from '@/api/bank-sync'

/**
 * Whether an account is the user's own personal account, the only kind bank sync links and lists
 * bank items for. A group account, even for its admin, and one shared with the user aren't
 */
export function isOwnPersonalAccount(
  account: Pick<AccountsOverview, 'owner_id' | 'group_id'>,
  userId: string,
): boolean {
  return account.owner_id === userId && account.group_id === null
}

/**
 * Names the site where the user manages a provider's bank logins, or the provider itself once it is
 * removed from the server and its site is no longer known
 */
export function providerSiteName(source: { provider_site: string | null; provider_name: string }): string {
  return source.provider_site ?? source.provider_name
}

/**
 * Names a connection by the user's nickname for it, or by its provider when it has none
 */
export function connectionName(connection: Pick<BankConnection, 'nickname' | 'provider_name'>): string {
  return connection.nickname ?? connection.provider_name
}

/**
 * Why a connection or link whose provider was removed from the server no longer syncs. Its card
 * says so, and Sync now and Reconnect are held back
 */
export const PROVIDER_UNAVAILABLE_DETAIL =
  'This provider is no longer available on this server, so syncing is off for this connection. Disconnecting keeps its transactions and waiting items.'

/**
 * Names a provider's credential mid-sentence, as in "a new setup token", keeping a leading acronym such as "API key" as it is
 */
export function credentialNoun(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? `${label[0].toLowerCase()}${label.slice(1)}` : label
}

/**
 * Counts something with its noun, singular for one
 */
export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * What disconnecting does to the accounts linked through a connection, said under Disconnect before
 * it is pressed, or null when none is linked
 */
export function describeDisconnectEffect(linkedCount: number): string | null {
  if (linkedCount === 0) return null
  const theirs = linkedCount === 1 ? 'its' : 'their'
  return `Disconnecting unlinks ${countNoun(linkedCount, 'account')} but keeps ${theirs} transactions and waiting items.`
}

/**
 * The confirmation once a connection is disconnected, counting the accounts it unlinked when there
 * were any, and saying the provider keeps sharing until its access is revoked there too
 */
export function describeDisconnected(connection: BankConnection, unlinkedCount: number): string {
  const unlinked = unlinkedCount === 0 ? '' : ` and unlinked ${countNoun(unlinkedCount, 'account')}`
  return `Disconnected from ${connectionName(connection)}${unlinked}. Please also revoke Lumina Finance's access in ${providerSiteName(connection)} to stop sharing data.`
}

/**
 * The confirmation once a connection is added. A claim whose listing of bank accounts failed keeps
 * the connection and lists them in the background, so it says they are on the way rather than none.
 * Going back to an account's link flow, it leaves out where to link them and where they appear
 */
export function describeConnected(connection: BankConnection, backToLinkFlow = false): string {
  const name = connectionName(connection)
  if (connection.discovery_pending && connection.accounts.length === 0) {
    return backToLinkFlow
      ? `Connected to ${name}. Its bank accounts will appear shortly.`
      : `Connected to ${name}. Its bank accounts will appear here shortly.`
  }
  const connected = `Connected to ${name} with ${countNoun(connection.accounts.length, 'bank account')}.`
  return backToLinkFlow ? connected : `${connected} Please link each bank account from the matching account's page.`
}

/**
 * The confirmation once a rejected connection takes a new credential: how many of its accounts resume
 * syncing and how many need their bank account chosen again, or that they wait on a listing still to run
 */
export function describeReconnected(result: ReconnectConnectionResult): string {
  const parts = [`Reconnected to ${connectionName(result.connection)}.`]
  if (result.accounts_pending) {
    parts.push('Linked accounts pick up once their bank accounts are listed again.')
    return parts.join(' ')
  }

  const resumed = result.resumed_account_ids.length
  const chooseAgain = result.choose_again_account_ids.length
  if (resumed > 0) parts.push(`Syncing resumes for ${countNoun(resumed, 'account')}.`)
  if (chooseAgain > 0) {
    parts.push(
      `${countNoun(chooseAgain, 'account')} ${chooseAgain === 1 ? 'needs its bank account' : 'need their bank accounts'} chosen again.`,
    )
  }
  return parts.join(' ')
}

/**
 * What the bank's return did, as the confirmation to toast for a connection added or reconnected, or
 * as the failure to show when the bank didn't approve access and nothing was added
 */
export function describeAuthorizationReturn(
  result: FinishBankAuthorizationResult,
): { toast: string } | { failure: string } {
  if (result.outcome === 'connected' && result.connection) {
    return { toast: describeConnected(result.connection, result.return_account_id !== null) }
  }
  if (result.outcome === 'reconnected' && result.reconnection) {
    return { toast: describeReconnected(result.reconnection) }
  }
  return { failure: "Nothing was added: your bank didn't approve access." }
}

/** What the return page says when it was opened without the bank's answer */
export const INCOMPLETE_AUTHORIZATION_RETURN =
  'This page opens when your bank sends you back. Please start again from Bank connections.'
const ENDED_SIGN_IN_MESSAGE =
  'Nothing was added: this bank sign-in has ended. Please start again from Bank connections.'
const UNANSWERED_FINISH_MESSAGE =
  'Something went wrong. The connection may have been added, so please check Bank connections before you start again.'

/**
 * What the bank sent the user back with, read from the page's query: the state the sign-in started
 * with and either its code or its refusal, or null when the page was opened without them
 */
export function readAuthorizationReturn(
  params: URLSearchParams,
): { state: string; code: string } | { state: string; error: string } | null {
  const state = params.get('state')
  const code = params.get('code')
  const error = params.get('error')
  if (!state) return null
  if (error) return { state, error }
  return code ? { state, code } : null
}

/**
 * What the return page says when finishing the sign-in failed. The server spends a sign-in on its first
 * answer, so a sign-in it no longer knows (404) or couldn't finish at the provider (502) has ended and
 * starts again. Any other refusal says why. An answer that never reached the browser may still have
 * saved the connection, so it says to check first
 */
export function describeAuthorizationFailure(cause: unknown): string {
  if (!isAnsweredByApp(cause)) return UNANSWERED_FINISH_MESSAGE
  return cause.status === 404 || cause.status === 502 ? ENDED_SIGN_IN_MESSAGE : cause.message
}

/**
 * Where the user goes once the bank's return is finished: back to the account's link flow that started
 * the sign-in, on the connection just made, or to Bank connections in Settings
 */
export function authorizationReturnTarget(
  result: FinishBankAuthorizationResult,
): { to: 'link-flow'; accountId: string; connectionId: string | null } | { to: 'settings' } {
  if (!result.return_account_id) return { to: 'settings' }

  // A bank that did not approve access added no connection, and the user starts the link flow's first step again
  const connectionId = result.connection?.id ?? result.reconnection?.connection.id ?? null
  return { to: 'link-flow', accountId: result.return_account_id, connectionId }
}

/** Where a bank sends the user back to. A provider's connect steps may name it as `{redirect_url}` */
export const BANK_AUTHORIZATION_RETURN_PATH = '/settings/bank-authorization'

/**
 * A provider's connect step with the address the bank returns to filled in, for the steps that name it
 *
 * @param origin - The app's own origin. The server derives the same address from it
 */
export function fillRedirectUrl(step: string, origin: string): string {
  return step.replaceAll('{redirect_url}', `${origin}${BANK_AUTHORIZATION_RETURN_PATH}`)
}
