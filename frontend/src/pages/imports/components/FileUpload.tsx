import { FileText, LoaderCircle, TriangleAlert, Upload, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { IMPORT_INSET_STYLE } from '@/pages/imports/constants'
import type { ImportFileDraft, ImportUploadBlock } from '@/pages/imports/types'
import { formatBytes } from '@/pages/imports/utils'

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
 */
export function ImportUploadCard({
  title,
  hint,
  processing,
  disabled,
  rejection,
  blockReason,
  onClick,
}: {
  title: string
  hint: string
  processing: boolean
  disabled: boolean
  rejection?: string | null
  blockReason?: ImportUploadBlock | null
  onClick: () => void
}) {
  // A block leads over a file's own refusal, since nothing can be uploaded while one stands
  const isBlockedWithoutFailure = Boolean(blockReason) && !blockReason?.isFailure
  const message = blockReason?.message ?? rejection ?? null
  const isRefusal = message !== null && !isBlockedWithoutFailure
  const shouldReduceMotion = useReducedMotion()
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

  return (
    <button
      type="button"
      className={`group grid min-h-32 w-full place-items-center px-5 py-6 text-center transition-colors duration-150 hover:bg-[var(--app-surface-soft)] disabled:opacity-100 ${blockReason?.isFailure ? 'disabled:cursor-not-allowed' : 'disabled:cursor-wait'}`}
      style={{
        ...IMPORT_INSET_STYLE,
        color: 'var(--app-text-muted)',
        border: isRefusal ? '1px solid var(--app-negative-border)' : undefined,
      }}
      onClick={onClick}
      disabled={disabled}
      aria-busy={processing}
    >
      <span className="relative flex min-h-[5.75rem] w-full items-center justify-center overflow-hidden">
        <AnimatePresence initial={false} mode="wait">
          {processing ? (
            <motion.span
              key="processing"
              className="flex flex-col items-center"
              {...uploadStateMotion}
            >
              <span
                className="mb-3 flex h-11 w-11 items-center justify-center"
                style={{ background: 'var(--app-surface-soft)', color: 'var(--app-accent)' }}
              >
                <LoaderCircle size={21} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden />
              </span>
              <span className="block text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
                Processing CSV
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
              className="flex flex-col items-center"
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
          ) : (
            <motion.span
              key="upload"
              className="flex flex-col items-center"
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
  )
}

/**
 * Staged-file table shared by the import flows, listing each upload's
 * metadata and row count with a remove action
 */
export function ImportStagedFileList({
  files,
  onRemove,
}: {
  files: ImportFileDraft[]
  onRemove: (file: ImportFileDraft) => void
}) {
  return (
    <div className="overflow-hidden">
      <div
        className="grid grid-cols-[minmax(0,1fr)_4rem_2.25rem] items-center gap-3 px-3 py-2 text-xs font-semibold uppercase"
        style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}
      >
        <span>File</span>
        <span className="text-right">Rows</span>
        <span aria-label="Actions" />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {files.map((file) => (
          <div
            key={file.id}
            className="grid grid-cols-[minmax(0,1fr)_4rem_2.25rem] items-center gap-3 px-3 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <FileText size={17} className="shrink-0" style={{ color: 'var(--app-text-muted)' }} aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-[0.9375rem] font-medium">{file.name}</p>
                <p className="truncate text-xs" style={{ color: getFileMetaColor(file) }}>
                  {getFileMeta(file)}
                </p>
              </div>
            </div>
            <span className="text-right text-[0.9375rem] font-medium tabular-nums">{file.rows.length}</span>
            <button
              type="button"
              className="app-icon-button"
              onClick={() => onRemove(file)}
              aria-label={`Remove ${file.name}`}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Formats one staged file's size and column details, surfacing its error in their place, and adding
 * anything the reader had to say about a file that staged anyway
 */
function getFileMeta(file: ImportFileDraft) {
  if (file.error) return file.error

  const meta = `${formatBytes(file.size)} · ${file.headers.length} columns${file.hasHeaderRow ? '' : ' · no header row'}`
  return file.notice ? `${meta} · ${file.notice}` : meta
}

/**
 * Colours the detail line by what it is saying, so a file that cannot be used is told apart from one
 * that staged with something worth knowing about it
 */
function getFileMetaColor(file: ImportFileDraft) {
  if (file.error) return 'var(--app-negative)'
  return file.notice ? 'var(--app-warning-text)' : 'var(--app-text-subtle)'
}
