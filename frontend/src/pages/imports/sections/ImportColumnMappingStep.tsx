import { EmptyState, ImportCheckbox, ImportHeaderMappingTable, ImportNotice, ImportStep } from '@/pages/imports/components'
import {
  AMOUNT_CONVENTION_NOTE,
  getRowsWithNoPayeeExplanation,
  ROWS_WITH_NO_PAYEE_CHECKBOX_LABEL,
  ROWS_WITH_NO_PAYEE_TITLE,
  UNKNOWN_MERCHANT_NAME,
} from '@/pages/imports/constants'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

type ImportColumnMappingStepProps = Pick<
  TransactionImportWorkflow,
  | 'headers'
  | 'files'
  | 'columnTargetOptions'
  | 'autoFilledColumnHeaders'
  | 'columnMap'
  | 'columnValidationErrors'
  | 'dateFormat'
  | 'dateFormatScan'
  | 'rowsWithNoPayeeCount'
  | 'importRowsWithNoPayee'
  | 'setDateFormat'
  | 'setImportRowsWithNoPayee'
  | 'updateColumnTarget'
>

/**
 * Column mapping step of the generic CSV import flow, matching each header found in the uploaded
 * file to an app field
 *
 * The amount convention is stated above the table rather than offered as a choice, because the file
 * is read one way only and a statement written to another convention has to be corrected before it
 * is uploaded. It sits where the account step states its own currency handling, since both say what
 * the import will do with a number rather than asking anything
 */
export function ImportColumnMappingStep({
  headers,
  files,
  columnTargetOptions,
  autoFilledColumnHeaders,
  columnMap,
  columnValidationErrors,
  dateFormat,
  dateFormatScan,
  rowsWithNoPayeeCount,
  importRowsWithNoPayee,
  setDateFormat,
  setImportRowsWithNoPayee,
  updateColumnTarget,
}: ImportColumnMappingStepProps) {
  return (
    <ImportStep
      index="02"
      title="Column Mapping"
      description="Map each file column to an app field."
    >
      <ImportNotice title="Amount Handling">
        {AMOUNT_CONVENTION_NOTE}
      </ImportNotice>
      {headers.length === 0 ? (
        <EmptyState
          title="No columns available"
          description="Upload a CSV file to map columns."
        />
      ) : (
        <ImportHeaderMappingTable
          headers={headers}
          files={files}
          options={columnTargetOptions}
          autoFilledHeaders={autoFilledColumnHeaders}
          columnMap={columnMap}
          validationErrors={columnValidationErrors}
          dateFormat={dateFormat}
          dateFormatScan={dateFormatScan}
          onChange={updateColumnTarget}
          onDateFormatChange={setDateFormat}
        />
      )}
      {rowsWithNoPayeeCount > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          <ImportNotice title={ROWS_WITH_NO_PAYEE_TITLE}>
            {getRowsWithNoPayeeExplanation(rowsWithNoPayeeCount, UNKNOWN_MERCHANT_NAME)}
          </ImportNotice>
          <div className="flex items-center gap-2 px-4">
            {/* The checkbox centres itself for the table cells it was written for, so it is boxed
                to its own size here and the label stays beside it rather than being pushed away */}
            <span className="flex h-5 w-5 shrink-0">
              <ImportCheckbox
                checked={importRowsWithNoPayee}
                label={ROWS_WITH_NO_PAYEE_CHECKBOX_LABEL}
                onChange={() => setImportRowsWithNoPayee(!importRowsWithNoPayee)}
              />
            </span>
            <span className="text-sm" style={{ color: 'var(--app-text)' }}>
              {ROWS_WITH_NO_PAYEE_CHECKBOX_LABEL}
            </span>
          </div>
        </div>
      )}
    </ImportStep>
  )
}
