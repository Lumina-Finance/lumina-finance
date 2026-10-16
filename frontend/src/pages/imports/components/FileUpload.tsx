import { useState, type DragEvent, type Ref } from 'react'
import { FileText, LoaderCircle, TriangleAlert, Upload, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { COLLAPSIBLE_SECTION_EASE, COLLAPSIBLE_SECTION_TRANSITION_SECONDS } from '@/components/collapsible-section/motion'
import { IMPORT_INSET_STYLE } from '@/pages/imports/constants'
import type { ImportFileDraft, ImportUploadBlock } from '@/pages/imports/types'
import { CSV_IMPORT_FILE_TYPE, getDropPrompt, selectDroppedImportFiles, type ImportFileSelection, type ImportFileType } from '@/pages/imports/utils'

/**
 * Upload affordance shared by the import flows that animates between its idle
 * prompt and the processing state
 *
 * A rejection keeps the card in place and reports why the file was refused,
 * so the user can pick another one without losing the prompt or any guidance
 * sitting beside it
 *
 * A block reason is the other kind of refusal: no file can be taken at all yet,
 * so it is shown without telling the user to choose a different one, and it
 * leads when both are set. Only a block the user has to act on is dressed as an
 * error, since a page that is still loading its reference data is not one
 *
 * While it cannot take a file the card refuses presses rather than being
 * disabled, since the browser blurs a disabled element and a file starting to
 * parse would take the keyboard user's place on the page away from them
 */
export function ImportUploadCard({
  title,
  hint,
  processing,
  disabled,
  rejection,
  blockReason,
  fileType = CSV_IMPORT_FILE_TYPE,
  onClick,
  onDropFile,
  buttonRef,
}: {
  title: string
  hint: string
  processing: boolean

  /** Reaches the card's button, for a flow that hands the keyboard's place to it */
  buttonRef?: Ref<HTMLButtonElement>
  disabled: boolean
  rejection?: string | null
  blockReason?: ImportUploadBlock | null

  /** The kind of file the card takes and says it is reading, a CSV file unless the flow takes something else */
  fileType?: ImportFileType
  onClick: () => void
  onDropFile: (selection: ImportFileSelection) => void
}) {
  // A block leads over a file's own refusal, since nothing can be uploaded while one stands
  const isBlockedWithoutFailure = Boolean(blockReason) && !blockReason?.isFailure
  const message = blockReason?.message ?? rejection ?? null
  const isRefusal = message !== null && !isBlockedWithoutFailure
  const shouldReduceMotion = useReducedMotion()
  const dropPrompt = getDropPrompt(fileType)
  const [dragState, setDragState] = useState(() => ({ depth: 0, disabled }))

  // Reset a drag that crosses an availability change before rendering the new presentation
  if (dragState.disabled !== disabled) setDragState({ depth: 0, disabled })
  const isDraggingFile = !disabled && dragState.depth > 0
  const uploadStateMotion = shouldReduceMotion
    ? {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.12 },
    }
    : {
      initial: { opacity: 0, y: 8, scale: 0.985, filter: 'blur(3px)' },
      animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
      exit: { opacity: 0, y: -8, scale: 0.985, filter: 'blur(3px)' },
      transition: { duration: 0.24, ease: [0.25, 0.1, 0.25, 1] as const },
    }

  // Written out rather than left to `disabled:` variants, which no longer apply, and rather than
  // `aria-disabled:` ones, whose hover rule would land at the same specificity as the plain hover
  // above it and be settled by the order Tailwind happens to emit them in
  const unavailableClasses = blockReason?.isFailure ? 'cursor-not-allowed' : 'cursor-wait'
  const availableClasses = 'hover:bg-[var(--app-hover-soft)]'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`group grid min-h-32 w-full place-items-center px-5 py-6 text-center transition-colors duration-150 ${disabled ? unavailableClasses : availableClasses}`}
        style={{
          ...IMPORT_INSET_STYLE,
          color: 'var(--app-text-muted)',
          border: '1px solid transparent',
          borderColor: isRefusal
            ? 'var(--app-negative-border)'
            : isDraggingFile
              ? 'var(--app-accent)'
              : 'transparent',
        }}
        onClick={() => {
          if (disabled) return
          onClick()
        }}
        aria-disabled={disabled}
        aria-busy={processing}
        onDragEnter={(event) => {
          event.preventDefault()
          if (disabled) return
          setDragState((current) => ({ disabled, depth: current.depth + 1 }))
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          if (disabled) return
          setDragState((current) => ({ disabled, depth: Math.max(0, current.depth - 1) }))
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault()
          setDragState({ depth: 0, disabled })
          if (disabled) return
          onDropFile(selectDroppedImportFiles(event.dataTransfer.items, event.dataTransfer.files, fileType))
        }}
      >
        <span className="relative grid min-h-[5.75rem] w-full items-center justify-items-center overflow-hidden">
          {/* The idle prompt reserves its natural height, including wrapped hints, for every state */}
          <span className="invisible col-start-1 row-start-1 flex flex-col items-center" aria-hidden>
            <span className="mb-3 h-11 w-11" />
            <span className="block text-sm font-semibold">{title}</span>
            <span className="mt-1 block text-xs">{hint}</span>
          </span>
          <AnimatePresence initial={false} mode="wait">
            {processing ? (
              <motion.span
                key="processing"
                className="col-start-1 row-start-1 flex flex-col items-center"
                {...uploadStateMotion}
              >
                <span
                  className="mb-3 flex h-11 w-11 items-center justify-center"
                  style={{ background: 'var(--app-surface-soft)', color: 'var(--app-accent)' }}
                >
                  <LoaderCircle size={21} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden />
                </span>
                <span className="block text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
                  {fileType.processingStatus}
                </span>
                <span className="mt-2 flex items-center gap-1" aria-hidden>
                  <span className="h-1.5 w-6 animate-pulse" style={{ background: 'var(--app-accent)' }} />
                  <span className="h-1.5 w-6 animate-pulse [animation-delay:120ms]" style={{ background: 'var(--app-accent)' }} />
                  <span className="h-1.5 w-6 animate-pulse [animation-delay:240ms]" style={{ background: 'var(--app-accent)' }} />
                </span>
              </motion.span>
            ) : message ? (
              <motion.span
                // Waiting and refusing are separate keys so a fetch that fails after the waiting
                // message is on screen animates between the two rather than swapping the icon in
                // place, and so the polite live region is replaced by an assertive one rather than
                // having its politeness changed under a screen reader, which is not reliably honoured
                key={isBlockedWithoutFailure ? 'waiting' : 'rejected'}
                className="col-start-1 row-start-1 flex flex-col items-center"
                role={isBlockedWithoutFailure ? 'status' : 'alert'}
                {...uploadStateMotion}
              >
                <span
                  className="mb-3 flex h-11 w-11 items-center justify-center"
                  style={isBlockedWithoutFailure
                    ? { background: 'var(--app-surface-soft)', color: 'var(--app-accent)' }
                    : { background: 'var(--app-negative-soft)', color: 'var(--app-negative)' }}
                >
                  {isBlockedWithoutFailure
                    ? <LoaderCircle size={21} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden />
                    : <TriangleAlert size={20} strokeWidth={2.25} aria-hidden />}
                </span>
                <span
                  className="block text-sm font-semibold"
                  style={{ color: isBlockedWithoutFailure ? 'var(--app-text-muted)' : 'var(--app-negative)' }}
                >
                  {message}
                </span>
                {!blockReason && (
                  <span className="mt-1 block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                    Choose another file to try again.
                  </span>
                )}
              </motion.span>
            ) : isDraggingFile ? (
              <motion.span
                key="dragging"
                className="col-start-1 row-start-1 flex flex-col items-center"
                {...uploadStateMotion}
              >
                <span
                  className="mb-3 flex h-11 w-11 items-center justify-center"
                  style={{ background: 'var(--app-surface-soft)', color: 'var(--app-accent)' }}
                >
                  <Upload size={20} aria-hidden />
                </span>
                <span className="block text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
                  {dropPrompt.title}
                </span>
                <span className="mt-1 block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                  {dropPrompt.hint}
                </span>
              </motion.span>
            ) : (
              <motion.span
                key="upload"
                className="col-start-1 row-start-1 flex flex-col items-center"
                {...uploadStateMotion}
              >
                <span
                  className="mb-3 flex h-11 w-11 items-center justify-center transition-colors duration-150"
                  style={{ background: 'var(--app-surface-soft)' }}
                >
                  <Upload size={20} aria-hidden />
                </span>
                <span className="block text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
                  {title}
                </span>
                <span className="mt-1 block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                  {hint}
                </span>
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </button>

      {/* Outside the button and always present, so a screen reader is watching this region before
          the text arrives. The refusal and waiting messages carry their own regions inside the
          card, and only the processing state was left without one */}
      <span className="sr-only" role="status">
        {processing ? fileType.processingStatus : ''}
      </span>
    </>
  )
}

