import { Info, X, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { PendingLabel } from '@/components/loading/PendingLabel'

/**
 * Guidance that is not a warning or an error, something stopped until the user fixes it, or
 * something waiting on the user's review, in the status dot's colours
 */
type InfoCalloutTone = 'info' | 'stopped' | 'review'

const TONE_COLORS: Record<InfoCalloutTone, { background: string; icon: string }> = {
  info: { background: 'var(--app-accent-soft)', icon: 'var(--app-accent)' },
  stopped: { background: 'var(--app-negative-soft)', icon: 'var(--app-negative)' },
  review: { background: 'var(--app-warning-soft)', icon: 'var(--app-warning-text)' },
}

type InfoCalloutProps = {
  children: ReactNode
  tone?: InfoCalloutTone

  /** Stands in for the info icon */
  icon?: LucideIcon

  /** What the user does about it, beside the text, or on its own row on a phone. A titled callout has none */
  action?: ReactNode

  /** What happened, in a few words, with the text under it as its detail */
  title?: string

  /** Closes a titled callout from the corner beside its title */
  onDismiss?: () => void

  /** Whether the close is running, while its control spins, keeps its focus and takes no other press */
  dismissing?: boolean
}

/**
 * Banner with an icon, neutral unless a tone says otherwise. Only the icon takes the tone's colour, so
 * the text stays as readable as the text around it. A titled one sets its text under the bold title,
 * in the same colour, since muted text on a tone's fill reads too faintly in the dark theme, and can
 * close from its corner
 */
export function InfoCallout({
  children,
  tone = 'info',
  icon: Icon = Info,
  action,
  title,
  onDismiss,
  dismissing = false,
}: InfoCalloutProps) {
  const titleId = useId()
  const colors = TONE_COLORS[tone]
  const icon = <Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: colors.icon }} aria-hidden />

  if (title !== undefined) {
    return (
      <div
        className="flex items-start gap-2 rounded-lg p-3 text-sm"
        style={{ backgroundColor: colors.background, color: 'var(--app-text)' }}
        role="note"
        aria-labelledby={titleId}
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p id={titleId} className="font-semibold">
              {title}
            </p>
            {onDismiss && (
              <button
                type="button"
                className="app-icon-button -mr-1 -mt-0.5 h-6 w-6 shrink-0"
                aria-label="Dismiss"
                aria-describedby={titleId}
                aria-busy={dismissing}
                onClick={dismissing ? undefined : onDismiss}
              >
                <PendingLabel pending={dismissing} name="Dismiss">
                  <X size={14} aria-hidden />
                </PendingLabel>
              </button>
            )}
          </div>
          <p className="mt-0.5">{children}</p>
        </div>
      </div>
    )
  }

  const message = (
    <>
      {icon}
      <span>{children}</span>
    </>
  )

  return (
    <div
      className={`flex rounded-lg p-3 text-sm ${action ? 'flex-col gap-3 sm:flex-row sm:items-center' : 'items-start gap-2'}`}
      style={{ backgroundColor: colors.background, color: 'var(--app-text)' }}
      role="note"
    >
      {action ? (
        <>
          <p className="flex min-w-0 flex-1 items-start gap-2">{message}</p>
          <div className="shrink-0">{action}</div>
        </>
      ) : (
        message
      )}
    </div>
  )
}
