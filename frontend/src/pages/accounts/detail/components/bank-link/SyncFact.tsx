import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { SyncStatusDot } from '@/components/display/SyncStatusDot'
import IconTooltip from '@/components/tooltips/IconTooltip'
import type { BankSyncLabel } from '@/pages/accounts/detail/components/bank-link/status'
import { CONTENT_EASE_CURVE, CONTENT_EASE_MS } from '@/utils/widthEase'

const LABEL_DURATION_S = 0.2

// How far a new label rises into place, and the old one rises away
const LABEL_RISE_PX = 8

type SyncFactProps = {
  /** What the fact is called: Bank sync on the identity card, Status in the bank link section */
  name: string
  sync: BankSyncLabel

  /** Adds the Sync details tooltip after the label */
  showsDetails?: boolean

  /** Makes the value a way into the bank link section */
  onOpen?: () => void

  /** Fades the fact in and out as it comes and goes. Give it a key inside an `AnimatePresence` */
  fades?: boolean
}

/**
 * The label, with a new one sliding in over the old as it leaves. Both share one cell. It eases to
 * the new label's width, so whatever follows glides rather than jumps
 */
function SlidingLabel({ label }: { label: string }) {
  const prefersReducedMotion = useReducedMotion()
  const measureRef = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    // Rounded up, since a width rounded down cuts the last letter short
    if (measureRef.current) setWidth(Math.ceil(measureRef.current.getBoundingClientRect().width))
  }, [label])

  const rise = prefersReducedMotion ? 0 : LABEL_RISE_PX
  const transition = { duration: prefersReducedMotion ? 0 : LABEL_DURATION_S, ease: CONTENT_EASE_CURVE }
  return (
    <>
      <span ref={measureRef} aria-hidden className="pointer-events-none invisible absolute whitespace-nowrap">
        {label}
      </span>
      <motion.span
        className="grid min-w-0 max-w-full overflow-hidden"
        initial={false}
        animate={width === null ? undefined : { width }}
        transition={transition}
      >
        <AnimatePresence initial={false}>
          <motion.span
            key={label}
            className="min-w-0 truncate whitespace-nowrap"
            style={{ gridArea: '1 / 1' }}
            initial={{ opacity: 0, y: rise }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -rise }}
            transition={transition}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </>
  )
}

/**
 * The account's bank sync as one of its facts, across the full width, set out like the facts beside
 * it apart from the dot
 */
export function SyncFact({ name, sync, showsDetails = false, onOpen, fades = false }: SyncFactProps) {
  const prefersReducedMotion = useReducedMotion()
  // Played by the fact's own element, so a list of facts holds only the fact's own div
  const fadeProps = fades
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: prefersReducedMotion ? 0 : CONTENT_EASE_MS / 1000, ease: CONTENT_EASE_CURVE },
      }
    : {}
  // A label ending in an abbreviation, such as a retry at 10:12 p.m., already ends its sentence
  const sentence = sync.label.endsWith('.') ? sync.label : `${sync.label}.`
  const value = (
    <>
      <SyncStatusDot tone={sync.tone} pulse={sync.pulse} />
      <SlidingLabel label={sync.label} />
    </>
  )

  return (
    <motion.div className="col-span-2 min-w-0" {...fadeProps}>
      <dt className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
        {name}
      </dt>
      <dd className="relative mt-0.5 flex min-w-0 items-center gap-2 text-sm font-medium">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${name}: ${sentence} Open bank link`}
            className="group underline flex max-w-full items-center gap-2 rounded-sm text-left [--link-underline-start:16px] [--link-underline-end:14.67px]"
          >
            {value}
            {/* Shows at rest that the status opens the bank link, as the hover underline only shows it to a pointer.
                The icon draws 5.33px in from its box, so pulling the box back 9.33px from the row's 8px gap puts the
                drawn chevron 4px from the label's end. The underline's end offset is the box's 16px less the 1.33px
                it then overlaps the label's box. Drawn 1px low, so it centres on the label's lowercase letters
                and not its capitals. Nudges right under the pointer or keyboard focus, and holds still under reduced motion */}
            <ChevronRight
              aria-hidden
              className="relative top-px -ml-[9.33px] size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-focus-visible:translate-x-0"
              style={{ color: 'var(--app-text-subtle)' }}
            />
          </button>
        ) : (
          <span className="flex min-w-0 max-w-full items-center gap-2">{value}</span>
        )}
        {showsDetails && sync.details.length > 0 && (
          <IconTooltip
            label="Sync details"
            placement="bottom"
            widthClassName="w-max max-w-52"
            avoidsLoneWord
            picksSideOnPress
          >
            <span className="block space-y-1">
              {sync.details.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          </IconTooltip>
        )}
      </dd>
    </motion.div>
  )
}
