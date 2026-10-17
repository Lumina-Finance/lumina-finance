import { useRef } from 'react'
import { EmptyState, ImportFilesStepLayout, ImportNotice, ImportStagedFileTable, ImportUploadCard } from '@/pages/imports/components'
import { useStagedFileFocus } from '@/pages/imports/hooks'
import { OfxReveal } from '@/pages/imports/ofx/components/OfxReveal'
import { getOfxLeftOutNotice, OFX_IMPORT_FILE_TYPE } from '@/pages/imports/ofx/constants'
import type { OfxImportWorkflow } from '@/pages/imports/ofx/hooks'
import type { OfxStagedFile } from '@/pages/imports/ofx/types'
import { countOfxTransactions } from '@/pages/imports/ofx/utils/stagedFiles'

type OfxFilesStepProps = Pick<
  OfxImportWorkflow,
  | 'stagedFiles'
  | 'ofxFile'
  | 'isProcessingFile'
  | 'fileIntakeError'
  | 'handleOfxFileChange'
  | 'removeOfxFile'
  | 'uploadBlockReason'
  | 'importResult'
>

function describeOfxFile({ file }: OfxStagedFile) {
  const transactionCount = countOfxTransactions(file)
  const statementCount = file.statements.length
  const transactions = `${transactionCount} transaction${transactionCount === 1 ? '' : 's'}`
  const statements = `${statementCount} statement${statementCount === 1 ? '' : 's'}`
  return { detail: `${transactions} · ${statements}` }
}

/**
 * Files step of the OFX import flow, taking one statement file or several, with the counts of
 * what they hold and a notice for the statements they leave out
 *
 * The upload control stays under the staged files for adding more. Once the import has run, the
 * staged files are its record and can't be removed, and the control starts the next import
 */
export function OfxFilesStep({
  stagedFiles,
  ofxFile,
  isProcessingFile,
  fileIntakeError,
  handleOfxFileChange,
  removeOfxFile,
  uploadBlockReason,
  importResult,
}: OfxFilesStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { stagedListRef, uploadCardRef, removeFileKeepingFocus } = useStagedFileFocus(stagedFiles, removeOfxFile)
  const leftOutNotice = ofxFile && getOfxLeftOutNotice(ofxFile.leftOut, stagedFiles.length)
  const isUploadBlocked = isProcessingFile || uploadBlockReason !== null
  const isImportFinished = Boolean(importResult)
  const isAddingFiles = stagedFiles.length > 0 && !isImportFinished

  const uploadArea = (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".ofx,.qfx"
        onChange={async (event) => {
          const input = event.currentTarget
          try {
            await handleOfxFileChange(input.files ?? [])
          } finally {
            input.value = ''
          }
        }}
        disabled={isUploadBlocked}
      />
      <ImportUploadCard
        title={isAddingFiles ? 'Add more statements' : 'Upload statements'}
        hint="Each file is an .ofx or .qfx statement. One file can hold several statements."
        processing={isProcessingFile}
        disabled={isUploadBlocked}
        rejection={fileIntakeError}
        blockReason={uploadBlockReason}
        fileType={OFX_IMPORT_FILE_TYPE}
        buttonRef={uploadCardRef}
        onClick={() => inputRef.current?.click()}
        onDropFile={(selection) => void handleOfxFileChange(selection)}
      />
    </>
  )

  return (
    <ImportFilesStepLayout
      title="Files"
      description="Upload statements your bank exported as OFX or QFX, one file or several."
      areStatsFlush
      stats={[
        { label: stagedFiles.length === 1 ? 'File' : 'Files', value: stagedFiles.length },
        { label: 'Transactions', value: stagedFiles.reduce((total, { file }) => total + countOfxTransactions(file), 0) },
        { label: 'Statements', value: stagedFiles.reduce((total, { file }) => total + file.statements.length, 0) },
      ]}
    >
      {stagedFiles.length > 0 && (
        <div ref={stagedListRef}>
          <ImportStagedFileTable
            isFlush
            files={stagedFiles}
            describe={describeOfxFile}
            onRemove={isImportFinished ? undefined : (file) => removeFileKeepingFocus(file.id)}
          />
        </div>
      )}

      {/* Files are added to the staged ones, so the card sits with the list it adds to. A finished
          import's card is the start of the next import, so it sits last */}
      {!isImportFinished && uploadArea}
      {stagedFiles.length === 0 && (
        <EmptyState title="No files staged" description="The uploaded files will appear here." />
      )}

      <OfxReveal show={Boolean(leftOutNotice)}>
        <ImportNotice title="Statements left out">{leftOutNotice}</ImportNotice>
      </OfxReveal>
      {isImportFinished && uploadArea}
    </ImportFilesStepLayout>
  )
}
