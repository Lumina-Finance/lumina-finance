import { OfxReveal } from '@/pages/imports/ofx/components/OfxReveal'
import { OfxSkippedRowsTable } from '@/pages/imports/ofx/components/OfxSkippedRowsTable'
import type { OfxImportWorkflow } from '@/pages/imports/ofx/hooks'
import { ImportPreviewLayout } from '@/pages/imports/sections'
import { getSkippedRowsDisplay } from '@/pages/imports/utils'

type OfxPreviewStepProps = Pick<
  OfxImportWorkflow,
  | 'importEstimate'
  | 'previewGroups'
  | 'predictedSkippedRows'
  | 'completedImport'
  | 'newAccountCount'
  | 'importBuild'
  | 'importError'
  | 'importResult'
  | 'canCommitImport'
  | 'handleCommitImport'
  | 'stagedFiles'
>

/**
 * Preview and commit step of the OFX import flow
 */
export function OfxPreviewStep({
  importEstimate,
  previewGroups,
  predictedSkippedRows,
  completedImport,
  newAccountCount,
  importBuild,
  importError,
  importResult,
  canCommitImport,
  handleCommitImport,
  stagedFiles,
}: OfxPreviewStepProps) {
  const skipped = getSkippedRowsDisplay({ liveForecastRows: predictedSkippedRows, completedImport })

  return (
    <ImportPreviewLayout
      index="03"
      stats={{ ...importEstimate, newAccountCount, newCategoryCount: 0 }}
      previewGroups={previewGroups}
      emptyDescription="Transactions compiled from the statement will appear here."
      buildError={importBuild.errors[0] ?? null}
      importError={importError}
      imported={Boolean(importResult)}
      canCommit={canCommitImport}
      onCommit={handleCommitImport}
    >
      <OfxReveal show={skipped.totalCount > 0}>
        <OfxSkippedRowsTable title={skipped.title} rows={skipped.rows} areFilesNamed={stagedFiles.length > 1} />
      </OfxReveal>
    </ImportPreviewLayout>
  )
}
