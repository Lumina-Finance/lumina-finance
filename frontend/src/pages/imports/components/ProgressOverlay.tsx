import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { Variants } from 'motion/react'
import type { ImportOverlayPhase } from '../types'

const OVERLAY_BACKGROUND = '#0F0E0C'
const OVERLAY_TEXT = '#F2EDE4'
const OVERLAY_MUTED_TEXT = 'rgba(242, 237, 228, 0.72)'
const OVERLAY_ACCENT = '#D2B478'
const OVERLAY_SUCCESS = '#6CA07B'
const OVERLAY_SUCCESS_TEXT = '#9CC6A8'
const OVERLAY_ERROR = '#D76C61'
const OVERLAY_EASE: [number, number, number, number] = [0.25, 0.1, 0.25, 1]
const OVERLAY_SPRING_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]
const overlayButtonClass = 'h-10 w-full box-border whitespace-nowrap leading-none sm:w-auto'

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
  /** Label for the secondary success action, kept overridable for flows that return to the page */
  continueLabel?: string
  error: string | null
  onContinueImporting: () => void
  onDone: () => void
  onReturnToImport: () => void
  phase: ImportOverlayPhase
  summary: string
}

export function ImportProgressOverlay({
  continueLabel = 'Continue importing',
  error,
  onContinueImporting,
  onDone,
  onReturnToImport,
  phase,
  summary,
}: ImportProgressOverlayProps) {
  const open = phase !== 'idle'
  const complete = phase === 'success'
  const failed = phase === 'error'
  const title = failed ? 'Import failed' : complete ? 'Import complete' : 'Importing transactions'
  const message = failed
    ? error ?? 'Import failed.'
    : complete
      ? summary || 'Your import is complete.'
      : 'Your staged import is being written to the ledger.'
  const messageStyle = complete
    ? {
        color: OVERLAY_SUCCESS_TEXT,
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

                {complete && (
                  <motion.div
                    className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center"
                    variants={itemVariants}
                  >
                    <button
                      type="button"
                      className={`app-secondary-button ${overlayButtonClass} sm:min-w-[11rem]`}
                      onClick={onContinueImporting}
                    >
                      {continueLabel}
                    </button>
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
