import { Check } from 'lucide-react'

type MobileOptionRowProps = {
  label: string
  icon?: string | null
  selected: boolean
  highlighted?: boolean
  onClick: () => void
}

/**
 * Renders one selectable option row inside the mobile account filter sheet
 */
export function MobileOptionRow({
  label,
  icon,
  selected,
  highlighted = false,
  onClick,
}: MobileOptionRowProps) {
  return (
    <button
      type="button"
      className={`flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-[var(--app-surface-soft)] ${
        highlighted ? 'bg-[var(--app-surface-soft)]' : ''
      }`}
      style={{
        color: selected ? 'var(--app-accent)' : 'var(--app-text)',
        fontWeight: selected ? 600 : 400,
      }}
      onClick={onClick}
    >
      {icon && <span className="shrink-0 text-base leading-none" aria-hidden>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check size={16} className="shrink-0" aria-hidden />}
    </button>
  )
}
