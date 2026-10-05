import type { AccountsOverview } from '@/api/accounts'
import { useAccountBankStatus, useBankProviders } from '@/api/bank-sync'
import { useAuth } from '@/hooks/useAuth'
import { describeBankSync } from '@/pages/accounts/detail/components/bank-link/status'
import { isOwnPersonalAccount } from '@/utils/bankSync'

/**
 * An account's bank link as its page shows it, and whether the page shows bank sync at all
 *
 * Bank sync shows for a user the bank-linking check allows, on a deployment with a provider, and for
 * an account already linked whatever the check says, so its link can still be seen and ended. Only
 * the user's own personal accounts are read, since the server refuses any other
 */
export function useAccountBankLink(account: Pick<AccountsOverview, 'id' | 'owner_id' | 'group_id'>) {
  const { user } = useAuth()
  const ownPersonal = user !== null && isOwnPersonalAccount(account, user.id)
  const { data: providers } = useBankProviders()
  const { data: status, error: statusError } = useAccountBankStatus(account.id, ownPersonal)
  const offered = providers !== undefined && providers.may_link && providers.providers.length > 0

  return {
    ownPersonal,
    status,
    statusError,
    providers,
    shown: offered || Boolean(status?.link),
    syncLabel: describeBankSync(ownPersonal, status, statusError !== null),
  }
}
