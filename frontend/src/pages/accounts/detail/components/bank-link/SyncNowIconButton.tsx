import { RefreshCw } from 'lucide-react'
import type { BankConnection, BankLink, BankProvidersResponse } from '@/api/bank-sync'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useSyncNow } from '@/pages/accounts/detail/components/bank-link/useSyncNow'

const HINTS = { idle: 'Sync now', loading: 'Starting sync', success: 'Sync underway' } as const

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
      // The box hugs the 12px icon, so the focus ring, drawn against it, stays clear of the label. With
      // nothing but the icon inside, the box's baseline is its bottom, so the row stands it on the label's
      // baseline. Lowering it by half of what the icon is taller than the capitals then centres the arrows
      // on them in whatever font the label takes. A layer reaching 6px past the box at either side and 2px
      // above and below widens the press to 24px but keeps it within the label's line, clear of the sync
      // status under it. The drawn arrows sit 1.5px inside the icon, so pulling the box back 1.5px over the
      // row's 4px gap leaves them 4px after the label, as the chevron after the sync status sits
      className="group relative -ml-[1.5px] inline-flex size-3 shrink-0 translate-y-[calc((0.75rem_-_1cap)/2)] cursor-pointer items-center justify-center rounded-sm text-[var(--app-text-muted)] transition-control before:absolute before:-inset-x-1.5 before:-inset-y-0.5 before:content-[''] hover:text-[var(--app-text)] focus-visible:text-[var(--app-text)] focus-visible:outline-offset-0 motion-reduce:transition-none aria-disabled:cursor-not-allowed aria-disabled:text-[color-mix(in_srgb,var(--app-text-muted)_50%,transparent)]"
      aria-label={hint}
      hint={hint}
      disabledReason={block}
      onClick={busy ? undefined : syncNow}
    >
      {/* The turn sits on a wrapper, so the spin while starting runs on the icon without the two fighting */}
      <span className="inline-flex transition-transform group-hover:rotate-180 group-focus-visible:rotate-180 group-aria-disabled:rotate-0 motion-reduce:transition-none motion-reduce:group-hover:rotate-0 motion-reduce:group-focus-visible:rotate-0">
        <RefreshCw size={12} aria-hidden className={busy ? 'animate-spin motion-reduce:animate-none' : undefined} />
      </span>
    </DisabledReasonButton>
  )
}
