import type { CsvRow, PreviewTransactionRow } from '@/pages/imports/types'
import { buildPreviewTransactionRow, getPreviewCounterpartyScope } from '@/pages/imports/utils'
import {
  getFireflyRowDate,
  getFireflyRowSentNotes,
  getFireflySplitGroupSizes,
  isFireflyRowUploadable,
  splitFireflyTags,
  type FireflySplitGroupSizes,
} from './derivation'
import { resolveFireflyRowLegs, type FireflyResolvedLeg, type FireflyRowResolutionOptions } from './rowResolution'

interface BuildFireflyPreviewRowsOptions extends FireflyRowResolutionOptions {
  rows: CsvRow[]
  limit: number
}

/**
 * Compiles the first uploadable journal rows into capped ledger preview rows
 * by applying the account and category mappings the same way the commit will
 *
 * Gated on the same rule the payload build uses, so a row the upload drops is
 * never shown here as a transaction that will be created while the skipped
 * table beside it says the opposite
 */
export function buildFireflyPreviewRows(options: BuildFireflyPreviewRowsOptions): PreviewTransactionRow[] {
  const previewRows: PreviewTransactionRow[] = []
  const timestamp = new Date().toISOString()
  const groupSizes = getFireflySplitGroupSizes(options.rows)

  // Rows are walked in export order and the loop stops at the cap because the
  // preview only renders a small sample
  for (const row of options.rows) {
    if (previewRows.length >= options.limit) break
    if (!isFireflyRowUploadable(row, groupSizes)) continue

    const resolution = resolveFireflyRowLegs(row, options)
    if (!resolution.legs) continue

    for (const [legIndex, leg] of resolution.legs.entries()) {
      if (previewRows.length >= options.limit) break
      previewRows.push(buildFireflyPreviewRow(row, leg, legIndex, timestamp, groupSizes))
    }
  }

  return previewRows
}

/**
 * Wraps one resolved leg in the shape the shared transaction row renders
 */
function buildFireflyPreviewRow(
  row: CsvRow,
  leg: FireflyResolvedLeg,
  legIndex: number,
  timestamp: string,
  groupSizes: FireflySplitGroupSizes,
): PreviewTransactionRow {
  // The commit joins the journal description and the notes the row is sent with into the leg notes
  const notes = [row.description, getFireflyRowSentNotes(row, groupSizes)]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join('\n')

  // An account queued for creation carries the create sentinel until the import mints its id, the
  // same stand-in the leg's own account uses. A transfer leg with no second endpoint in the export
  // records that the money left the app, as the commit does
  return buildPreviewTransactionRow({
    id: `firefly-preview-${row.journal_id.trim()}-${legIndex}`,
    account: leg.account,
    category: leg.category,
    dt: getFireflyRowDate(row.date ?? ''),
    amount: leg.amount,
    merchantName: leg.merchantName,
    notes: notes || null,
    counterpartyAccount: leg.counterpartyAccount,
    counterpartyScope: getPreviewCounterpartyScope(leg.category, leg.counterpartyAccount),
    tagNames: splitFireflyTags(row.tags ?? ''),
    timestamp,
  })
}
