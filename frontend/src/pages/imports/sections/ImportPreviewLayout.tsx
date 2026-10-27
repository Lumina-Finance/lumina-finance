import type { ComponentProps, ReactNode } from 'react'
import {
  EmptyState,
  ImportCommitFooter,
  ImportPreviewList,
  ImportStat,
  ImportStep,
  type ImportCommitCheck,
} from '@/pages/imports/components'
import { IMPORT_SAMPLE_PREVIEW_LIMIT, UNKNOWN_IMPORT_FIGURE } from '@/pages/imports/constants'

/** The four figures every import's preview opens with */
export interface ImportPreviewStats {
  rowCount: number

  /** Null while how many rows the import leaves out is unknown, which a CSV import's chosen dates can leave it */
  transactionEstimate: number | null
  newAccountCount: number
  newCategoryCount: number
}

/**
 * Preview and commit step every import shares: the summary figures, what the import has to say
 * about its rows, a sample of the transactions the commit will create, and the button that starts
 * the commit
 *
 * @param index - The step's number, which follows however many steps the import has before it
 * @param blocked - Shown in place of the sample, while what it lists stands between the answers and
 *   a commit. A half-built sample beside a list of reasons it is wrong would read as the real result
 */
export function ImportPreviewLayout({
  index,
  stats,
  children,
  blocked,
  previewGroups,
  emptyDescription,
  buildError = null,
  check = null,
  importError,
  importErrorLang,
  imported,
  canCommit,
  onCommit,
}: {
  index: string
  stats: ImportPreviewStats

  /** The rows left out or to fix and the rows worth a look, shown between the summary and the sample */
  children?: ReactNode
  blocked?: ReactNode
  previewGroups: ComponentProps<typeof ImportPreviewList>['groups']

  /** Says where the sample comes from while it has no rows */
  emptyDescription: string

  /** The first thing the answers still need, said beside the button, for an import that doesn't list them above */
  buildError?: string | null

  /** A check the server is running or could not finish, which holds the commit until it has answered */
  check?: ImportCommitCheck | null
  importError: string | null

  /** The language of the import error when it is the server's own English rather than the page's */
  importErrorLang?: string
  imported: boolean
  canCommit: boolean
  onCommit: () => void
}) {
  return (
    <ImportStep
      index={index}
      title="Preview and commit"
      description={`Showing the first ${IMPORT_SAMPLE_PREVIEW_LIMIT} transactions as they will appear in your ledger.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ImportStat label="Rows" value={stats.rowCount.toString()} />
        <ImportStat label="Will create" value={stats.transactionEstimate?.toString() ?? UNKNOWN_IMPORT_FIGURE} />
        <ImportStat label="New accounts" value={stats.newAccountCount.toString()} />
        <ImportStat label="New categories" value={stats.newCategoryCount.toString()} />
      </div>

      {children}

      {blocked ?? (previewGroups.length === 0 ? (
        <EmptyState title="No preview rows" description={emptyDescription} />
      ) : (
        <ImportPreviewList groups={previewGroups} />
      ))}

      <ImportCommitFooter
        buildError={buildError}
        check={check}
        importError={importError}
        importErrorLang={importErrorLang}
        canCommit={canCommit}
        imported={imported}
        onCommit={onCommit}
        className="pt-2"
      />
    </ImportStep>
  )
}
