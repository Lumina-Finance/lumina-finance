import { AlertCircle, CheckCircle2, CircleStop, LoaderCircle } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Variants } from 'motion/react'
import type { ImportOverlayPhase, ImportProgressStep, ImportProgressStepStatus } from '@/pages/imports/types'

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

const STEP_TRAVEL_DURATION = 0.28

/**
 * How long the strike takes to draw across a finished stage
 *
 * FIREFLY_IMPORT_STAGE_CROSS_OFF_MS is how long the stage is held struck off,
 * so it has to stay clear of this or the line would leave part drawn
 */
const STEP_STRIKE_DURATION = 0.42

const STEP_DOT_STAGGER_SECONDS = 0.12
const STEP_DOT_JUMP_SECONDS = 0.45

/** Pause between hops so the wave reads as a cycle rather than a constant bounce */
const STEP_DOT_REPEAT_DELAY_SECONDS = 0.4

/** Length of one hop-and-rest cycle, matching the import-stage-dot-hop keyframes in tailwind.css */
const STEP_DOT_CYCLE_SECONDS = STEP_DOT_JUMP_SECONDS + STEP_DOT_REPEAT_DELAY_SECONDS

const STEP_DOT_SEATS = [0, 1, 2]

/**
 * Length of one full dot wave in milliseconds, from the last dot's stagger
 * through its hop and the rest that follows
 *
 * Stage floors elsewhere key off this so a stage is never struck off before
 * its dots finish a full cycle
 */
export const STEP_DOT_WAVE_MS =
  ((STEP_DOT_SEATS.length - 1) * STEP_DOT_STAGGER_SECONDS + STEP_DOT_CYCLE_SECONDS) * 1000

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

// Only ever put on an element the app does not style with a CSS transition, which is why every
// button here is a plain one inside a wrapper carrying these rather than carrying them itself. The
// app button classes transition every property, so a transition would chase the opacity and
// transform written here each frame and settle again once the animation stopped, which reads as
// the button flickering as it lands
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

  /** Reports that the overlay has finished fading, which is when the page under it is reachable again */
  onClosed?: () => void

  /** Stops the import, offered only while there is still a request to give up on */
  onCancel?: () => void

  /** Runs a failed import again without re-uploading it, offered only when that could work */
  onRetry?: () => void
  phase: ImportOverlayPhase

  /** Stages of a multi-stage import, listed while it runs; single-stage flows leave this unset */
  steps?: ImportProgressStep[]
  summary: string
}

/**
 * Full-screen overlay shown while an import is running, and after it finishes, fails or is stopped
 *
 * The title and message read off the phase and, when supplied, the multi-stage step list rather than
 * a fixed set of copy, so a single-stage commit collapses to a plain spinner while a multi-stage one
 * shows the stage wheel underneath it
 */
