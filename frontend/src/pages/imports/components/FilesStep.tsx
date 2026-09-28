import { useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ImportUploadBlock } from '@/pages/imports/types'
import type { ImportFileAcquisition, ImportFileType } from '@/pages/imports/utils'
import { EmptyState, ImportStat, ImportStep } from './Primitives'
import { ImportUploadCard } from './FileUpload'

// Matches the ease the transaction list uses for row growth and collapse
const SLOT_SWAP_EASE = [0.25, 0.1, 0.25, 1] as const
const SLOT_SWAP_DURATION = 0.24

/**
 * The first step of every import, holding the importer's upload slots with counts of what the
 * staged files hold beneath them
 */
export function ImportFilesStepLayout({
  title,
  description,
  stats,
  children,
}: {
  title: string
  description: ReactNode
  stats: Array<{ label: string; value: number }>
  children: ReactNode
}) {
  return (
    <ImportStep
      index="01"
      title={title}
      description={description}
      className="xl:min-h-full"
      contentClassName="flex min-h-0 flex-col gap-3"
    >
      {children}

      <div className="mt-auto flex flex-wrap gap-3 pt-3">
        {stats.map((stat) => <ImportStat key={stat.label} label={stat.label} value={stat.value.toString()} />)}
      </div>
    </ImportStep>
  )
}

/**
 * One upload slot of a provider import, which takes exactly one file. The upload card animates
 * away once the file lands and grows back when it is removed
 */
export function ImportFileSlot({
  label,
  required,
  accept,
  uploadTitle,
  hint,
  fileType,
  staged,
  processing,
  disabled,
  rejection,
  blockReason,
  onFileChange,
}: {
  label: string
  required: boolean
  accept: string
  uploadTitle: string
  hint: string
  fileType?: ImportFileType

  /** The staged file, shown in place of the upload card, or null while there is none */
  staged: ReactNode | null
  processing: boolean
  disabled: boolean

  /** Why the last file was refused, shown on the upload card */
  rejection: string | null
  blockReason: ImportUploadBlock | null
  onFileChange: (selection: ImportFileAcquisition) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        <span className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
          {required ? 'Required' : 'Optional'}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={async (event) => {
          const input = event.currentTarget
          try {
            await onFileChange(input.files ?? [])
          } finally {
            input.value = ''
          }
        }}
        disabled={disabled}
      />

      <AnimatePresence initial={false} mode="wait">
        {staged ? (
          <motion.div
            key="staged"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ duration: SLOT_SWAP_DURATION, ease: SLOT_SWAP_EASE }}
          >
            {staged}
          </motion.div>
        ) : (
          <motion.div
            key="upload"
            className="space-y-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ duration: SLOT_SWAP_DURATION, ease: SLOT_SWAP_EASE }}
          >
            <ImportUploadCard
              title={uploadTitle}
              hint={hint}
              processing={processing}
              disabled={disabled}
              rejection={rejection}
              blockReason={blockReason}
              fileType={fileType}
              onClick={() => inputRef.current?.click()}
              onDropFile={(selection) => void onFileChange(selection)}
            />
            <EmptyState title="No file staged" description="The uploaded file will appear here." />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
