import { EmptyState, ImportPreviewList, ImportRowProblemsTable, ImportStep } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

type ImportPreviewStepProps = Pick<
  TransactionImportWorkflow,
  'missingRequiredColumnLabels' | 'previewRows' | 'previewGroups' | 'importBuild' | 'headers'
>

/**
 * Builds the heading over the rows that cannot be converted, which says what has to happen rather
 * than only how many there are
 */
function getRowProblemsTitle(count: number) {
  return `${count} row${count === 1 ? '' : 's'} must be fixed before importing`
}

/**
 * Preview step of the generic CSV import flow, showing a sample of the compiled transactions or,
 * when required columns are still unmapped, which ones are missing instead
 *
 * Rows that cannot be converted are listed above the sample with the reason each was refused, and
 * the import stays refused until every one of them is gone
 */
export function ImportPreviewStep({
  missingRequiredColumnLabels,
  previewRows,
  previewGroups,
  importBuild,
  headers,
}: ImportPreviewStepProps) {
  return (
    <ImportStep
      index="07"
      title="Imported Data Preview"
      description="Showing the first 5 compiled transactions."
    >
      {importBuild.rowProblems.length > 0 && (
        <div className="mb-4">
          <ImportRowProblemsTable
            title={getRowProblemsTitle(importBuild.rowProblems.length)}
            rowProblems={importBuild.rowProblems}
            headers={headers}
          />
        </div>
      )}
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
