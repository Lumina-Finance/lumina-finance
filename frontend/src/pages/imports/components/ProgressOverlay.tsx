import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Variants } from 'motion/react'
import type { ImportOverlayPhase, ImportProgressStep, ImportProgressStepStatus } from '../types'

const OVERLAY_BACKGROUND = 'var(--app-bg)'
const OVERLAY_TEXT = 'var(--app-text)'
const OVERLAY_MUTED_TEXT = 'var(--app-text-muted)'
const OVERLAY_ACCENT = 'var(--app-accent)'
const OVERLAY_SUCCESS = 'var(--app-positive)'
const OVERLAY_ERROR = 'var(--app-negative)'
const OVERLAY_EASE: [number, number, number, number] = [0.25, 0.1, 0.25, 1]
const OVERLAY_SPRING_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]
const overlayButtonClass = 'h-10 w-full box-border whitespace-nowrap leading-none sm:w-auto'

/**
 * How the stage list reads each status, with the accent marking a stage that
 * landed so the three statuses stay apart without relying on motion
 */
const STEP_STATUS_COLOUR: Record<ImportProgressStepStatus, string> = {
  active: OVERLAY_TEXT,
  done: OVERLAY_ACCENT,
  queued: OVERLAY_MUTED_TEXT,
}

const STEP_QUEUED_SCALE = 0.85
const STEP_TRAVEL_DURATION = 0.28

/**
 * How long the strike takes to draw across a finished stage
 *
 * FIREFLY_IMPORT_STAGE_CROSS_OFF_MS is how long the stage is held struck off,
 * so it has to stay clear of this or the line would leave part drawn
 */
const STEP_STRIKE_DURATION = 0.42

const STEP_DOT_STAGGER_SECONDS = 0.12
const STEP_DOT_PULSE_SECONDS = 0.9

/** Where the pulse rests the dots, dim enough to read as trailing off but never as a gap in the text */
const STEP_DOT_DIM_OPACITY = 0.35

const STEP_DOT_SEATS = [0, 1, 2]

const contentVariants: Variants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(5px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      delayChildren: 0.04,
      duration: 0.34,
      ease: OVERLAY_EASE,
      staggerChildren: 0.075,
    },
  },
  exit: {
    opacity: 0,
    y: -12,
    filter: 'blur(5px)',
    transition: { duration: 0.2, ease: 'easeIn' },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.3, ease: OVERLAY_SPRING_EASE },
  },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.16 } },
}

const iconVariants: Variants = {
  hidden: { opacity: 0, rotate: -45, scale: 0.74 },
  visible: {
    opacity: 1,
    rotate: 0,
    scale: 1,
    transition: { duration: 0.32, ease: OVERLAY_SPRING_EASE },
  },
  exit: {
    opacity: 0,
    rotate: 45,
    scale: 0.82,
    transition: { duration: 0.18, ease: 'easeIn' },
  },
}

interface ImportProgressOverlayProps {
  error: string | null
  onDone: () => void
  onReturnToImport: () => void
  phase: ImportOverlayPhase

  /** Stages of a multi-stage import, listed while it runs; single-stage flows leave this unset */
  steps?: ImportProgressStep[]
  summary: string
}

