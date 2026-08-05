import { EmptyState, ImportPreviewList, ImportRowProblemsTable, ImportStep } from '@/pages/imports/components'
import { getRowExclusionsTitle } from '@/pages/imports/constants'
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
 * Builds the heading over the rows that will import but are worth a look, which says they are not
 * blocking so the two tables are not read as the same thing
 */
function getRowWarningsTitle(count: number) {
  return `${count} row${count === 1 ? '' : 's'} will import but may not be what you meant`
}

/**
 * Preview step of the generic CSV import flow, showing a sample of the compiled transactions or,
 * when required columns are still unmapped, which ones are missing instead
 *
 * Rows that cannot be converted are listed above the sample with the reason each was refused, and
 * the import stays refused until every one of them is gone. Rows that will import but are probably
 * not what the user meant are listed under them, and hold nothing up, as are the rows the user
 * chose to leave out, which the sample also leaves out
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
      {importBuild.rowWarnings.length > 0 && (
        <div className="mb-4">
          <ImportRowProblemsTable
            title={getRowWarningsTitle(importBuild.rowWarnings.length)}
            rowProblems={importBuild.rowWarnings}
            headers={headers}
            toggleLabel="rows to check"
          />
        </div>
      )}
      {importBuild.rowExclusions.length > 0 && (
        <div className="mb-4">
          <ImportRowProblemsTable
            title={getRowExclusionsTitle(importBuild.rowExclusions.length)}
            rowProblems={importBuild.rowExclusions}
            headers={headers}
            toggleLabel="rows being left out"
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
