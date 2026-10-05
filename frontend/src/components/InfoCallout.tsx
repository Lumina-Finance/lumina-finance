import { Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Guidance that is not a warning or an error, something stopped until the user fixes it, or
 * something waiting on the user's review, in the status dot's colours
 */
type InfoCalloutTone = 'info' | 'stopped' | 'review';

const TONE_COLORS: Record<InfoCalloutTone, { background: string; icon: string }> = {
  info: { background: 'var(--app-accent-soft)', icon: 'var(--app-accent)' },
  stopped: { background: 'var(--app-negative-soft)', icon: 'var(--app-negative)' },
  review: { background: 'var(--app-warning-soft)', icon: 'var(--app-warning-text)' },
};

interface InfoCalloutProps {
  children: ReactNode;
  tone?: InfoCalloutTone;

  /** Stands in for the info icon */
  icon?: LucideIcon;

  /** What the user does about it, beside the text, or on its own row on a phone */
  action?: ReactNode;
}

/**
 * Banner with an icon, neutral unless a tone says otherwise. Only the icon takes the tone's colour, so
 * the text stays as readable as the text around it
 */
export function InfoCallout({ children, tone = 'info', icon: Icon = Info, action }: InfoCalloutProps) {
  const colors = TONE_COLORS[tone];
  const message = (
    <>
      <Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: colors.icon }} aria-hidden />
      <span>{children}</span>
    </>
  );

  return (
    <div
      className={`flex rounded-lg p-3 text-sm ${action ? 'flex-col gap-3 sm:flex-row sm:items-center' : 'items-start gap-2'}`}
      style={{ backgroundColor: colors.background, color: 'var(--app-text)' }}
      role="note"
    >
      {action
        ? (
            <>
              <p className="flex min-w-0 flex-1 items-start gap-2">{message}</p>
              <div className="shrink-0">{action}</div>
            </>
          )
        : message}
    </div>
  );
}
