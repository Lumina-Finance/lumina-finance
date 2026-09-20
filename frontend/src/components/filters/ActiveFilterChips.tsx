import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { FILTER_GLASS_SPRING } from '@/components/list-controls/toolbarStyles'

type FilterChip = {
  key: string
  label: string
  onRemove: () => void
}

/** Lets selected filters wrap naturally so their pane grows with them */
export function ActiveFilterChips({ chips }: { chips: FilterChip[] }) {
  return (
    <div
        role={chips.length ? 'group' : undefined}
        aria-label={chips.length ? 'Selected filters' : undefined}
        className="mt-3 flex min-h-[1.5rem] shrink-0 flex-wrap items-center gap-1.5 border-t px-0.5 pt-2.5"
        style={{ borderColor: 'var(--app-input-border)' }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {chips.length === 0 ? (
            <motion.span
              key="empty"
              layout
              className="text-xs"
              style={{ color: 'var(--app-text-subtle)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={FILTER_GLASS_SPRING}
            >
              No filters applied
            </motion.span>
          ) : chips.map((chip) => (
            <motion.span
              key={chip.key}
              layout
              className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[11px]"
              style={{ background: 'color-mix(in srgb, var(--app-accent) 14%, transparent)', color: 'var(--app-accent)' }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={FILTER_GLASS_SPRING}
            >
              <span className="min-w-0 truncate">{chip.label}</span>
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                className="flex shrink-0 opacity-70 hover:opacity-100"
                onClick={chip.onRemove}
              >
                <X size={13} aria-hidden />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
    </div>
  )
}
