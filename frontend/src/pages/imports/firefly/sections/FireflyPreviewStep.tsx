import { ImportRowProblemsTable, ImportRowWarningsTable } from '@/pages/imports/components'
import { ImportProviderPreviewStep } from '@/pages/imports/sections'
import { getProviderSkippedRowsDisplay } from '@/pages/imports/utils'
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
        <ImportRowProblemsTable
          title={skipped.title}
          rowProblems={skipped.rows}
          headers={fireflyHeaders}
          toggleLabel="skipped rows"
        />
      )}

      <ImportRowWarningsTable rowWarnings={predictedRowWarnings} headers={fireflyHeaders} />
    </ImportProviderPreviewStep>
  )
}
