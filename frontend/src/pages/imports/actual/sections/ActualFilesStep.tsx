import { useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  EmptyState,
  ImportStagedFileTable,
  ImportStat,
  ImportStep,
  ImportUploadCard,
} from '@/pages/imports/components'
import { formatBytes } from '@/pages/imports/utils'
import { ACTUAL_EXPORT_DOCS_URL, ACTUAL_IMPORT_FILE_TYPE } from '@/pages/imports/actual/constants'
import type { ActualImportWorkflow, ActualStagedFile } from '@/pages/imports/actual/hooks'

type ActualFilesStepProps = Pick<
  ActualImportWorkflow,
  | 'stagedFile'
  | 'isProcessingFile'
  | 'fileIntakeError'
  | 'journal'
  | 'handleActualFileChange'
  | 'removeActualFile'
  | 'uploadBlockReason'
>

// Matches the ease the transaction list uses for row growth and collapse
const SLOT_SWAP_EASE = [0.25, 0.1, 0.25, 1] as const
const SLOT_SWAP_DURATION = 0.24

function describeActualFile(file: ActualStagedFile) {
  const budgetName = file.budgetName ? ` · ${file.budgetName}` : ''
  return { detail: `${formatBytes(file.size)}${budgetName}`, tone: 'plain' as const, rowCount: file.rowCount }
}

/**
 * Files step of the Actual Budget import flow, taking the one export that holds the whole budget,
 * with account and category counts once it is read
 */
export function ActualFilesStep({
  stagedFile,
  isProcessingFile,
  fileIntakeError,
  journal,
  handleActualFileChange,
  removeActualFile,
  uploadBlockReason,
}: ActualFilesStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isUploadBlocked = isProcessingFile || uploadBlockReason !== null

  return (
    <ImportStep
      index="01"
      title="Files"
      description={(
        <>
          Upload the budget exported from Actual Budget, following its{' '}
          <a
            href={ACTUAL_EXPORT_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
            style={{ color: 'var(--app-accent)' }}
          >
            guide to exporting data
          </a>
          .
        </>
      )}
      className="xl:min-h-full"
      contentClassName="flex min-h-0 flex-col gap-3"
    >
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">Budget export</p>
          <span className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            Required
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".zip,.sqlite,application/zip"
          onChange={async (event) => {
            const input = event.currentTarget
            try {
              await handleActualFileChange(input.files ?? [])
            } finally {
              input.value = ''
            }
          }}
          disabled={isUploadBlocked}
        />

        {/* The step takes exactly one export, so the upload card animates away once it lands and
            grows back when it is removed */}
        <AnimatePresence initial={false} mode="wait">
          {stagedFile ? (
            <motion.div
              key="staged"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
              transition={{ duration: SLOT_SWAP_DURATION, ease: SLOT_SWAP_EASE }}
            >
              <ImportStagedFileTable files={[stagedFile]} describe={describeActualFile} onRemove={removeActualFile} />
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
                title="Upload budget export"
                hint="The .zip from Export data in Actual's settings, or the db.sqlite in its data folder."
                processing={isProcessingFile}
                disabled={isUploadBlocked}
                rejection={fileIntakeError}
                blockReason={uploadBlockReason}
                fileType={ACTUAL_IMPORT_FILE_TYPE}
                onClick={() => inputRef.current?.click()}
                onDropFile={(selection) => void handleActualFileChange(selection)}
              />
              <EmptyState title="No file staged" description="The uploaded file will appear here." />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-auto flex flex-wrap gap-3 pt-3">
        <ImportStat label="Transactions" value={(stagedFile?.rowCount ?? 0).toString()} />
        <ImportStat label="Accounts" value={journal.accounts.length.toString()} />
        <ImportStat label="Categories" value={journal.categories.length.toString()} />
      </div>
    </ImportStep>
  )
}
