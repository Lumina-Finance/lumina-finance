import { EmptyState, ImportStagedFileList, ImportStat, ImportStep, ImportUploadCard } from '../components'
import type { TransactionImportWorkflow } from '../hooks'

type ImportFilesStepProps = Pick<
  TransactionImportWorkflow,
  | 'inputRef'
  | 'files'
  | 'isProcessingFiles'
  | 'totalRows'
  | 'mappedFieldCount'
  | 'handleFileChange'
  | 'removeFile'
>

export function ImportFilesStep({
  inputRef,
  files,
  isProcessingFiles,
  totalRows,
  mappedFieldCount,
  handleFileChange,
  removeFile,
}: ImportFilesStepProps) {
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
        disabled={isProcessingFiles}
      />
      <ImportUploadCard
        title="Upload CSV file"
        hint="One file accepted."
        processing={isProcessingFiles}
        disabled={isProcessingFiles}
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
