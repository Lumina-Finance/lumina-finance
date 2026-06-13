import { Pencil } from 'lucide-react'

/**
 * Renders the desktop side rail that identifies the modal as an edit workflow
 */
export function EditModalSideRail() {
  return (
    <div
      className="hidden w-12 shrink-0 flex-col items-center justify-between py-5 min-[1050px]:flex"
      style={{
        background: 'var(--app-surface-soft)',
        borderRight: '1px solid var(--app-border)',
        color: 'var(--app-accent)',
      }}
      aria-hidden
    >
      <Pencil size={18} strokeWidth={2} />
      <span className="rotate-180 text-[0.6875rem] font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
        Edit
      </span>
    </div>
  )
}
