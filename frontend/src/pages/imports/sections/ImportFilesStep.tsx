import { EmptyState, ImportStagedFileList, ImportStat, ImportStep, ImportUploadCard } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

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

  return (
    <ImportStep
      index="01"
      title="File"
      description="Upload one CSV transaction file."
      className="xl:h-full"
      contentClassName="flex min-h-0 flex-col gap-3"
    >
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
        rejection={uploadBlockReason}
        onClick={() => inputRef.current?.click()}
      />

      {files.length === 0 ? (
        <EmptyState
          title="No file staged"
          description="The uploaded file will appear here."
        />
      ) : (
        <ImportStagedFileList files={files} onRemove={(file) => removeFile(file.id)} />
      )}

      <div className="mt-auto grid grid-cols-3 gap-3 pt-3">
        <ImportStat label="File" value={files.length.toString()} />
        <ImportStat label="Rows" value={totalRows.toString()} />
        <ImportStat label="Mapped" value={mappedFieldCount.toString()} />
      </div>
    </ImportStep>
  )
}
