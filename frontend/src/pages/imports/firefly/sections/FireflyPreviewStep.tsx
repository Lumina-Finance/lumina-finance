import { ImportRowProblemsTable } from '@/pages/imports/components'
import { ImportProviderPreviewStep } from '@/pages/imports/sections'
import { getProviderSkippedRowsDisplay } from '@/pages/imports/utils'
import { FireflySkippedRowsTable } from '@/pages/imports/firefly/components'
import { IMPORT_SAMPLE_PREVIEW_LIMIT } from '@/pages/imports/constants'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'

type FireflyPreviewStepProps = Pick<
  FireflyImportWorkflow,
  | 'importEstimate'
  | 'previewGroups'
  | 'predictedSkippedRows'
  | 'predictedRowWarnings'
  | 'completedImport'
  | 'fireflyHeaders'
  | 'newAccountCount'
  | 'newCategoryCount'
  | 'budgetsFile'
  | 'importBuild'
  | 'importError'
  | 'importResult'
  | 'canCommitImport'
  | 'handleCommitImport'
>

/**
 * Preview and commit step of the Firefly III import flow, which also lists the rows that import but
 * are worth a look
 */
export function FireflyPreviewStep({
  importEstimate,
  previewGroups,
  predictedSkippedRows,
  predictedRowWarnings,
  completedImport,
  fireflyHeaders,
  newAccountCount,
  newCategoryCount,
  budgetsFile,
  importBuild,
  importError,
  importResult,
  canCommitImport,
  handleCommitImport,
}: FireflyPreviewStepProps) {
  const skipped = getProviderSkippedRowsDisplay({ liveForecastRows: predictedSkippedRows, completedImport })

  return (
    <ImportProviderPreviewStep
      // The budget step only exists when a budgets export is staged
      hasBudgetStep={Boolean(budgetsFile)}
      sampleLimit={IMPORT_SAMPLE_PREVIEW_LIMIT}
      stats={{ ...importEstimate, newAccountCount, newCategoryCount }}
      previewGroups={previewGroups}
      buildError={importBuild.errors[0] ?? null}
      importError={importError}
      imported={Boolean(importResult)}
      canCommit={canCommitImport}
      onCommit={handleCommitImport}
    >
      {skipped.totalCount > 0 && (
        <FireflySkippedRowsTable
          title={skipped.title}
          rows={skipped.rows}
          totalCount={skipped.totalCount}
          headers={fireflyHeaders}
        />
      )}

      {predictedRowWarnings.length > 0 && (
        <div className="mb-4">
          <ImportRowProblemsTable
            title={`${predictedRowWarnings.length} row${predictedRowWarnings.length === 1 ? '' : 's'} worth a look`}
            rowProblems={predictedRowWarnings}
            headers={fireflyHeaders}
            toggleLabel="rows worth a look"
            tone="warning"
            reasonHeader="Note"
          />
        </div>
      )}
    </ImportProviderPreviewStep>
  )
}