export function ImportProgressOverlay({
  error,
  onDone,
  onReturnToImport,
  onClosed,
  onCancel,
  onRetry,
  phase,
  steps,
  summary,
}: ImportProgressOverlayProps) {
  const open = phase !== 'idle'
  const complete = phase === 'success'
  const failed = phase === 'error'

  // An import the user stopped is not one that went wrong, so it is told apart from a failure
  // everywhere the two would otherwise read the same: the title, the icon and the message colour
  const stopped = phase === 'cancelled'
  const ended = failed || stopped

  // The stage list already says what is in flight, so the title stops
  // repeating the first stage when a flow supplies one
  const title = stopped
    ? 'Import stopped'
    : failed
      ? 'Import failed'
      : complete
        ? 'Import complete'
        : steps
          ? 'Importing'
          : 'Importing transactions'
  const message = ended
    ? error ?? (stopped ? 'Import stopped.' : 'Import failed.')
    : complete
      ? summary || 'Your import is complete.'
      : 'Your import is being added to your ledger, and nothing is saved until it finishes.'
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
    <AnimatePresence onExitComplete={onClosed}>
      {open && (
        // A closed overlay is still on screen for as long as it takes to fade, and its buttons go
        // on carrying the handlers from before it closed, so it stops taking pointer input at once.
        // Declared on both sides so the property has a value to return to, rather than leaving that
        // to how a value dropped from the target is treated
        <motion.div
          key="import-progress-overlay"
          className="fixed inset-0 z-[90] flex items-center justify-center px-5 py-8"
          style={{ background: OVERLAY_BACKGROUND, color: OVERLAY_TEXT }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, pointerEvents: 'auto' }}
          exit={{ opacity: 0, pointerEvents: 'none' }}
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
                color: stopped
                  ? OVERLAY_MUTED_TEXT
                  : failed ? OVERLAY_ERROR : complete ? OVERLAY_SUCCESS : OVERLAY_ACCENT,
              }}
              initial={false}
              transition={{ duration: 0.26, ease: 'easeOut' }}
              aria-hidden
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={stopped ? 'cancelled' : failed ? 'error' : complete ? 'success' : 'importing'}
                  className="flex h-full w-full items-center justify-center"
                  variants={iconVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {stopped ? (
                    <CircleStop size={48} strokeWidth={1.9} />
                  ) : failed ? (
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

                {!complete && !ended && steps && steps.length > 0 && (
                  <motion.div className="mt-6 w-full" variants={itemVariants}>
                    <ImportProgressSteps steps={steps} />
                  </motion.div>
                )}

                {/* An import with no way out leaves this overlay up until the connection gives out,
                    so it is offered here for as long as there is a request to give up on, and goes
                    once that request has settled. Escape is deliberately not wired to it, since
                    stopping an import is not something to do by brushing a key */}
                {!complete && !ended && onCancel && (
                  <motion.div className="mt-8 flex w-full justify-center" variants={itemVariants}>
                    <button
                      type="button"
                      className={`app-secondary-button ${overlayButtonClass} sm:min-w-[8.5rem]`}
                      onClick={onCancel}
                    >
                      Stop import
                    </button>
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

                {ended && (
                  <motion.div
                    className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center"
                    variants={itemVariants}
                  >
                    {/* Offered only where the file is still staged and sending it again could
                        land, so a refusal of the file itself does not invite a pointless repeat */}
                    {onRetry && (
                      <button
                        type="button"
                        className={`app-primary-button ${overlayButtonClass} sm:min-w-[7rem]`}
                        onClick={onRetry}
                      >
                        Try again
                      </button>
                    )}
                    <button
                      type="button"
                      className={`app-secondary-button ${overlayButtonClass} sm:min-w-[8.5rem]`}
                      onClick={onReturnToImport}
                    >
                      Back to import
                    </button>
                  </motion.div>
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
 * A stage that has just landed is struck off where it stands, then fades away
 * in place as the queued stage below moves up into the seat it left, so a
 * handover reads as the wheel turning a single position
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
      exit: { opacity: 0 },
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
            <span className="flex items-center">
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
              {step.status !== 'queued' && <ImportProgressStepEllipsis running={step.status === 'active'} />}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

interface ImportProgressStepEllipsisProps {
  /** Whether the trailed stage is still in progress, versus already struck off */
  running: boolean
}

/**
 * Trails the active or just-struck stage with three dots that hop in sequence
 *
 * The dots stay through the strike so the handover keeps its rhythm instead of
 * cutting out, then come to rest once the stage lands, and ride out with the
 * stage when it leaves the list, while a queued stage never carries them. They
 * carry no status of their own, so they stay out of the accessibility tree and
 * the label alone is announced
 */
function ImportProgressStepEllipsis({ running }: ImportProgressStepEllipsisProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <span className="ml-1.5 flex items-center gap-1 self-end pb-[5px]" aria-hidden>
      {STEP_DOT_SEATS.map((seat) => (
        // The stage list mounts each stage with entrance animations suppressed
        // (AnimatePresence initial={false}), which would swallow a Motion-driven
        // repeating animation, so the hop runs in CSS instead, the same way the
        // spinner does
        <span
          key={seat}
          className="h-[2px] w-[2px] rounded-full"
          style={{
            background: 'currentColor',
            ...(shouldReduceMotion || !running
              ? {}
              : {
                animation: `import-stage-dot-hop ${STEP_DOT_CYCLE_SECONDS}s ease-in-out infinite`,
                animationDelay: `${seat * STEP_DOT_STAGGER_SECONDS}s`,
              }),
          }}
        />
      ))}
    </span>
  )
}
