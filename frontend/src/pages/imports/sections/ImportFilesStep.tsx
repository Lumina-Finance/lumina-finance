import {
  EmptyState,
  ImportFilesStepLayout,
  ImportInfoCard,
  ImportReadingChoices,
  ImportStagedFileList,
  ImportUploadCard,
} from '@/pages/imports/components'
import { useStagedFileFocus, type TransactionImportWorkflow } from '@/pages/imports/hooks'
import { SEVERAL_CSV_IMPORT_FILE_TYPE } from '@/pages/imports/utils'

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
 * Files step of the generic CSV import flow, taking one file or several with the same columns and
 * showing the staged files' row and mapped-field counts, with how they were read: the separator,
 * header row and lines skipped at the end, which the user can change for all of them, and once a
 * column is mapped as the date, the dates to import
 *
 * The first file sets the layout, so the upload control stays under the staged files for adding the
 * rest, and goes only while a staged file is refused, since nothing can be checked against a layout
 * that has not been read yet. The guidance above it goes once any file is staged. Removing every
 * file brings the guidance back and clears the layout
 *
 * Once the import has run, the staged files are its record: they can't be removed and how they were
 * read can't be changed, and the upload control comes back under them, since new files are how a
 * new import starts
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
  const stagedFile = files[0]
  const { stagedListRef, uploadCardRef, removeFileKeepingFocus } = useStagedFileFocus(files, removeFile)

  // Files are added to the staged ones, so the card stays unless a staged file is refused. A finished
  // import keeps its files as a record and shows the card for starting the next one
  const isUploadShown = files.length === 0 || isImportFinished || files.every((file) => !file.error)
  const isAddingFiles = files.length > 0 && !isImportFinished
  const uploadArea = isUploadShown && (
    <>
      {/* Stated before a file is chosen, since re-exporting is the only thing that answers it.
          The wording stays loose about what goes wrong on purpose, because readCsvFile has two
          outcomes for a file it cannot read as UTF-8: accented characters lost below the
          replacement share, and the file refused above it or on any null character. It says the
          other encodings are unsupported rather than unreadable, since supporting them is open
          rather than ruled out */}
      {!isAddingFiles && (
        <ImportInfoCard title="Files are read as UTF-8">
          Other encodings are not supported yet, so a file saved as ISO-8859-1 or UTF-16 may not import correctly. Look for a UTF-8 option when saving your file as CSV.
        </ImportInfoCard>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
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
        title={isAddingFiles ? 'Add more CSV files' : 'Upload CSV files'}
        hint="Every file needs the same columns."
        processing={isProcessingFiles}
        disabled={isUploadBlocked}
        rejection={fileIntakeError}
        blockReason={uploadBlockReason}
        fileType={SEVERAL_CSV_IMPORT_FILE_TYPE}
        buttonRef={uploadCardRef}
        onClick={() => inputRef.current?.click()}
        onDropFile={(selection) => void handleFileChange(selection)}
      />
    </>
  )

  return (
    <ImportFilesStepLayout
      title="Files"
      description="Upload one CSV transaction file, or several with the same columns."
      areStatsFlush
      stats={[
        { label: files.length === 1 ? 'File' : 'Files', value: files.length },
        { label: 'Rows', value: totalRows },
        { label: 'Mapped', value: mappedFieldCount },
      ]}
    >
      {files.length === 0 ? (
        <>
          {uploadArea}
          <EmptyState
            title="No files staged"
            description="The uploaded files will appear here."
          />
        </>
      ) : (
        <>
          {/* The file rows, the settings and the counts all start and end on the section's own edges. The
              rows drop their side padding to do it, rather than being pulled out with a negative margin,
              since the section scrolls and a box wider than it slides sideways */}
          <div ref={stagedListRef}>
            <ImportStagedFileList isFlush files={files} onRemove={isImportFinished ? undefined : (file) => removeFileKeepingFocus(file.id)} />
          </div>
          {/* Adding files sits with the list it adds to, above the settings they all share. A finished
              import's card is the start of the next import, so it sits last */}
          {isAddingFiles && uploadArea}
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
          {isImportFinished && uploadArea}
        </>
      )}
    </ImportFilesStepLayout>
  )
}
