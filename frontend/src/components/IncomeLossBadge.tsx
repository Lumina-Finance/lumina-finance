import { ArrowDownLeft } from 'lucide-react'

export function IncomeLossBadge() {
  return (
    <span
      className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded border px-1 text-[0.625rem] font-semibold leading-none"
      style={{
        background: 'var(--app-negative-soft)',
        borderColor: 'var(--app-negative-border)',
        color: 'var(--app-negative)',
      }}
      title="Income category counted as expense"
    >
      <ArrowDownLeft size={10} strokeWidth={2.2} aria-hidden />
      Income loss
    </span>
  )
}
