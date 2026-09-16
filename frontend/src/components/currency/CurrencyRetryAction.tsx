import { AnimatePresence, motion } from 'motion/react'
import { LoaderCircle } from 'lucide-react'

/** Matches the signup warning fade so retry feedback changes at the same pace */
const RETRY_FADE_SECONDS = 0.2

interface CurrencyRetryActionProps {
  retrying: boolean
  fetching: boolean
  onRetry: () => Promise<void>
}

/** Shares the inline currency retry link and feedback between signup and money fields */
export function CurrencyRetryAction({ retrying, fetching, onRetry }: CurrencyRetryActionProps) {
  return (
    <span className="inline-grid align-middle">
      <AnimatePresence initial={false}>
        <motion.span
          key={retrying ? 'retrying' : 'retry'}
          className="inline-block"
          style={{ gridArea: '1 / 1' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: RETRY_FADE_SECONDS }}
        >
          {retrying ? (
            <span role="status" className="flex items-center gap-1.5">
              <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
              Retrying…
            </span>
          ) : (
            <>
              Click{' '}
              <button
                type="button"
                disabled={fetching}
                onClick={onRetry}
                data-modal-field-tab-stop="true"
                aria-label="Retry loading currencies"
                className="font-medium underline underline-offset-2 disabled:cursor-wait disabled:opacity-50"
              >
                here
              </button>{' '}
              to retry.
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
