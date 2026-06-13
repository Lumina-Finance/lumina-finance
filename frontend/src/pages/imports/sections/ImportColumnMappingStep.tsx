import { EmptyState, ImportHeaderMappingTable, ImportStep } from '../components'
import type { TransactionImportWorkflow } from '../hooks'

type ImportColumnMappingStepProps = Pick<
  TransactionImportWorkflow,
  'headers' | 'files' | 'columnTargetOptions' | 'autoFilledColumnHeaders' | 'columnMap' | 'columnValidationErrors' | 'updateColumnTarget'
>

export function ImportColumnMappingStep({
  headers,
  files,
  columnTargetOptions,
  autoFilledColumnHeaders,
  columnMap,
  columnValidationErrors,
  updateColumnTarget,
}: ImportColumnMappingStepProps) {
  return (
    <ImportStep
      index="02"
      title="Column Mapping"
      description="Map each file column to an app field."
    >
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
          onChange={updateColumnTarget}
        />
      )}
    </ImportStep>
  )
}
