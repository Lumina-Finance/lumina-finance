import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

interface InfoCalloutProps {
  children: ReactNode;
}

/**
 * Neutral banner with an info icon, used to give guidance that is not a warning or an error
 */
export function InfoCallout({ children }: InfoCalloutProps) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg p-3 text-sm"
      style={{ backgroundColor: 'var(--app-accent-soft)', color: 'var(--app-text)' }}
      role="note"
    >
      <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: 'var(--app-accent)' }} aria-hidden />
      <span>{children}</span>
    </div>
  );
}
