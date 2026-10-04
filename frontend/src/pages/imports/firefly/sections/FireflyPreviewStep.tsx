import { ImportRowProblemsTable, ImportRowWarningsTable } from '@/pages/imports/components'
import { ImportPreviewLayout } from '@/pages/imports/sections'
import { getProviderSkippedRowsDisplay } from '@/pages/imports/utils'
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
    <ImportPreviewLayout
      // The budget step only exists when a budgets export is staged
      index={budgetsFile ? '05' : '04'}
      stats={{ ...importEstimate, newAccountCount, newCategoryCount }}
      previewGroups={previewGroups}
      emptyDescription="Transactions compiled from the export will appear here."
      buildError={importBuild.errors[0] ?? null}
      importError={importError}
      imported={Boolean(importResult)}
      canCommit={canCommitImport}
      onCommit={handleCommitImport}
    >
      {skipped.totalCount > 0 && (
        <ImportRowProblemsTable
          title={skipped.title}
          rowProblems={skipped.rows}
          headers={fireflyHeaders}
          toggleLabel="skipped rows"
        />
      )}

      <ImportRowWarningsTable rowWarnings={predictedRowWarnings} headers={fireflyHeaders} />
    </ImportPreviewLayout>
  )
}
