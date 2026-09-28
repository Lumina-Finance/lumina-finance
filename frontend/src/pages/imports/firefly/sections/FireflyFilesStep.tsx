import { ImportFileSlot, ImportFilesStepLayout, ImportStagedFileList } from '@/pages/imports/components'
import type { ImportFileDraft } from '@/pages/imports/types'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'
import type { FireflyFileKind } from '@/pages/imports/firefly/types'

type FireflyFilesStepProps = Pick<
  FireflyImportWorkflow,
  | 'transactionsFile'
  | 'budgetsFile'
  | 'accountsFile'
  | 'processingFileKind'
  | 'fileIntakeErrors'
  | 'fireflyRows'
  | 'trackedAccounts'
  | 'importedCategories'
  | 'handleFireflyFileChange'
  | 'removeFireflyFile'
  | 'uploadBlockReason'
>

// Firefly III's own guide, linked rather than repeated so the steps stay current as its screens change
const FIREFLY_EXPORT_DOCS_URL = 'https://docs.firefly-iii.org/tutorials/firefly-iii/exporting-data/'

// Each optional slot's hint says what skipping it costs
const FILE_SLOTS: Array<{ kind: FireflyFileKind; label: string; hint: string; required: boolean }> = [
  { kind: 'transactions', label: 'Transactions CSV', hint: 'The journal rows to import.', required: true },
  { kind: 'budgets', label: 'Budgets CSV', hint: 'Without it, create budgets by hand after the import.', required: false },
  { kind: 'accounts', label: 'Accounts CSV', hint: 'Without it, every account comes across as active checking.', required: false },
]

/**
 * Files step of the Firefly III import flow, with a required slot for the transactions export and
 * optional ones for the budgets and accounts exports, plus row, account, and category counts once
 * files are staged
 */
export function FireflyFilesStep({
  transactionsFile,
  budgetsFile,
  accountsFile,
  processingFileKind,
  fileIntakeErrors,
  fireflyRows,
  trackedAccounts,
  importedCategories,
  handleFireflyFileChange,
  removeFireflyFile,
  uploadBlockReason,
}: FireflyFilesStepProps) {
  const filesByKind: Record<FireflyFileKind, ImportFileDraft | null> = {
    transactions: transactionsFile,
    budgets: budgetsFile,
    accounts: accountsFile,
  }

  return (
    <ImportFilesStepLayout
      title="Files"
      description={(
        <>
          Upload the CSV files exported from Firefly III, following its{' '}
          <a
            href={FIREFLY_EXPORT_DOCS_URL}
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
        { label: 'Rows', value: fireflyRows.length },
        { label: 'Accounts', value: trackedAccounts.length },
        { label: 'Categories', value: importedCategories.length },
      ]}
    >
      {FILE_SLOTS.map((slot, slotIndex) => {
        const file = filesByKind[slot.kind]

        // A rejected file never becomes a staged file, so the slot keeps its upload card and
        // reports the refusal in place
        const stagedFile = file && !file.error ? file : null

        return (
          <ImportFileSlot
            key={slot.kind}
            label={slot.label}
            required={slot.required}
            accept=".csv,text/csv"
            uploadTitle={`Upload ${slot.label.toLowerCase()}`}
            hint={slot.hint}
            staged={stagedFile && <ImportStagedFileList files={[stagedFile]} onRemove={() => removeFireflyFile(slot.kind)} />}
            processing={processingFileKind === slot.kind}
            // Every slot answers to a block, even where only one states why
            disabled={processingFileKind !== null || uploadBlockReason !== null}
            rejection={fileIntakeErrors[slot.kind] ?? file?.error ?? null}
            // A block is about the step rather than any one slot, so it is stated on the slot the
            // user reaches first and the others are only disabled. Repeating it would read as
            // separate problems, and each slot's message is a live region a screen reader announces
            blockReason={slotIndex === 0 ? uploadBlockReason : null}
            onFileChange={(selection) => handleFireflyFileChange(slot.kind, selection)}
          />
        )
      })}
    </ImportFilesStepLayout>
  )
}
