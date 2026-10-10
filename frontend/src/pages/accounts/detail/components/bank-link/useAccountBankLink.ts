import { useEffect, useState } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import { useAccountBankStatus, useBankProviders } from '@/api/bank-sync'
import { useAuth } from '@/hooks/useAuth'
import { describeBankSync, showsBankSync } from '@/pages/accounts/detail/components/bank-link/status'
import { isOwnPersonalAccount } from '@/utils/bankSync'

// How often the sync label is worded again while the page stays open. It tells times to the minute
// relative to now, such as "Synced 5 minutes ago" or "Next sync in 2 hours", which nothing else
// re-renders the page for while the link stays as it was read
const SYNC_LABEL_CHECK_INTERVAL_MS = 60 * 1000

/**
 * An account's bank link as its page shows it, and whether the page shows bank sync at all. The link
 * is read only for the user's own personal accounts, since the server refuses any other
 *
 * The sync label is worded again each minute, re-rendering the caller only when its words change
 */
export function useAccountBankLink(account: Pick<AccountsOverview, 'id' | 'owner_id' | 'group_id'>) {
  const { user } = useAuth()
  const ownPersonal = user !== null && isOwnPersonalAccount(account, user.id)
  const { data: providers } = useBankProviders()
  const { data: status, error: statusError } = useAccountBankStatus(account.id, ownPersonal)
  const failed = statusError !== null
  const timeZone = user?.tz
  const syncLabel = describeBankSync(ownPersonal, status, failed, timeZone)

  // Holds the words last checked only to compare them, since the label itself is worked out above
  const [, setCheckedWording] = useState(() => JSON.stringify(syncLabel))
  useEffect(() => {
    const intervalId = setInterval(() => {
      setCheckedWording(JSON.stringify(describeBankSync(ownPersonal, status, failed, timeZone)))
    }, SYNC_LABEL_CHECK_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [ownPersonal, status, failed, timeZone])

  return {
    ownPersonal,
    status,
    statusError,
    providers,
    shown: showsBankSync(providers, status),
    syncLabel,
  }
}
