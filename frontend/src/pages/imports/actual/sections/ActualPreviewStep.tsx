import { ImportPreviewLayout } from '@/pages/imports/sections'
import { getProviderSkippedRowsDisplay } from '@/pages/imports/utils'
import { ActualSkippedRowsTable } from '@/pages/imports/actual/components'
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
    <ImportPreviewLayout
      // The budget step only exists once an export is staged
      index={budget ? '05' : '04'}
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
        <ActualSkippedRowsTable title={skipped.title} rows={skipped.rows} decimals={budget?.budgetDecimals ?? ACTUAL_TRANSACTION_DECIMALS} />
      )}
    </ImportPreviewLayout>
  )
}
