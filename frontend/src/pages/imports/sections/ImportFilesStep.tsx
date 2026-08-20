import { useEffect, useRef } from 'react'
import { EmptyState, ImportInfoCard, ImportStagedFileList, ImportStat, ImportStep, ImportUploadCard } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'
import { hasAcceptedFile } from '@/pages/imports/utils'

type ImportFilesStepProps = Pick<
  TransactionImportWorkflow,
  | 'inputRef'
  | 'files'
  | 'isProcessingFiles'
  | 'totalRows'
  | 'mappedFieldCount'
  | 'handleFileChange'
  | 'removeFile'
  | 'uploadBlockReason'
>

/**
 * Files step of the generic CSV import flow, taking a single upload and showing the staged file's
 * row and mapped-field counts
 *
 * The upload control and the guidance above it are taken away once a usable file is staged, since
 * this flow carries one file and uploading another would only replace it. A file the reader refused
 * keeps them, because that is the file the user has to replace
 */
export function ImportFilesStep({
  inputRef,
  files,
  isProcessingFiles,
  totalRows,
  mappedFieldCount,
  handleFileChange,
  removeFile,
  uploadBlockReason,
}: ImportFilesStepProps) {
  // A file is read against the currency list, so uploading one before it is in hand would read the
  // file wrongly rather than merely leave a later step waiting
  const isUploadBlocked = isProcessingFiles || uploadBlockReason !== null
  const isFileAccepted = hasAcceptedFile(files)
  const stagedListRef = useRef<HTMLDivElement>(null)
  const wasFileAcceptedRef = useRef(isFileAccepted)

  // The upload card is what the keyboard user pressed to get here, so taking it away leaves them on
  // the page body with the next tab starting from the top. The staged row's Remove button is the
  // control that replaced it, and it is the only button the list holds. Focus is only taken back
  // where the browser dropped it, so a user who moved on while the file was being read keeps where
  // they are
  useEffect(() => {
    const hasJustBeenAccepted = isFileAccepted && !wasFileAcceptedRef.current
    wasFileAcceptedRef.current = isFileAccepted
    if (!hasJustBeenAccepted || document.activeElement !== document.body) return
    stagedListRef.current?.querySelector('button')?.focus()
  }, [isFileAccepted])

  return (
    <ImportStep
      index="01"
      title="File"
      description="Upload one CSV transaction file."
      className="xl:h-full"
      contentClassName="flex min-h-0 flex-col gap-3"
    >
      {!isFileAccepted && (
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
            onChange={handleFileChange}
            disabled={isUploadBlocked}
          />
          <ImportUploadCard
            title="Upload CSV file"
            hint="One file accepted."
            processing={isProcessingFiles}
            disabled={isUploadBlocked}
            blockReason={uploadBlockReason}
            onClick={() => inputRef.current?.click()}
          />
        </>
      )}

      {files.length === 0 ? (
        <EmptyState
          title="No file staged"
          description="The uploaded file will appear here."
        />
      ) : (
        <div ref={stagedListRef}>
          <ImportStagedFileList files={files} onRemove={(file) => removeFile(file.id)} />
        </div>
      )}

      <div className="mt-auto grid grid-cols-3 gap-3 pt-3">
        <ImportStat label="File" value={files.length.toString()} />
        <ImportStat label="Rows" value={totalRows.toString()} />
        <ImportStat label="Mapped" value={mappedFieldCount.toString()} />
      </div>
    </ImportStep>
  )
}
