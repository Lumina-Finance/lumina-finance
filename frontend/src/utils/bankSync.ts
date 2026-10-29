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
 * Names a connection by the user's nickname for it, or by its provider when it has none
 */
export function connectionName(connection: Pick<BankConnection, 'nickname' | 'provider_name'>): string {
  return connection.nickname ?? connection.provider_name
}

/**
 * Names where the user fixes a connection's bank logins and setup tokens, which for SimpleFIN is its
 * Bridge site
 */
export function providerSite(connection: Pick<BankConnection, 'provider' | 'provider_name'>): string {
  return connection.provider === 'simplefin' ? `${connection.provider_name} Bridge` : connection.provider_name
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
  return `${connectionName(connection)} disconnected.${unlinked} To stop ${providerSite(connection)} sharing data at all, revoke Lumina Finance's access there too.`
}
