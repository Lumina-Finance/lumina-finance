import { useRef } from 'react'
import {
  EmptyState,
  ImportFilesStepLayout,
  ImportNotice,
  ImportStagedFileTable,
  ImportUploadCard,
} from '@/pages/imports/components'
import { useStagedFileFocus } from '@/pages/imports/hooks'
import { OfxReadingChoicesRows } from '@/pages/imports/ofx/components/OfxReadingChoicesRows'
import { OfxReveal } from '@/pages/imports/ofx/components/OfxReveal'
import type { OfxImportWorkflow } from '@/pages/imports/ofx/hooks'
import type { OfxStagedFile } from '@/pages/imports/ofx/types'
import { countOfxTransactions } from '@/pages/imports/ofx/utils/stagedFiles'

type OfxFilesStepProps = Pick<
  OfxImportWorkflow,
  | 'format'
  | 'readingChoices'
  | 'stagedFiles'
  | 'leftOutNotice'
  | 'fixedAccount'
  | 'isProcessingFile'
  | 'fileIntakeError'
  | 'handleOfxFileChange'
  | 'removeOfxFile'
  | 'uploadBlockReason'
  | 'importResult'
>

function describeOfxFile({ file }: OfxStagedFile, statementNoun: string) {
  const transactionCount = countOfxTransactions(file)
  const statementCount = file.statements.length
  const transactions = `${transactionCount} transaction${transactionCount === 1 ? '' : 's'}`
  const statements = `${statementCount} ${statementNoun}${statementCount === 1 ? '' : 's'}`
  return { detail: `${transactions} · ${statements}` }
}

/**
 * Files step of the statement import flow, taking one file or several, with the counts of what they
 * hold and a notice for the statements they leave out
 *
 * For a format whose dates and amounts have no fixed shape, the settings for reading them sit under
 * the staged files, where the user changes them. The upload control stays under the staged files for
 * adding more. Once the import has run, the staged files are its record and can't be removed, and the
 * control starts the next import
 */
export function OfxFilesStep({
  format,
  readingChoices,
  stagedFiles,
  leftOutNotice,
  fixedAccount,
  isProcessingFile,
  fileIntakeError,
  handleOfxFileChange,
  removeOfxFile,
  uploadBlockReason,
  importResult,
}: OfxFilesStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { stagedListRef, uploadCardRef, removeFileKeepingFocus } = useStagedFileFocus(stagedFiles, removeOfxFile)
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
        accept={format.files.accept}
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
        title={isAddingFiles ? format.files.addTitle : format.files.uploadTitle}
        hint={fixedAccount ? format.files.getFixedAccountHint(fixedAccount.name) : format.files.hint}
        processing={isProcessingFile}
        disabled={isUploadBlocked}
        rejection={fileIntakeError}
        blockReason={uploadBlockReason}
        fileType={format.fileType}
        buttonRef={uploadCardRef}
        onClick={() => inputRef.current?.click()}
        onDropFile={(selection) => void handleOfxFileChange(selection)}
      />
    </>
  )

  return (
    <ImportFilesStepLayout
      title="Files"
      description={format.files.description}
      areStatsFlush
      stats={[
        { label: stagedFiles.length === 1 ? 'File' : 'Files', value: stagedFiles.length },
        {
          label: 'Transactions',
          value: stagedFiles.reduce((total, { file }) => total + countOfxTransactions(file), 0),
        },
        {
          label: `${format.files.statementNoun[0].toUpperCase()}${format.files.statementNoun.slice(1)}s`,
          value: stagedFiles.reduce((total, { file }) => total + file.statements.length, 0),
        },
      ]}
    >
      {/* The notice leads the step, since the setup column scrolls at some sizes and a notice below
          a long list of staged files would fall out of view, which is the one place it is told */}
      {/* The step's gap sits after this box even while it is empty or closing, so its own room is
          taken back here and given again inside the notice, where it grows and shrinks with it and
          the list below never jumps by a gap when the notice arrives or leaves */}
      <div className="-mb-3">
        <OfxReveal show={Boolean(leftOutNotice)}>
          <div className="pb-3">
            <ImportNotice title="Statements left out">{leftOutNotice}</ImportNotice>
          </div>
        </OfxReveal>
      </div>

      {stagedFiles.length > 0 && (
        <div ref={stagedListRef}>
          <ImportStagedFileTable
            isFlush
            files={stagedFiles}
            describe={(file) => describeOfxFile(file, format.files.statementNoun)}
            onRemove={isImportFinished ? undefined : (file) => removeFileKeepingFocus(file.id)}
          />
        </div>
      )}

      {/* Grows in below the files it reads, and stays on screen, locked, as part of a finished import's record */}
      {readingChoices && (
        <OfxReveal show={stagedFiles.length > 0}>
          <OfxReadingChoicesRows choices={readingChoices} disabled={isImportFinished} />
        </OfxReveal>
      )}

      {/* Files are added to the staged ones, so the card sits with the list it adds to. A finished
          import's card is the start of the next import, so it sits last */}
      {!isImportFinished && uploadArea}
      {/* The upload card says the file is being read, so the empty state would contradict it */}
      {stagedFiles.length === 0 && !isProcessingFile && (
        <EmptyState title="No files staged" description="The uploaded files will appear here." />
      )}

      {isImportFinished && uploadArea}
    </ImportFilesStepLayout>
  )
}
