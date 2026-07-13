import { useRef, type ChangeEvent } from 'react'
import { FileText, LoaderCircle, Upload, X } from 'lucide-react'
import { IMPORT_INSET_STYLE } from '../../constants'
import { ImportStat, ImportStep } from '../../components'
import type { ImportFileDraft } from '../../types'
import { formatBytes } from '../../utils'
import type { FireflyImportWorkflow } from '../hooks'
import type { FireflyFileKind } from '../types'

type FireflyFilesStepProps = Pick<
  FireflyImportWorkflow,
  | 'transactionsFile'
  | 'accountsFile'
  | 'budgetsFile'
  | 'processingFileKind'
  | 'fireflyRows'
  | 'trackedAccountNames'
  | 'importedCategories'
  | 'handleFireflyFileChange'
  | 'removeFireflyFile'
>

const FILE_SLOTS: Array<{ kind: FireflyFileKind; label: string; hint: string; required: boolean }> = [
  { kind: 'transactions', label: 'Transactions CSV', hint: 'The journal rows to import.', required: true },
  { kind: 'accounts', label: 'Accounts CSV', hint: 'Prefills new account types and currencies.', required: false },
  { kind: 'budgets', label: 'Budgets CSV', hint: 'Enables budget import after the transactions commit.', required: false },
]

export function FireflyFilesStep({
  transactionsFile,
  accountsFile,
  budgetsFile,
  processingFileKind,
  fireflyRows,
  trackedAccountNames,
  importedCategories,
  handleFireflyFileChange,
  removeFireflyFile,
}: FireflyFilesStepProps) {
  const filesByKind: Record<FireflyFileKind, ImportFileDraft | null> = {
    transactions: transactionsFile,
    accounts: accountsFile,
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
          onFileChange={handleFireflyFileChange}
          onRemove={removeFireflyFile}
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
 * One upload slot that swaps between its upload button and the staged file row
 */
function FireflyFileSlot({
  kind,
  label,
  hint,
  required,
  file,
  processing,
  disabled,
  onFileChange,
  onRemove,
}: {
  kind: FireflyFileKind
  label: string
  hint: string
  required: boolean
  file: ImportFileDraft | null
  processing: boolean
  disabled: boolean
  onFileChange: (kind: FireflyFileKind, event: ChangeEvent<HTMLInputElement>) => void
  onRemove: (kind: FireflyFileKind) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

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
        disabled={disabled}
      />
      {file ? (
        <div
          className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-3 rounded-lg px-3 py-3"
          style={IMPORT_INSET_STYLE}
        >
          <div className="flex min-w-0 items-center gap-3">
            <FileText size={17} className="shrink-0" style={{ color: 'var(--app-text-muted)' }} aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-[0.9375rem] font-medium">{file.name}</p>
              <p className="truncate text-xs" style={{ color: file.error ? 'var(--app-negative)' : 'var(--app-text-subtle)' }}>
                {file.error ?? `${formatBytes(file.size)} · ${file.rows.length} rows`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="app-icon-button"
            onClick={() => onRemove(kind)}
            aria-label={`Remove ${file.name}`}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors duration-150 hover:bg-[var(--app-surface-soft)] disabled:cursor-wait"
          style={{
            ...IMPORT_INSET_STYLE,
            color: 'var(--app-text-muted)',
          }}
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-busy={processing}
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center"
            style={{ background: 'var(--app-surface-soft)', color: processing ? 'var(--app-accent)' : undefined }}
            aria-hidden
          >
            {processing ? (
              <LoaderCircle size={17} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Upload size={16} />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
              {processing ? 'Processing CSV' : `Upload ${label.toLowerCase()}`}
            </span>
            <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--app-text-subtle)' }}>
              {hint}
            </span>
          </span>
        </button>
      )}
    </div>
  )
}
