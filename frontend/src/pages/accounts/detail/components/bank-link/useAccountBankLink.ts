import type { AccountsOverview } from '@/api/accounts'
import { useAccountBankStatus, useBankProviders } from '@/api/bank-sync'
import { useAuth } from '@/hooks/useAuth'
import { describeBankSync, showsBankSync } from '@/pages/accounts/detail/components/bank-link/status'
import { isOwnPersonalAccount } from '@/utils/bankSync'

/**
 * An account's bank link as its page shows it, and whether the page shows bank sync at all. The link
 * is read only for the user's own personal accounts, since the server refuses any other
 */
export function useAccountBankLink(account: Pick<AccountsOverview, 'id' | 'owner_id' | 'group_id'>) {
  const { user } = useAuth()
  const ownPersonal = user !== null && isOwnPersonalAccount(account, user.id)
  const { data: providers } = useBankProviders()
  const { data: status, error: statusError } = useAccountBankStatus(account.id, ownPersonal)

  return {
    ownPersonal,
    status,
    statusError,
    providers,
    shown: showsBankSync(providers, status),
    syncLabel: describeBankSync(ownPersonal, status, statusError !== null, user?.tz),
  }
}
