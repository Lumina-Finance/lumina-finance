import { ImportCommitFooter } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

type ImportCommitPanelProps = Pick<
  TransactionImportWorkflow,
  'importError' | 'handleCommitImport' | 'canCommitImport' | 'importResult'
>

/**
 * Commit panel for the generic CSV import flow, holding the button and the reason a commit that was
 * actually attempted came back refused
 *
 * Everything the import knows before the button is pressed is shown in the preview step above,
 * against the rows and columns it is about, so nothing here repeats it
 */
export function ImportCommitPanel({
  importError,
  handleCommitImport,
  canCommitImport,
  importResult,
}: ImportCommitPanelProps) {
  return (
    <ImportCommitFooter
      importError={importError}
      canCommit={canCommitImport}
      imported={Boolean(importResult)}
      onCommit={handleCommitImport}
      className="pb-1"
    />
  )
}
