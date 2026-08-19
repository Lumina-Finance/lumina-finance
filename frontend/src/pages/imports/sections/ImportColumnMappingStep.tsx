import { EmptyState, ImportDirectionValueTable, ImportHeaderMappingTable, ImportNotice, ImportStep } from '@/pages/imports/components'
import {
  AMOUNT_CONVENTION_NOTE,
  DIRECTION_VALUES_EXPLANATION,
  DIRECTION_VALUES_TITLE,
  getRowsWithNoPayeeExplanation,
  ROWS_WITH_NO_PAYEE_TITLE,
} from '@/pages/imports/constants'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'
import { getAmountArrangementClashError } from '@/pages/imports/utils'

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
  | 'directionValues'
  | 'directionAnswers'
  | 'autoFilledDirectionValues'
  | 'rowsWithNoPayeeCount'
  | 'setDateFormat'
  | 'setDirectionAnswer'
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
 *
 * A file mapping a Direction column has one more question, which words in that column mean money
 * leaving the account. It is asked here rather than in a separate step, so the column and what its
 * words mean stay on one screen
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
  directionValues,
  directionAnswers,
  autoFilledDirectionValues,
  rowsWithNoPayeeCount,
  setDateFormat,
  setDirectionAnswer,
  updateColumnTarget,
}: ImportColumnMappingStepProps) {
  const arrangementClash = getAmountArrangementClashError(columnMap)

  // The panel is held back while the column itself is refused, which is what a column of more words
  // than a direction has gets. Asking what six words mean under a message saying six is too many
  // would ask the user to answer a question the app has already refused
  const isDirectionColumnRefused = Boolean(columnMap.amount_direction && columnValidationErrors[columnMap.amount_direction])
  const showsDirectionValues = directionValues.length > 0 && !isDirectionColumnRefused && !arrangementClash

  return (
    <ImportStep
      index="02"
      title="Column Mapping"
      description="Specify what each column in your file holds."
    >
      <ImportNotice title="How amounts are read">
        {AMOUNT_CONVENTION_NOTE}
      </ImportNotice>
      {headers.length === 0 ? (
        <EmptyState
          title="No columns yet"
          description="Upload a CSV file and its columns appear here."
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
      {showsDirectionValues && (
        <div className="mt-4 space-y-3">
          <ImportNotice title={DIRECTION_VALUES_TITLE}>
            {DIRECTION_VALUES_EXPLANATION}
          </ImportNotice>
          <ImportDirectionValueTable
            values={directionValues}
            answers={directionAnswers}
            autoFilledValues={autoFilledDirectionValues}
            onChange={setDirectionAnswer}
          />
        </div>
      )}
      {arrangementClash && (
        <div className="mt-4">
          <ImportNotice title={arrangementClash.title} tone="danger">
            {arrangementClash.message}
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
