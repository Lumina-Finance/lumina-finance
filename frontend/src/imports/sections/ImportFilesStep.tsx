import { FileText, Upload, X } from 'lucide-react'
import { IMPORT_INSET_STYLE } from '../constants'
import { EmptyState, ImportStat, ImportStep } from '../components'
import type { TransactionImportWorkflow } from '../hooks'
import { formatBytes } from '../utils'

type ImportFilesStepProps = Pick<
  TransactionImportWorkflow,
  | 'inputRef'
  | 'mode'
  | 'files'
  | 'totalRows'
  | 'mappedFieldCount'
  | 'handleModeChange'
  | 'handleFileChange'
  | 'removeFile'
>

export function ImportFilesStep({
  inputRef,
  mode,
  files,
  totalRows,
  mappedFieldCount,
  handleModeChange,
  handleFileChange,
  removeFile,
}: ImportFilesStepProps) {
  return (
    <ImportStep
      index="01"
      title="Files"
      description="Choose how the import is shaped."
      className="xl:h-full"
      contentClassName="flex min-h-0 flex-col gap-3"
    >
      <div className="app-segmented-control w-full">
        <button
          type="button"
          className={`app-segmented-option flex-1 text-sm ${mode === 'single-file' ? 'app-segmented-option-active' : ''}`}
          onClick={() => handleModeChange('single-file')}
        >
          Single file
        </button>
        <button
          type="button"
          className={`app-segmented-option flex-1 text-sm ${mode === 'file-per-account' ? 'app-segmented-option-active' : ''}`}
          onClick={() => handleModeChange('file-per-account')}
        >
          File per account
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".csv,text/csv"
        multiple={mode === 'file-per-account'}
        onChange={handleFileChange}
      />
      <button
        type="button"
        className="group grid min-h-32 w-full place-items-center px-5 py-6 text-center transition-colors duration-150 hover:bg-[var(--app-surface-soft)]"
        style={{
          ...IMPORT_INSET_STYLE,
          color: 'var(--app-text-muted)',
        }}
        onClick={() => inputRef.current?.click()}
      >
        <span
          className="mb-3 flex h-11 w-11 items-center justify-center transition-colors duration-150"
          style={{ background: 'var(--app-surface-soft)' }}
        >
          <Upload size={20} aria-hidden />
        </span>
        <span className="block text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
          Upload CSV {mode === 'file-per-account' ? 'files' : 'file'}
        </span>
        <span className="mt-1 block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          {mode === 'file-per-account' ? 'Multiple files accepted.' : 'One file accepted.'}
        </span>
      </button>

      {files.length === 0 ? (
        <EmptyState
          title="No files staged"
          description="Uploaded files will appear here."
        />
      ) : (
        <div className="overflow-hidden">
          <div
            className="grid grid-cols-[minmax(0,1fr)_4rem_2.25rem] items-center gap-3 px-3 py-2 text-xs font-semibold uppercase"
            style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}
          >
            <span>File</span>
            <span className="text-right">Rows</span>
            <span aria-label="Actions" />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {files.map((file) => (
              <div
                key={file.id}
                className="grid grid-cols-[minmax(0,1fr)_4rem_2.25rem] items-center gap-3 px-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <FileText size={17} className="shrink-0" style={{ color: 'var(--app-text-muted)' }} aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-[0.9375rem] font-medium">{file.name}</p>
                    <p className="truncate text-xs" style={{ color: file.error ? 'var(--app-negative)' : 'var(--app-text-subtle)' }}>
                      {file.error ?? `${formatBytes(file.size)} · ${file.headers.length} columns`}
                    </p>
                  </div>
                </div>
                <span className="text-right text-[0.9375rem] font-medium tabular-nums">{file.rows.length}</span>
                <button
                  type="button"
                  className="app-icon-button"
                  onClick={() => removeFile(file.id)}
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto grid grid-cols-3 gap-3 pt-3">
        <ImportStat label="Files" value={files.length.toString()} />
        <ImportStat label="Rows" value={totalRows.toString()} />
        <ImportStat label="Mapped" value={mappedFieldCount.toString()} />
      </div>
    </ImportStep>
  )
}
