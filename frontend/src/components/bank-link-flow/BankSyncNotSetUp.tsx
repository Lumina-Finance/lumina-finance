import { Link } from 'react-router'
import { BANK_CONNECTIONS_SETTINGS_PATH, BANK_SYNC_NOT_SET_UP_REASON } from '@/components/bank-link-flow/constants'

type BankConnectionsLinkProps = {
  /** Runs as the link is followed, for a dialogue that should close on the way to Settings */
  onNavigate?: () => void
}

/** A link to where connections are added, in the app's inline link style */
export function BankConnectionsLink({ onNavigate }: BankConnectionsLinkProps) {
  return (
    <Link
      to={BANK_CONNECTIONS_SETTINGS_PATH}
      className="app-inline-link font-medium whitespace-nowrap underline underline-offset-2 transition-control"
      style={{ color: 'var(--app-accent)' }}
      onClick={onNavigate}
    >
      Open bank connections
    </Link>
  )
}

type BankSyncNotSetUpProps = BankConnectionsLinkProps & {
  /** The id the held-back button names as its description, so the tooltip and the page say the same text */
  id: string
  className?: string
}

/**
 * Prints why a bank action is held back while no worker has checked in, with the way to Settings. It
 * stays on the page, since nothing about it passes until someone sets bank sync up
 */
export function BankSyncNotSetUp({ id, className, onNavigate }: BankSyncNotSetUpProps) {
  return (
    <p id={id} className={className ? `text-sm ${className}` : 'text-sm'} style={{ color: 'var(--app-text-muted)' }}>
      {BANK_SYNC_NOT_SET_UP_REASON} <BankConnectionsLink onNavigate={onNavigate} />
    </p>
  )
}
