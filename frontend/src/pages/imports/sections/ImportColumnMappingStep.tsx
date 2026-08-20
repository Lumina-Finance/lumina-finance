import { EmptyState, ImportDirectionValueTable, ImportHeaderMappingTable, ImportNotice, ImportStep } from '@/pages/imports/components'
import {
  CURRENCY_HANDLING_NOTE,
  CURRENCY_HANDLING_TITLE,
  DIRECTION_VALUES_EXPLANATION,
  DIRECTION_VALUES_TITLE,
  getFixedAccountCurrencyNote,
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
  | 'fixedAccount'
  | 'accountsFailed'
  | 'setDateFormat'
  | 'setDirectionAnswer'
  | 'updateColumnTarget'
>

/**
 * Column mapping step of the generic CSV import flow, matching each header found in the uploaded
 * file to an app field
 *
 * How an amount is read is left to the mapping dropdown, whose every option carries a sentence
 * saying what that field holds and what a sign in it means. Those sentences are read at the moment
 * of choosing, so a notice above the table restating them was one level less specific and said
 * nothing the dropdown did not
 *
 * The currency note stays, because nothing in the dropdown says which currency an amount lands in
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
  fixedAccount,
  accountsFailed,
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
      {!accountsFailed && (
        <ImportNotice title={CURRENCY_HANDLING_TITLE}>
          {fixedAccount
            ? getFixedAccountCurrencyNote(fixedAccount.name, fixedAccount.currency)
            : CURRENCY_HANDLING_NOTE}
        </ImportNotice>
      )}
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
          <ImportNotice title={DIRECTION_VALUES_TITLE} tone="question">
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
