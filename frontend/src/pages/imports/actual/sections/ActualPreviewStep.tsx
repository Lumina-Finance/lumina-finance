import { ImportProviderPreviewStep } from '@/pages/imports/sections'
import { getProviderSkippedRowsDisplay } from '@/pages/imports/utils'
import { ActualSkippedRowsTable } from '@/pages/imports/actual/components'
import { IMPORT_SAMPLE_PREVIEW_LIMIT } from '@/pages/imports/constants'
import { ACTUAL_TRANSACTION_DECIMALS } from '@/pages/imports/actual/constants'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'

type ActualPreviewStepProps = Pick<
  ActualImportWorkflow,
  | 'budget'
  | 'importEstimate'
  | 'previewGroups'
  | 'predictedSkippedRows'
  | 'completedImport'
  | 'newAccountCount'
  | 'newCategoryCount'
  | 'importBuild'
  | 'importError'
  | 'importResult'
  | 'canCommitImport'
  | 'handleCommitImport'
>

/**
 * Preview and commit step of the Actual Budget import flow
 */
export function ActualPreviewStep({
  budget,
  importEstimate,
  previewGroups,
  predictedSkippedRows,
  completedImport,
  newAccountCount,
  newCategoryCount,
  importBuild,
  importError,
  importResult,
  canCommitImport,
  handleCommitImport,
}: ActualPreviewStepProps) {
  const skipped = getProviderSkippedRowsDisplay({ liveForecastRows: predictedSkippedRows, completedImport })

  return (
    <ImportProviderPreviewStep
      // The budget step only exists once an export is staged
      hasBudgetStep={Boolean(budget)}
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
        <ActualSkippedRowsTable title={skipped.title} rows={skipped.rows} decimals={budget?.budgetDecimals ?? ACTUAL_TRANSACTION_DECIMALS} />
      )}
    </ImportProviderPreviewStep>
  )
}
