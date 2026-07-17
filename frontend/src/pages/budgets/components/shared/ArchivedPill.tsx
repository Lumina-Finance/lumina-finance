import { EyeOff } from 'lucide-react'

/**
 * Renders the pill marking a budget as archived, shared by the budget card and details sidebar
 */
export default function ArchivedPill({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium ${className}`}
      style={{ background: 'var(--app-accent-soft)', color: 'var(--app-text-muted)' }}
    >
      <EyeOff size={14} aria-hidden />
      Archived
    </span>
  )
}
