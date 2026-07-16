import { EmptyState, ImportPreviewList, ImportStep } from '../components'
import type { TransactionImportWorkflow } from '../hooks'

type ImportPreviewStepProps = Pick<
  TransactionImportWorkflow,
  'missingRequiredColumnLabels' | 'previewRows' | 'previewGroups'
>

export function ImportPreviewStep({
  missingRequiredColumnLabels,
  previewRows,
  previewGroups,
}: ImportPreviewStepProps) {
  return (
    <ImportStep
      index="07"
      title="Imported Data Preview"
      description="Showing the first 5 compiled transactions."
    >
      {missingRequiredColumnLabels.length > 0 ? (
        <EmptyState
          title="Missing required columns"
          description={missingRequiredColumnLabels.join(', ')}
        />
      ) : previewRows.length === 0 ? (
        <EmptyState
          title="No preview rows"
          description="Mapped rows will appear here."
        />
      ) : (
        <ImportPreviewList groups={previewGroups} />
      )}
    </ImportStep>
  )
}
