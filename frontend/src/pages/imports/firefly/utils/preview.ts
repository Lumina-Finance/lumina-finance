import type { CsvRow, PreviewTransactionRow } from '../../types'
import { getPreviewDateLabel } from '../../utils'
import { getFireflyRowDate, isFireflyRowImportable, splitFireflyTags } from './derivation'
import { resolveFireflyRowLegs, type FireflyResolvedLeg, type FireflyRowResolutionOptions } from './rowResolution'

interface BuildFireflyPreviewRowsOptions extends FireflyRowResolutionOptions {
  rows: CsvRow[]
  limit: number
}

/**
 * Compiles the first importable journal rows into capped ledger preview rows
 * by applying the account and category mappings the same way the commit will
 */
export function buildFireflyPreviewRows(options: BuildFireflyPreviewRowsOptions): PreviewTransactionRow[] {
  const previewRows: PreviewTransactionRow[] = []
  const timestamp = new Date().toISOString()

  // Rows are walked in export order and the loop stops at the cap because the
  // preview only renders a small sample
  for (const row of options.rows) {
    if (previewRows.length >= options.limit) break
    if (!isFireflyRowImportable(row)) continue

    const resolution = resolveFireflyRowLegs(row, options)
    if (resolution.skipReason !== null) continue

    for (const [legIndex, leg] of resolution.legs.entries()) {
      if (previewRows.length >= options.limit) break
      previewRows.push(buildFireflyPreviewRow(row, leg, legIndex, timestamp))
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
): PreviewTransactionRow {
  const id = `firefly-preview-${row.journal_id.trim()}-${legIndex}`
  const dt = getFireflyRowDate(row.date ?? '')
  const tagNames = splitFireflyTags(row.tags ?? '')
  const tagIds = tagNames.map((tag, tagIndex) => `${id}-tag-${tagIndex}-${tag}`)

  // The commit joins the journal description and notes into the leg notes
  const notes = [row.description, row.notes]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join('\n')

  return {
    id,
    accountInstitution: leg.account.institution,
    accountName: leg.account.name,
    category: leg.category,
    currency: leg.account.currency,
    dateLabel: getPreviewDateLabel(dt),
    transaction: {
      id,
      created_by_user_id: 'import-preview',
      account_id: leg.account.id,
      dt,
      merchant_id: leg.merchantName ? `${id}-merchant` : null,
      merchant_name: leg.merchantName,
      category_id: leg.category?.id ?? '',
      amount: leg.amount,
      account_amount: leg.amount,
      base_currency_amount: leg.amount,
      currency: leg.account.currency,
      fx_rate: null,
      notes: notes || null,
      created_at: timestamp,
      updated_at: timestamp,
      tag_ids: tagIds,
      tags: tagNames.map((tag, tagIndex) => ({ id: tagIds[tagIndex], group_id: null, name: tag })),
    },
  }
}
