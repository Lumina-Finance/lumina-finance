import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  EmptyState,
  ImportInfoCard,
  ImportStagedFileList,
  ImportStat,
  ImportStep,
  ImportUploadCard,
} from '@/pages/imports/components'
import type { ImportFileDraft } from '@/pages/imports/types'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'
import type { FireflyFileKind } from '@/pages/imports/firefly/types'

type FireflyFilesStepProps = Pick<
  FireflyImportWorkflow,
  | 'transactionsFile'
  | 'budgetsFile'
  | 'processingFileKind'
  | 'fireflyRows'
  | 'trackedAccountNames'
  | 'importedCategories'
  | 'handleFireflyFileChange'
  | 'removeFireflyFile'
  | 'uploadBlockReason'
>

// Matches the ease the transaction list uses for row growth and collapse
const SLOT_SWAP_EASE = [0.25, 0.1, 0.25, 1] as const
const SLOT_SWAP_DURATION = 0.24

const FILE_SLOTS: Array<{ kind: FireflyFileKind; label: string; hint: string; required: boolean }> = [
  { kind: 'transactions', label: 'Transactions CSV', hint: 'The journal rows to import.', required: true },
  { kind: 'budgets', label: 'Budgets CSV', hint: 'Enables budget import after the transactions commit.', required: false },
]

/**
 * Files step of the Firefly III import flow, with a required slot for the transactions export and an
 * optional one for the budgets export, plus row, account, and category counts once files are staged
 */
export function FireflyFilesStep({
  transactionsFile,
  budgetsFile,
  processingFileKind,
  fireflyRows,
  trackedAccountNames,
  importedCategories,
  handleFireflyFileChange,
  removeFireflyFile,
  uploadBlockReason,
}: FireflyFilesStepProps) {
  const filesByKind: Record<FireflyFileKind, ImportFileDraft | null> = {
    transactions: transactionsFile,
    budgets: budgetsFile,
  }

  return (
    <ImportStep
      index="01"
      title="Files"
      description="Upload the CSV files exported from Firefly III."
      className="xl:h-full"
      contentClassName="flex min-h-0 flex-col gap-3"
    >
      {FILE_SLOTS.map((slot) => (
        <FireflyFileSlot
          key={slot.kind}
          kind={slot.kind}
          label={slot.label}
          hint={slot.hint}
          required={slot.required}
          file={filesByKind[slot.kind]}
          processing={processingFileKind === slot.kind}
          disabled={processingFileKind !== null}
          blockReason={uploadBlockReason}
          onFileChange={handleFireflyFileChange}
          onRemove={removeFireflyFile}
          note={slot.kind === 'budgets' ? (
            <ImportInfoCard title="No Budgets Export?">
              Budgets can be backdated and their historical spending is rebuilt automatically from the imported transactions. If you skip this export, it is easy to create budgets by hand after the import with a past start date.
            </ImportInfoCard>
          ) : undefined}
        />
      ))}

      <div className="mt-auto grid grid-cols-3 gap-3 pt-3">
        <ImportStat label="Rows" value={fireflyRows.length.toString()} />
        <ImportStat label="Accounts" value={trackedAccountNames.length.toString()} />
        <ImportStat label="Categories" value={importedCategories.length.toString()} />
      </div>
    </ImportStep>
  )
}

/**
 * One upload slot pairing the shared upload card with its staged file or the
 * blank placeholder when nothing is staged
 */
function FireflyFileSlot({
  kind,
  label,
  hint,
  required,
  file,
  processing,
  disabled,
  blockReason,
  onFileChange,
  onRemove,
  note,
}: {
  kind: FireflyFileKind
  label: string
  hint: string
  required: boolean
  file: ImportFileDraft | null
  processing: boolean
  disabled: boolean
  blockReason: { message: string; isFailure: boolean } | null
  onFileChange: (kind: FireflyFileKind, event: ChangeEvent<HTMLInputElement>) => void
  onRemove: (kind: FireflyFileKind) => void
  note?: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  // A rejected file never becomes a staged file, so the slot keeps its upload
  // card and any guidance beside it and reports the refusal in place
  const stagedFile = file && !file.error ? file : null
  const rejection = file?.error ?? null
  const isUploadBlocked = disabled || blockReason !== null

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
        accept=".csv,text/csv"
        onChange={(event) => onFileChange(kind, event)}
        disabled={isUploadBlocked}
      />

      {/* Each slot takes exactly one file, so the upload card and its note
          animate away once a file lands and grow back when it is removed */}
      <AnimatePresence initial={false} mode="wait">
        {stagedFile ? (
          <motion.div
            key="staged"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ duration: SLOT_SWAP_DURATION, ease: SLOT_SWAP_EASE }}
          >
            <ImportStagedFileList files={[stagedFile]} onRemove={() => onRemove(kind)} />
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
            {note}
            <ImportUploadCard
              title={`Upload ${label.toLowerCase()}`}
              hint={hint}
              processing={processing}
              disabled={isUploadBlocked}
              rejection={rejection}
              blockReason={blockReason}
              onClick={() => inputRef.current?.click()}
            />
            <EmptyState
              title="No file staged"
              description="The uploaded file will appear here."
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
