import { EmptyState, ImportHeaderMappingTable, ImportNotice, ImportStep } from '@/pages/imports/components'
import {
  AMOUNT_ARRANGEMENT_CLASH_ERROR,
  AMOUNT_ARRANGEMENT_CLASH_TITLE,
  AMOUNT_CONVENTION_NOTE,
  getRowsWithNoPayeeExplanation,
  ROWS_WITH_NO_PAYEE_TITLE,
} from '@/pages/imports/constants'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'
import { hasAmountArrangementClash } from '@/pages/imports/utils'

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
  | 'amountSignConventions'
  | 'rowsWithNoPayeeCount'
  | 'setDateFormat'
  | 'setAmountSignConvention'
  | 'updateColumnTarget'
>

/**
 * Column mapping step of the generic CSV import flow, matching each header found in the uploaded
 * file to an app field
 *
 * The amount convention is stated above the table rather than offered as a choice, because which
 * arrangement a file uses is answered by mapping its columns rather than by a question of its own.
 * It sits where the account step states its own currency handling, since both say what the import
 * will do with a number rather than asking anything
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
  amountSignConventions,
  rowsWithNoPayeeCount,
  setDateFormat,
  setAmountSignConvention,
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
          amountSignConventions={amountSignConventions}
          onChange={updateColumnTarget}
          onDateFormatChange={setDateFormat}
          onAmountSignConventionChange={setAmountSignConvention}
        />
      )}
      {hasAmountArrangementClash(columnMap) && (
        <div className="mt-4">
          <ImportNotice title={AMOUNT_ARRANGEMENT_CLASH_TITLE} tone="danger">
            {AMOUNT_ARRANGEMENT_CLASH_ERROR}
          </ImportNotice>
        </div>
      )}
      {rowsWithNoPayeeCount > 0 && (
        <div className="mt-4">
          <ImportNotice title={ROWS_WITH_NO_PAYEE_TITLE}>
            {getRowsWithNoPayeeExplanation(rowsWithNoPayeeCount, Boolean(columnMap.merchant_id))}
          </ImportNotice>
        </div>
      )}
    </ImportStep>
  )
}
