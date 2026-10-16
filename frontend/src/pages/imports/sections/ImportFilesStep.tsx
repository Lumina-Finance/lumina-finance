import { useEffect, useRef } from 'react'
import {
  EmptyState,
  ImportFilesStepLayout,
  ImportInfoCard,
  ImportReadingChoices,
  ImportStagedFileList,
  ImportUploadCard,
} from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

type ImportFilesStepProps = Pick<
  TransactionImportWorkflow,
  | 'inputRef'
  | 'files'
  | 'isProcessingFiles'
  | 'fileIntakeError'
  | 'totalRows'
  | 'mappedFieldCount'
  | 'handleFileChange'
  | 'changeDelimiter'
  | 'changeHeaderRow'
  | 'changeSkipLastRows'
  | 'columnMap'
  | 'dateRange'
  | 'isDateRangeCrossed'
  | 'latestStartSuggestion'
  | 'setDateRangeEnd'
  | 'removeFile'
  | 'uploadBlockReason'
  | 'importResult'
>

/**
 * Files step of the generic CSV import flow, taking a single upload and showing the staged file's
 * row and mapped-field counts, with how it was read: the separator, header row and lines skipped at
 * the end, which the user can change, and once a column is mapped as the date, the dates to import
 *
 * The upload control and the guidance above it are taken away while any file is staged, a refused one
 * included, since this flow carries one file and uploading another would only replace it. Removing
 * the file brings them back
 *
 * Once the import has run, the staged file is its record: it can't be removed and how it was read
 * can't be changed, and the upload control comes back under it, since a new file is how a new import
 * starts
 */
export function ImportFilesStep({
  inputRef,
  files,
  isProcessingFiles,
  fileIntakeError,
  totalRows,
  mappedFieldCount,
  handleFileChange,
  changeDelimiter,
  changeHeaderRow,
  changeSkipLastRows,
  columnMap,
  dateRange,
  isDateRangeCrossed,
  latestStartSuggestion,
  setDateRangeEnd,
  removeFile,
  uploadBlockReason,
  importResult,
}: ImportFilesStepProps) {
  // A file is read against the currency list, so uploading one before it is in hand would read the
  // file wrongly rather than merely leave a later step waiting
  const isUploadBlocked = isProcessingFiles || uploadBlockReason !== null
  const isImportFinished = Boolean(importResult)
  const stagedListRef = useRef<HTMLDivElement>(null)
  const stagedFile = files[0]
  const isFileStaged = Boolean(stagedFile)
  const wasFileStagedRef = useRef(isFileStaged)

  // The upload card is what the keyboard user pressed to get here, so taking it away leaves them on
  // the page body with the next tab starting from the top. The staged row's Remove button is the
  // control that replaced it, and it is the only button the list holds. Focus is only taken back
  // where the browser dropped it, so a user who moved on while the file was being read keeps where
  // they are
  useEffect(() => {
    const hasJustBeenStaged = isFileStaged && !wasFileStagedRef.current
    wasFileStagedRef.current = isFileStaged
    if (!hasJustBeenStaged || document.activeElement !== document.body) return
    stagedListRef.current?.querySelector('button')?.focus()
  }, [isFileStaged])

  // A staged file, even one refused, is replaced by removing it first, which brings the upload back, so
  // the upload shows only with no file staged or after a finished import
  const uploadArea = (!stagedFile || isImportFinished) && (
    <>
      {/* Stated before a file is chosen, since re-exporting is the only thing that answers it.
          The wording stays loose about what goes wrong on purpose, because readCsvFile has two
          outcomes for a file it cannot read as UTF-8: accented characters lost below the
          replacement share, and the file refused above it or on any null character. It says the
          other encodings are unsupported rather than unreadable, since supporting them is open
          rather than ruled out */}
      <ImportInfoCard title="Files are read as UTF-8">
        Other encodings are not supported yet, so a file saved as ISO-8859-1 or UTF-16 may not import correctly. Look for a UTF-8 option when saving your file as CSV.
      </ImportInfoCard>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".csv,text/csv"
        onChange={async (event) => {
          const input = event.currentTarget
          try {
            await handleFileChange(input.files ?? [])
          } finally {
            input.value = ''
          }
        }}
        disabled={isUploadBlocked}
      />
      <ImportUploadCard
        title="Upload CSV file"
        hint="One file accepted."
        processing={isProcessingFiles}
        disabled={isUploadBlocked}
        rejection={fileIntakeError}
        blockReason={uploadBlockReason}
        onClick={() => inputRef.current?.click()}
        onDropFile={(selection) => void handleFileChange(selection)}
      />
    </>
  )

  return (
    <ImportFilesStepLayout
      title="File"
      description="Upload one CSV transaction file."
      areStatsFlush
      stats={[
        { label: 'File', value: files.length },
        { label: 'Rows', value: totalRows },
        { label: 'Mapped', value: mappedFieldCount },
      ]}
    >
      {files.length === 0 ? (
        <>
          {uploadArea}
          <EmptyState
            title="No file staged"
            description="The uploaded file will appear here."
          />
        </>
      ) : (
        <>
          {/* The file row, the settings and the counts all start and end on the section's own edges. The
              row drops its side padding to do it, rather than being pulled out with a negative margin,
              since the section scrolls and a box wider than it slides sideways */}
          <div ref={stagedListRef}>
            <ImportStagedFileList isFlush files={files} onRemove={isImportFinished ? undefined : (file) => removeFile(file.id)} />
          </div>
          {/* Shown for a refused file too, since most refusals of a bank export are fixed by one of these */}
          {stagedFile && (stagedFile.delimiter || stagedFile.reading) && (
            <ImportReadingChoices
              file={stagedFile}
              disabled={isImportFinished}
              hasDateColumn={Boolean(columnMap.dt)}
              dateRange={dateRange}
              isDateRangeCrossed={isDateRangeCrossed}
              startSuggestion={latestStartSuggestion}
              onDelimiterChange={changeDelimiter}
              onHeaderRowChange={changeHeaderRow}
              onSkipLastRowsChange={changeSkipLastRows}
              onDateRangeChange={setDateRangeEnd}
            />
          )}
          {/* Only a finished import's file has the upload under it, since a new file is how a new
              import starts */}
          {uploadArea}
        </>
      )}
    </ImportFilesStepLayout>
  )
}