/** What the staged-file list shows beneath one file's name: what it holds, and anything wrong with it */
export interface ImportStagedFileSummary {
  /** The file's counts, such as "2 rows · 4 columns", left out for a file that can't be used */
  detail?: string
  problem?: { text: string; tone: 'notice' | 'error' }
}

/**
 * Staged-file list shared by the CSV import flows, listing each upload's
 * counts and problems with a remove action
 *
 * @param isFlush - Drops the rows' side padding so the list starts and ends on the edges of the
 *   section it sits in, for a section whose other content does the same
 */
export function ImportStagedFileList({
  files,
  onRemove,
  isFlush,
}: {
  files: ImportFileDraft[]
  onRemove?: (file: ImportFileDraft) => void
  isFlush?: boolean
}) {
  return <ImportStagedFileTable files={files} describe={describeCsvFile} onRemove={onRemove} isFlush={isFlush} />
}

/**
 * Staged-file list for any kind of upload, with the flow saying what each file holds
 */
export function ImportStagedFileTable<TFile extends { id: string; name: string }>({
  files,
  describe,
  onRemove,
  isFlush = false,
}: {
  files: TFile[]
  describe: (file: TFile) => ImportStagedFileSummary

  /** Left out where the file can no longer be removed, such as one a finished import was read from */
  onRemove?: (file: TFile) => void

  /** Drops the rows' side padding, so the list starts and ends on the edges of its section */
  isFlush?: boolean
}) {
  const shouldReduceMotion = useReducedMotion()
  // A removed row collapses and fades while the rows below move up with it, and a row already
  // there when the list appears does not animate in
  const rowTransition = { duration: shouldReduceMotion ? 0 : COLLAPSIBLE_SECTION_TRANSITION_SECONDS, ease: COLLAPSIBLE_SECTION_EASE }

  return (
    <div className="max-h-64 overflow-y-auto">
      <AnimatePresence initial={false}>
      {files.map((file) => {
        const { detail, problem } = describe(file)
        return (
          <motion.div
            key={file.id}
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={rowTransition}
          >
          <div
            className={`grid items-start gap-x-3 py-3${isFlush ? '' : ' px-3'} ${onRemove ? 'grid-cols-[17px_minmax(0,1fr)_2rem]' : 'grid-cols-[17px_minmax(0,1fr)]'}`}
          >
            <FileText size={17} className="mt-0.5" style={{ color: 'var(--app-text-muted)' }} aria-hidden />
            <div className="min-w-0">
              {/* Wraps rather than truncating, since exports are often told apart by the end of their name */}
              <p className="text-[0.9375rem] font-medium wrap-anywhere">{file.name}</p>
              {detail && (
                <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                  {detail}
                </p>
              )}
            </div>
            {/* Drawn taller than the name's line without making it any taller. A flush list has no room
                beside the button, so the list's scrolling box would cut the focus ring there, and the
                ring is drawn inside the button instead */}
            {onRemove && (
              <button
                type="button"
                className={`app-icon-button -my-1${isFlush ? ' focus-visible:-outline-offset-2' : ''}`}
                onClick={() => onRemove(file)}
                aria-label={`Remove ${file.name}`}
              >
                <X size={16} aria-hidden />
              </button>
            )}
            {/* Across the whole row rather than under the name, so a long message isn't squeezed into its column */}
            {problem && (
              <p
                className="col-span-full mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs"
                style={PROBLEM_TONE_STYLES[problem.tone]}
              >
                <TriangleAlert size={13} strokeWidth={2.25} className="mt-px shrink-0" aria-hidden />
                <span className="min-w-0 wrap-anywhere">{problem.text}</span>
              </p>
            )}
          </div>
          </motion.div>
        )
      })}
      </AnimatePresence>
    </div>
  )
}

// A file that cannot be used is told apart from one that staged with something worth knowing about it
const PROBLEM_TONE_STYLES: Record<'notice' | 'error', { background: string; color: string }> = {
  notice: { background: 'var(--app-warning-soft)', color: 'var(--app-warning-text)' },
  error: { background: 'var(--app-negative-soft)', color: 'var(--app-negative)' },
}

/**
 * Counts one staged CSV file's rows and columns, showing its error in their place, and adding
 * anything the reader had to say about a file that staged anyway
 */
function describeCsvFile(file: ImportFileDraft): ImportStagedFileSummary {
  if (file.error) return { problem: { text: file.error, tone: 'error' } }

  const rows = `${file.rows.length} row${file.rows.length === 1 ? '' : 's'}`
  const detail = `${rows} · ${file.headers.length} columns${file.hasHeaderRow ? '' : ' · no header row'}`
  return file.notice ? { detail, problem: { text: file.notice, tone: 'notice' } } : { detail }
}
