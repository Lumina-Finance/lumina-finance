import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

interface WarningCalloutProps {
  children: ReactNode;
}

/**
 * Red caution banner with an alert icon, used to flag irreversible or lockout-risk two-factor actions
 * The text is sized to match the modal body copy while staying in the warning colour
 */
export function WarningCallout({ children }: WarningCalloutProps) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg p-3 text-sm"
      style={{ backgroundColor: 'var(--app-negative-soft)', color: 'var(--app-negative)' }}
    >
      <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
