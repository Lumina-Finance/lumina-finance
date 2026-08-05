import { EmptyState, ImportCheckbox, ImportHeaderMappingTable, ImportNotice, ImportStep } from '@/pages/imports/components'
import {
  AMOUNT_CONVENTION_NOTE,
  getNoMerchantColumnExplanation,
  NO_MERCHANT_COLUMN_CHECKBOX_LABEL,
  NO_MERCHANT_COLUMN_TITLE,
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
  | 'noPayeeColumnConfirmed'
  | 'setDateFormat'
  | 'setNoPayeeColumnConfirmed'
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
  noPayeeColumnConfirmed,
  setDateFormat,
  setNoPayeeColumnConfirmed,
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
      {headers.length > 0 && !columnMap.merchant_id && (
        <div className="mt-4 flex flex-col gap-3">
          <ImportNotice title={NO_MERCHANT_COLUMN_TITLE}>
            {getNoMerchantColumnExplanation(UNKNOWN_MERCHANT_NAME)}
          </ImportNotice>
          <div className="flex items-center gap-2 px-4">
            {/* The checkbox centres itself for the table cells it was written for, so it is boxed
                to its own size here and the label stays beside it rather than being pushed away */}
            <span className="flex h-5 w-5 shrink-0">
              <ImportCheckbox
                checked={noPayeeColumnConfirmed}
                label={NO_MERCHANT_COLUMN_CHECKBOX_LABEL}
                onChange={() => setNoPayeeColumnConfirmed(!noPayeeColumnConfirmed)}
              />
            </span>
            <span className="text-sm" style={{ color: 'var(--app-text)' }}>
              {NO_MERCHANT_COLUMN_CHECKBOX_LABEL}
            </span>
          </div>
        </div>
      )}
    </ImportStep>
  )
}
