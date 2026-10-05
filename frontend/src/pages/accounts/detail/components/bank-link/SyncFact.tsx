import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { SyncStatusDot } from '@/components/display/SyncStatusDot'
import type { BankSyncLabel } from '@/pages/accounts/detail/components/bank-link/status'

type SyncFactProps = {
  /** What the fact is called: Bank sync on the identity card, Status in the bank link section */
  name: string
  sync: BankSyncLabel

  /** Makes the value a way into the bank link section */
  onOpen?: () => void
}

/**
 * The account's bank sync as one of its facts, across the full width, set out like the facts beside
 * it apart from the dot, and a new label fading in over the old one
 */
export function SyncFact({ name, sync, onOpen }: SyncFactProps) {
  const prefersReducedMotion = useReducedMotion()
  const value = (
    <>
      <SyncStatusDot tone={sync.tone} pulse={sync.pulse} />
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={sync.label}
          className={`min-w-0 truncate ${onOpen ? 'underline decoration-transparent underline-offset-2 transition-[text-decoration-color] duration-150 group-hover:decoration-current' : ''}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
        >
          {sync.label}
        </motion.span>
      </AnimatePresence>
    </>
  )

  return (
    <div className="col-span-2 min-w-0">
      <dt className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>{name}</dt>
      <dd className="mt-0.5 min-w-0 text-sm font-medium">
        {onOpen
          ? (
              <button
                type="button"
                onClick={onOpen}
                aria-label={`${name}: ${sync.label}. Open bank link`}
                className="group flex max-w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
              >
                {value}
              </button>
            )
          : <span className="flex max-w-full items-center gap-2">{value}</span>}
      </dd>
    </div>
  )
}