export function ImportProgressOverlay({
  error,
  onDone,
  onReturnToImport,
  phase,
  steps,
  summary,
}: ImportProgressOverlayProps) {
  const open = phase !== 'idle'
  const complete = phase === 'success'
  const failed = phase === 'error'

  // The stage list already names the work in flight, so the title stops
  // repeating the first stage when a flow supplies one
  const title = failed
    ? 'Import failed'
    : complete
      ? 'Import complete'
      : steps
        ? 'Importing'
        : 'Importing transactions'
  const message = failed
    ? error ?? 'Import failed.'
    : complete
      ? summary || 'Your import is complete.'
      : 'Your staged import is being written to the ledger.'
  const messageStyle = complete
    ? {
        color: OVERLAY_SUCCESS,
        maxWidth: 'calc(100vw - 2.5rem)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        width: 'max-content',
      }
    : {
        color: failed ? OVERLAY_ERROR : OVERLAY_MUTED_TEXT,
      }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="import-progress-overlay"
          className="fixed inset-0 z-[90] flex items-center justify-center px-5 py-8"
          style={{ background: OVERLAY_BACKGROUND, color: OVERLAY_TEXT }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          role="dialog"
          aria-modal="true"
          aria-live="polite"
        >
          <motion.div
            className="relative flex w-full max-w-[30rem] flex-col items-center px-4 py-8 text-center"
            initial={{ scale: 0.985 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.985 }}
            transition={{ duration: 0.24, ease: OVERLAY_EASE }}
          >
            <motion.div
              className="mb-5 flex h-20 w-20 items-center justify-center"
              animate={{
                color: failed ? OVERLAY_ERROR : complete ? OVERLAY_SUCCESS : OVERLAY_ACCENT,
              }}
              initial={false}
              transition={{ duration: 0.26, ease: 'easeOut' }}
              aria-hidden
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={failed ? 'error' : complete ? 'success' : 'importing'}
                  className="flex h-full w-full items-center justify-center"
                  variants={iconVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {failed ? (
                    <AlertCircle size={48} strokeWidth={1.9} />
                  ) : complete ? (
                    <CheckCircle2 size={52} strokeWidth={1.85} />
                  ) : (
                    <LoaderCircle size={48} strokeWidth={1.9} className="animate-spin motion-reduce:animate-none" />
                  )}
                </motion.span>
              </AnimatePresence>
            </motion.div>

            <AnimatePresence mode="wait">
              <motion.div
                key={phase}
                className="flex flex-col items-center"
                variants={contentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.p className="text-xl font-semibold" variants={itemVariants}>
                  {title}
                </motion.p>
                <motion.p
                  className="mt-3 max-w-sm text-sm leading-6"
                  style={messageStyle}
                  variants={itemVariants}
                >
                  {message}
                </motion.p>

                {!complete && !failed && steps && steps.length > 0 && (
                  <motion.div className="mt-6 w-full" variants={itemVariants}>
                    <ImportProgressSteps steps={steps} />
                  </motion.div>
                )}

                {complete && (
                  <motion.div
                    className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center"
                    variants={itemVariants}
                  >
                    <button
                      type="button"
                      className={`app-primary-button ${overlayButtonClass} sm:min-w-[7rem]`}
                      onClick={onDone}
                    >
                      Done
                    </button>
                  </motion.div>
                )}

                {failed && (
                  <motion.button
                    type="button"
                    className={`app-secondary-button ${overlayButtonClass} mt-8 sm:min-w-[8.5rem]`}
                    variants={itemVariants}
                    onClick={onReturnToImport}
                  >
                    Back to import
                  </motion.button>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Lists the stages of a multi-stage import as an observation wheel, with the
 * one in progress at full strength in the top seat
 *
 * A stage that has just landed is struck off where it stands, then rides up and
 * out as the queued stage below grows into the seat it left, so a handover
 * reads as the wheel turning a single position
 *
 * The caller decides how long a struck-off stage stays by holding it in the
 * list, and drops it to send it on its way
 *
 * The stages read colour off the overlay palette constants rather than the
 * app text variables directly, since those constants already resolve to the
 * matching theme variables and carry the accent used for a landed stage
 */
function ImportProgressSteps({ steps }: { steps: ImportProgressStep[] }) {
  const shouldReduceMotion = useReducedMotion()
  const queuedScale = shouldReduceMotion ? 1 : STEP_QUEUED_SCALE
  const stepMotion = shouldReduceMotion
    ? {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.12 },
    }
    : {
      initial: { opacity: 0, y: 8, filter: 'blur(3px)' },
      animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
      exit: { opacity: 0, y: -8, filter: 'blur(3px)' },
      transition: { duration: STEP_TRAVEL_DURATION, ease: OVERLAY_EASE },
    }

  return (
    <ul className="flex flex-col items-center gap-1.5 text-sm leading-6">
      {/* popLayout takes the leaving stage out of the flow at once, so the stage below travels up as it fades rather than after */}
      <AnimatePresence initial={false} mode="popLayout">
        {steps.map((step) => (
          <motion.li
            key={step.id}
            className="flex items-center justify-center"
            layout={shouldReduceMotion ? false : 'position'}
            aria-current={step.status === 'active' ? 'step' : undefined}
            initial={stepMotion.initial}
            animate={{ ...stepMotion.animate, color: STEP_STATUS_COLOUR[step.status] }}
            exit={stepMotion.exit}
            transition={stepMotion.transition}
          >
            {/* Scale rides on an inner element so the seat keeps its measured height and the layout travel stays undistorted */}
            <motion.span
              className="flex items-center"
              initial={false}
              animate={{ scale: step.status === 'queued' ? queuedScale : 1 }}
              transition={stepMotion.transition}
            >
              <span className="relative">
                {step.label}
                {step.status === 'done' && (
                  <motion.span
                    className="pointer-events-none absolute inset-x-0 top-1/2 h-px origin-left"
                    style={{ background: 'currentColor' }}
                    initial={{ scaleX: shouldReduceMotion ? 1 : 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: shouldReduceMotion ? 0 : STEP_STRIKE_DURATION, ease: OVERLAY_EASE }}
                    aria-hidden
                  />
                )}
              </span>
              {step.status === 'active' && <ImportProgressStepEllipsis />}
            </motion.span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

/**
 * Trails the stage in progress with three dots that pulse in sequence
 *
 * The dots only say that the stage is still running, so they stay out of the
 * accessibility tree and the label alone is announced
 */
function ImportProgressStepEllipsis() {
  const shouldReduceMotion = useReducedMotion()

  return (
    <span className="ml-1.5 flex items-center gap-1" aria-hidden>
      {STEP_DOT_SEATS.map((seat) => (
        // The mount animation carries the repeating pulse, so initial cannot be
        // waived here or the dots would hold at the opening keyframe forever
        <motion.span
          key={seat}
          className="h-1 w-1 rounded-full"
          style={{ background: 'currentColor' }}
          animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [STEP_DOT_DIM_OPACITY, 1, STEP_DOT_DIM_OPACITY] }}
          transition={shouldReduceMotion
            ? { duration: 0 }
            : {
              delay: seat * STEP_DOT_STAGGER_SECONDS,
              duration: STEP_DOT_PULSE_SECONDS,
              ease: 'easeInOut',
              repeat: Infinity,
            }}
        />
      ))}
    </span>
  )
}
