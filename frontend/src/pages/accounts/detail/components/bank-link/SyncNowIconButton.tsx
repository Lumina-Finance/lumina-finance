import { RefreshCw } from 'lucide-react'
import type { BankConnection, BankLink, BankProvidersResponse } from '@/api/bank-sync'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useSyncNow } from '@/pages/accounts/detail/components/bank-link/useSyncNow'

const HINTS = { idle: 'Sync now', loading: 'Starting sync', success: 'Sync started' } as const

type SyncNowIconButtonProps = {
  link: BankLink
  connection: BankConnection | undefined
  providers: BankProvidersResponse | undefined
}

/**
 * Sync now as an icon beside the identity card's Bank sync label, drawn as the dashboard's switch
 * buttons are, saying what it does on hover and keyboard focus. Whatever holds the sync back, a spent
 * request budget included, fades it with its reason in the tooltip, as the Sync now button in the bank
 * link section does. The icon turns while the sync starts, and a press meanwhile does nothing
 */
export function SyncNowIconButton({ link, connection, providers }: SyncNowIconButtonProps) {
  const { status, block, busy, syncNow } = useSyncNow(link, connection, providers)
  const hint = HINTS[status as keyof typeof HINTS] ?? HINTS.idle

  return (
    <DisabledReasonButton
      className="app-icon-button -my-2"
      aria-label={hint}
      hint={hint}
      disabledReason={block}
      onClick={busy ? undefined : syncNow}
    >
      <RefreshCw size={12} aria-hidden className={busy ? 'animate-spin motion-reduce:animate-none' : undefined} />
    </DisabledReasonButton>
  )
}
