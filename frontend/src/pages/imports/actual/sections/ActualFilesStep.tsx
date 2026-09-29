import { ImportFileSlot, ImportFilesStepLayout, ImportInfoCard, ImportStagedFileTable } from '@/pages/imports/components'
import { formatBytes } from '@/pages/imports/utils'
import { ACTUAL_EXPORT_DOCS_URL, ACTUAL_IMPORT_FILE_TYPE } from '@/pages/imports/actual/constants'
import type { ActualImportWorkflow, ActualStagedFile } from '@/pages/imports/actual/hooks'

type ActualFilesStepProps = Pick<
  ActualImportWorkflow,
  | 'stagedFile'
  | 'isProcessingFile'
  | 'fileIntakeError'
  | 'journal'
  | 'visibleCategorySources'
  | 'handleActualFileChange'
  | 'removeActualFile'
  | 'uploadBlockReason'
>

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
  visibleCategorySources,
  handleActualFileChange,
  removeActualFile,
  uploadBlockReason,
}: ActualFilesStepProps) {
  return (
    <ImportFilesStepLayout
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
      stats={[
        { label: 'Transactions', value: stagedFile?.rowCount ?? 0 },
        { label: 'Accounts', value: journal.accounts.length },
        { label: 'Categories', value: visibleCategorySources.length },
      ]}
    >
      <ImportFileSlot
        label="Budget export"
        required
        accept=".zip,.sqlite,application/zip"
        uploadTitle="Upload budget export"
        hint="The .zip from Export data in Actual's settings, or the db.sqlite in its data folder."
        fileType={ACTUAL_IMPORT_FILE_TYPE}
        staged={stagedFile && (
          <ImportStagedFileTable files={[stagedFile]} describe={describeActualFile} onRemove={removeActualFile} />
        )}
        processing={isProcessingFile}
        disabled={isProcessingFile || uploadBlockReason !== null}
        rejection={fileIntakeError}
        blockReason={uploadBlockReason}
        onFileChange={handleActualFileChange}
      />

      {/* Shown before the upload, since it answers whether moving over costs a user their budget history */}
      <ImportInfoCard title="You can always recreate your budgets without losing historical data">
        Lumina Finance supports creating budgets with a past start date, which automatically repopulates your historical utilization rates, so you won't lose any historical information if your budgets weren't imported the way you wanted.
      </ImportInfoCard>
    </ImportFilesStepLayout>
  )
}
