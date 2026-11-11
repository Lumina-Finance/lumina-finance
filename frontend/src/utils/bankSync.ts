import type { AccountsOverview } from '@/api/accounts'
import type { BankConnection } from '@/api/bank-sync'

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
  "This provider is no longer available on this server, so this connection doesn't sync. Disconnecting keeps everything already imported."

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
 * The confirmation once a connection is disconnected, counting the accounts it unlinked when there
 * were any, and saying the provider keeps sharing until its access is revoked there too
 */
export function describeDisconnected(connection: BankConnection, unlinkedCount: number): string {
  const unlinked = unlinkedCount === 0 ? '' : ` ${countNoun(unlinkedCount, 'account')} unlinked.`
  return `${connectionName(connection)} disconnected.${unlinked} Please also revoke Lumina Finance's access in ${providerSiteName(connection)} to stop sharing data.`
}
