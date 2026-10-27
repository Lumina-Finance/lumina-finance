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
  | 'heldCheckNotice'
  | 'importError'
  | 'importErrorLang'
  | 'importResult'
  | 'canCommitImport'
  | 'handleCommitImport'
  | 'stagedFiles'
  | 'fixedAccount'
>

/**
 * Preview and commit step of the OFX import flow, numbered second where an account's page has no
 * account step before it
 */
export function OfxPreviewStep({
  importEstimate,
  previewGroups,
  predictedSkippedRows,
  completedImport,
  newAccountCount,
  importBuild,
  heldCheckNotice,
  importError,
  importErrorLang,
  importResult,
  canCommitImport,
  handleCommitImport,
  stagedFiles,
  fixedAccount,
}: OfxPreviewStepProps) {
  const skipped = getSkippedRowsDisplay({ liveForecastRows: predictedSkippedRows, completedImport })

  return (
    <ImportPreviewLayout
      index={fixedAccount ? '02' : '03'}
      stats={{ ...importEstimate, newAccountCount, newCategoryCount: 0 }}
      previewGroups={previewGroups}
      emptyDescription="Transactions compiled from the statement will appear here."
      buildError={importBuild.errors[0] ?? null}
      check={heldCheckNotice}
      importError={importError}
      importErrorLang={importErrorLang}
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
