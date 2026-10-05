import type { Account } from '@/api/accounts'
import { SyncFact } from '@/pages/accounts/detail/components/bank-link/SyncFact'
import { useAccountBankLink } from '@/pages/accounts/detail/components/bank-link/useAccountBankLink'

/**
 * The identity card's Bank sync fact, a way into the edit modal's Bank link section, where everything
 * about the link is managed. Left out where the page shows no bank sync
 */
export function BankSyncFact({ account, onOpen }: { account: Account; onOpen: () => void }) {
  const { shown, syncLabel } = useAccountBankLink(account)
  if (!shown) return null
  return <SyncFact name="Bank sync" sync={syncLabel} onOpen={onOpen} />
}
