import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, X } from 'lucide-react'

const EASE = [0.25, 0.1, 0.25, 1] as const

interface Props {
  label: string                                     // shown when no value selected
  selectedLabel?: string | null                     // shown when value is selected
  onClear?: () => void                              // if set + selectedLabel, shows X to clear
  children: (close: () => void) => ReactNode        // popover content
  panelClassName?: string                           // override popover sizing/layout
}

export default function FilterChip({ label, selectedLabel, onClear, children, panelClassName }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = !!selectedLabel

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // defer registration so the click that opened doesn't immediately close it
    const t = setTimeout(() => window.addEventListener('pointerdown', onPointer), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-medium transition-colors duration-150"
        style={{
          background: active ? 'var(--app-accent-soft)' : 'transparent',
          color: active ? 'var(--app-accent)' : 'var(--app-text-muted)',
          border: `1px solid ${active ? 'var(--app-accent-border)' : 'var(--app-border)'}`,
          fontSize: '0.9375rem',
        }}
      >
        <span>{selectedLabel ?? label}</span>
        {active && onClear ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label.toLowerCase()} filter`}
            onClick={(e) => { e.stopPropagation(); onClear() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClear() }
            }}
            className="ml-0.5 grid place-items-center rounded-full"
            style={{ width: 16, height: 16 }}
          >
            <X size={12} aria-hidden />
          </span>
        ) : (
          <ChevronDown size={14} aria-hidden style={{ opacity: 0.7 }} />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className={`absolute left-0 top-full mt-2 z-30 rounded-xl ${panelClassName ?? 'w-72'}`}
            style={{
              background: 'var(--app-bg)',
              border: '1px solid var(--app-border-strong)',
              boxShadow: 'var(--app-shadow-soft)',
            }}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: EASE }}
          >
            <div>{children(() => setOpen(false))}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
