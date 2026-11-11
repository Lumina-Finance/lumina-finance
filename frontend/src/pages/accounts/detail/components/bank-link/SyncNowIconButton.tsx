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
 * Sync now as an icon beside the identity card's Bank sync label, saying what it does on hover and
 * keyboard focus. Whatever holds the sync back, a spent request budget included, fades it with its
 * reason in the tooltip, as the Sync now button in the bank link section does. The icon spins while the
 * sync starts, and a press meanwhile does nothing
 *
 * It has no box of its own, since a framed square beside a small label reads as a separate control.
 * Hovering brightens the arrows and turns them half a circle, which brings them back to the same shape,
 * and leaving turns them back. A held-back icon stays still, and reduced motion keeps only the colour
 */
export function SyncNowIconButton({ link, connection, providers }: SyncNowIconButtonProps) {
  const { status, block, busy, syncNow } = useSyncNow(link, connection, providers)
  const hint = HINTS[status as keyof typeof HINTS] ?? HINTS.idle

  return (
    <DisabledReasonButton
      // 24px to press, pulled in above and below so the label's row keeps its height
      className="group -my-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--app-text-muted)] transition-control hover:text-[var(--app-text)] focus-visible:text-[var(--app-text)] motion-reduce:transition-none aria-disabled:cursor-not-allowed aria-disabled:text-[color-mix(in_srgb,var(--app-text-muted)_50%,transparent)]"
      aria-label={hint}
      hint={hint}
      disabledReason={block}
      onClick={busy ? undefined : syncNow}
    >
      {/* The turn sits on a wrapper, so the spin while starting runs on the icon without the two fighting */}
      <span className="inline-flex transition-transform duration-500 ease-(--app-ease-curve) group-hover:rotate-180 group-focus-visible:rotate-180 group-aria-disabled:rotate-0 motion-reduce:transition-none motion-reduce:group-hover:rotate-0 motion-reduce:group-focus-visible:rotate-0">
        <RefreshCw size={12} aria-hidden className={busy ? 'animate-spin motion-reduce:animate-none' : undefined} />
      </span>
    </DisabledReasonButton>
  )
}
