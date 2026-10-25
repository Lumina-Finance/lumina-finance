import { useState } from 'react'
import { History } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ApiError } from '@/api/auth'
import { useLastImport, useUndoImportRun, type LastImport } from '@/api/import-runs'
import { COLLAPSIBLE_SECTION_EASE, COLLAPSIBLE_SECTION_TRANSITION_SECONDS } from '@/components/collapsible-section/motion'
import { useAuth } from '@/hooks/useAuth'
import { IMPORT_INSET_STYLE } from '@/pages/imports/constants'
import { useFlashWhenVisible } from '@/pages/imports/hooks/useFlashWhenVisible'
import { useUndoableEntry } from '@/pages/imports/hooks/useUndoableEntry'
import { UndoImportConfirm } from '@/pages/imports/components/UndoImportConfirm'
import {
  IMPORT_SOURCE_LABELS,
  UNNAMED_IMPORT_FILE,
  formatTransactionCount,
} from '@/pages/imports/utils/lastImport'
import { joinImportSummaryParts } from '@/pages/imports/utils/common'
import { DATE_FORMATS, formatDate } from '@/utils/date'

// The gap the page's column leaves below the card, taken back while it is closed so the steps below
// slide rather than jump by it
const COLUMN_GAP = '-2rem'

/**
 * The last saved import, with a way to undo it while it still can be
 *
 * Only the last import can be undone, only within the backend's undo window after it was saved
 * (`IMPORT_UNDO_WINDOW`, whose end the server sends as `undo_until`) and only while nothing else has
 * changed, so this shows nothing once there is none to undo. Left out until it arrives, so a new user
 * never sees it flash, and grown into place when it does, so the steps below slide down rather than jump
 *
 * @param onUndone - Told the ID of the import once it is undone, for the page to put its importers right
 *   and say what happened
 * @param arrival - The latest import another tab saved while the page was open, and how many have come.
 *   The card flashes three times for it, and again for each one after, but never for any other import,
 *   so a card that mounts again later for this tab's own import stays still
 */
export function LastImportCard({ className = '', onUndone, arrival = null }: {
  className?: string
  onUndone: (runId: string) => void
  arrival?: { count: number; runId: string } | null
}) {
  const lastImport = useLastImport()
  const undo = useUndoImportRun()
  const { user } = useAuth()
  const prefersReducedMotion = useReducedMotion()

  // Kept after the confirmation closes, so its text does not empty while it fades out, and the
  // confirmation stays mounted after the undo takes the import away
  const [pendingEntry, setPendingEntry] = useState<LastImport | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)

  /**
   * Undoes the import the confirmation was opened for, keeping a refusal open with its reason
   */
  function undoPendingEntry() {
    if (!pendingEntry) return
    setUndoError(null)
    undo.mutate(pendingEntry.id, {
      onSuccess: () => {
        setIsConfirmOpen(false)
        onUndone(pendingEntry.id)
      },
      onError: (error) => {
        setUndoError(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.')
      },
    })
  }

  const entry = useUndoableEntry(lastImport.data ?? null)
  const reveal = {
    // Ends where the steps below it do, which keep a gutter on desktop beside the files step's scrolling box
    className: 'xl:pr-1',
    // Clipped only while it moves, so the button's focus ring shows once it is in place
    initial: { height: 0, opacity: 0, marginBottom: COLUMN_GAP, overflow: 'hidden' },
    animate: { height: 'auto', opacity: 1, marginBottom: 0, transitionEnd: { overflow: 'visible' } },
    exit: { height: 0, opacity: 0, marginBottom: COLUMN_GAP, overflow: 'hidden' },
    transition: { duration: prefersReducedMotion ? 0 : COLLAPSIBLE_SECTION_TRANSITION_SECONDS, ease: COLLAPSIBLE_SECTION_EASE },
  } as const

  return (
    <>
      <AnimatePresence initial={false}>
        {lastImport.isError && (
          <motion.div key="error" {...reveal}>
            <section className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm ${className}`} style={IMPORT_INSET_STYLE}>
              <p role="alert" style={{ color: 'var(--app-negative)' }}>Your last import couldn't be loaded.</p>
              <button type="button" className="app-secondary-button h-8 shrink-0 px-3 text-sm"
                onClick={() => void lastImport.refetch()}
                disabled={lastImport.isFetching}
                aria-busy={lastImport.isFetching}>
                Try again
              </button>
            </section>
          </motion.div>
        )}
        {entry && (
          <motion.div key="entry" {...reveal}>
            <LastImportRow
              entry={entry}
              className={className}
              flashKey={arrival?.runId === entry.id ? arrival.count : null}
              timeZone={user?.tz}
              onUndo={() => {
                setUndoError(null)
                setPendingEntry(entry)
                setIsConfirmOpen(true)
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <UndoImportConfirm
        entry={pendingEntry}
        open={isConfirmOpen}
        error={undoError}
        isUndoing={undo.isPending}
        onConfirm={undoPendingEntry}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  )
}

/**
 * The import's file, where it came from, when it was saved, how many transactions it wrote and until
 * when it can be undone
 */
function LastImportRow({ entry, className, flashKey, timeZone, onUndo }: {
  entry: LastImport
  className: string
  flashKey: number | null
  timeZone?: string
  onUndo: () => void
}) {
  const isFlashing = useFlashWhenVisible(flashKey)
  const fileName = entry.file_name ?? UNNAMED_IMPORT_FILE
  const details = [
    IMPORT_SOURCE_LABELS[entry.source],
    formatDate(new Date(entry.committed_at), DATE_FORMATS.monthDayYear, timeZone),
    formatTransactionCount(entry.transaction_count),
  ]

  return (
    // The flash class goes on once the setup panel has opened, a pause has passed and the tab is in
    // view, and comes off for the next arrival so it plays again
    <section
      className={`rounded-lg px-4 py-3 ${isFlashing ? 'import-last-import-flash' : ''} ${className}`}
      style={IMPORT_INSET_STYLE}
      aria-label="Last import"
    >
      {/* The undo sits beside the heading, so the lines below have the card's whole width and the date fits on one */}
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <History size={16} strokeWidth={2.25} className="shrink-0" style={{ color: 'var(--app-accent)' }} aria-hidden />
          <h2 className="text-[0.9375rem] font-semibold leading-5" style={{ color: 'var(--app-text)' }}>Last import</h2>
        </div>
        <button
          type="button"
          className="app-secondary-button h-8 shrink-0 px-3 text-sm"
          onClick={onUndo}
          aria-label={`Undo import of ${fileName}`}
        >
          Undo import
        </button>
      </div>
      <div className="mt-2 min-w-0">
        <p className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }} title={fileName}>{fileName}</p>
        <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--app-text-muted)' }}>
          {joinImportSummaryParts(details)}
        </p>
        <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--app-text-muted)' }}>
          Can be undone until {formatDate(new Date(entry.undo_until), DATE_FORMATS.monthDayTime, timeZone)}
        </p>
        <p className="mt-2 text-xs font-semibold leading-5" style={{ color: 'var(--app-text)' }}>
          Any other change makes this import permanent.
        </p>
      </div>
    </section>
  )
}
