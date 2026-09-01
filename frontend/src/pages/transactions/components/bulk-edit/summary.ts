/**
 * Turns a bulk edit's choice into what the modal's summary panel shows: a row per detail the edit
 * sends, a note for anything it passes over, and a warning for anything the server would refuse.
 *
 * A pure function of its inputs, so the panel can be tested without rendering the modal that feeds
 * it. blockers is the one exception: it is computed by the caller rather than here, so the panel
 * and the Apply button can never disagree about what the server would refuse.
 */
import type { BulkDirectionChange } from '@/api/transactions'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import {
  buildBulkEditFields,
  countTransferEndEffects,
  resolveTransferEnds,
  type BulkEditBlockers,
  type BulkEditChoice,
  type SelectedTransactionFacts,
  type TransferEndChoice,
  type TransferEndEffect,
} from '@/pages/transactions/components/bulk-edit/selection'
import { DATE_FORMATS, formatDate, parseYmd } from '@/utils/date'
import { OUTSIDE_ACCOUNT_LABEL } from '@/utils/transfers'

/** One currency an own end would move blocked rows into, and how many rows share the pairing */
interface CurrencyMismatch {
  rowCurrency: string
  targetCurrency: string
  count: number
}

/**
 * Groups the rows blocked for sitting in another currency than the end they would move into, by the
 * pair of currencies involved, so the warning can name the right ones rather than assuming the
 * selection holds only one
 *
 * @param rows The selected transactions
 * @param blockedIds The row ids getBulkEditBlockers listed as ownSideInAnotherCurrency
 * @param choice What the edit holds
 * @param chosenCategoryRecordsTransferTarget Whether the category the edit sets records the other
 *     side, or undefined while the edit sets no category and each row keeps its own
 */
function groupCurrencyMismatches(
  rows: SelectedTransactionFacts[],
  blockedIds: string[],
  choice: BulkEditChoice,
  chosenCategoryRecordsTransferTarget: boolean | undefined,
): CurrencyMismatch[] {
  const blocked = new Set(blockedIds)
  const groups = new Map<string, CurrencyMismatch>()

  for (const row of rows) {
    if (!blocked.has(row.id)) continue
    const endsUpRecordingFarSide = chosenCategoryRecordsTransferTarget ?? row.recordsFarSide
    const { ownEnd } = resolveTransferEnds(row, choice, endsUpRecordingFarSide)
    if (ownEnd?.scope !== 'tracked') continue

    const key = `${row.currency}-${ownEnd.currency}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { rowCurrency: row.currency, targetCurrency: ownEnd.currency, count: 1 })
  }

  return [...groups.values()]
}

/** One line of the summary panel's row list: a control the edit touches and what it does */
export interface BulkEditSummaryRow {
  label: string
  value: string

  /** A second line under the value, such as who else an end moves or records */
  detail?: string
}

/**
 * Display text the modal has already resolved for the ids the panel would otherwise have to look
 * up itself, so the panel never disagrees with what the dropdowns show as chosen
 */
export interface BulkEditSummaryLabels {
  /** Resolves an account id to its name, already falling back for one the accounts list has lost */
  accountLabelById: (accountId: string) => string

  /** The chosen category's name, meaningless while the edit sets no category */
  categoryLabel: string

  /** The chosen merchant's name, meaningless while the edit sets no merchant */
  merchantLabel: string

  /** The chosen tags' names, in the order they were added */
  tagLabels: string[]
}

/** What the summary panel shows for one edit: the rows it sends, notes, and warnings to settle */
export interface BulkEditSummary {
  rows: BulkEditSummaryRow[]
  notes: string[]
  warnings: string[]
}

const DIRECTION_ROW_VALUES: Record<BulkDirectionChange, string> = {
  debit: 'Money out',
  credit: 'Money in',
  reverse: 'Turned around',
}

/**
 * Renders the date the day headings would show for a "YYYY-MM-DD" string, falling back to the raw
 * string for one the calendar cannot parse, the same way a broken date still appears in the list
 * rather than disappearing behind it
 */
function formatBulkEditDate(ymd: string): string {
  const parsed = parseYmd(ymd)
  return parsed ? formatDate(parsed, DATE_FORMATS.longDate) : ymd
}

/**
 * Renders one transfer end's detail line: what it moves and what it only records, in the singular
 * or plural the count calls for, mirroring the notice the modal showed under the control before it
 * moved into the panel
 *
 * A move clause only makes sense for a tracked account, since a row can never move into "outside
 * this app"; a row whose own end resolves to outside is refused instead, by the sitsOutside blocker,
 * so its detail carries only what it records
 *
 * @param effect What the end would move and record, from countTransferEndEffects
 * @param choice What the control holds
 * @param accountLabel The tracked account's name, meaningless while the control is set to outside
 */
function transferEndDetail(
  effect: TransferEndEffect,
  choice: TransferEndChoice | null,
  accountLabel: string,
): string | undefined {
  const clauses: string[] = []

  if (choice?.scope === 'tracked' && effect.moves > 0) {
    clauses.push(`${effect.moves} ${effect.moves === 1 ? 'moves' : 'move'} into ${accountLabel}`)
  }
  if (effect.recordsOnly > 0) {
    const target = choice?.scope === 'outside' ? 'the other side as outside this app' : `${accountLabel} as the other side`
    clauses.push(`${effect.recordsOnly} ${effect.recordsOnly === 1 ? 'records' : 'record'} ${target}`)
  }

  return clauses.length > 0 ? clauses.join(', ') : undefined
}

/**
 * Returns the account's label or "Outside this app" for a transfer end choice, or undefined for one
 * the edit leaves unset
 */
function transferEndValueLabel(
  choice: TransferEndChoice | null,
  accountLabelById: (accountId: string) => string,
): string | undefined {
  if (choice === null) return undefined
  return choice.scope === 'outside' ? OUTSIDE_ACCOUNT_LABEL : accountLabelById(choice.accountId)
}

/**
 * Returns what the summary panel shows for a bulk edit: one row per detail it sends, in the modal's
 * control order, a note for anything the edit passes over, and a warning per blocker the server
 * would refuse it over.
 *
 * Row presence matches buildBulkEditFields exactly, built by reading its result rather than
 * re-deriving which controls are live, so a stale end held while endsAreOffered is false stays
 * absent here the same way it stays absent from the request. A row's detail says what the edit
 * would do; whether the row is then refused is the warnings' job instead.
 *
 * @param choice What the edit holds
 * @param rows The selected transactions
 * @param blockers What the server would refuse, from getBulkEditBlockers against this same choice
 * @param labels Display text the modal has already resolved for the chosen ids
 * @param chosenCategoryRecordsTransferTarget Whether the category the edit sets records the other
 *     side, or undefined while the edit sets no category and each row keeps its own
 */
export function describeBulkEdit(
  choice: BulkEditChoice,
  rows: SelectedTransactionFacts[],
  blockers: BulkEditBlockers,
  labels: BulkEditSummaryLabels,
  chosenCategoryRecordsTransferTarget: boolean | undefined,
): BulkEditSummary {
  // An empty selection has nothing for a row to describe and nothing for a warning to refuse, so
  // this returns before reading choice at all rather than letting a control still holding a value
  // from before the selection emptied produce a row for a transaction that is no longer there
  if (rows.length === 0) return { rows: [], notes: [], warnings: [] }

  const fields = buildBulkEditFields(choice)
  const effects = countTransferEndEffects(rows, choice, chosenCategoryRecordsTransferTarget)

  const summaryRows: BulkEditSummaryRow[] = []

  if (fields.direction) {
    summaryRows.push({ label: 'Direction', value: DIRECTION_ROW_VALUES[fields.direction] })
  }
  if (fields.account_id !== undefined) {
    summaryRows.push({
      label: 'Move to account',
      value: labels.accountLabelById(fields.account_id),
      detail: `${rows.length} move`,
    })
  }
  if (fields.merchant_id !== undefined) {
    summaryRows.push({ label: 'Merchant', value: labels.merchantLabel })
  }
  if (fields.category_id !== undefined) {
    summaryRows.push({ label: 'Category', value: labels.categoryLabel })
  }
  if (fields.add_tag_ids !== undefined) {
    summaryRows.push({ label: 'Tags added', value: labels.tagLabels.join(', ') })
  }
  if (fields.transfer_from !== undefined) {
    summaryRows.push({
      label: 'From',
      value: transferEndValueLabel(choice.transferFrom, labels.accountLabelById) ?? OUTSIDE_ACCOUNT_LABEL,
      detail: transferEndDetail(
        effects.from,
        choice.transferFrom,
        choice.transferFrom?.scope === 'tracked' ? labels.accountLabelById(choice.transferFrom.accountId) : '',
      ),
    })
  }
  if (fields.transfer_to !== undefined) {
    summaryRows.push({
      label: 'To',
      value: transferEndValueLabel(choice.transferTo, labels.accountLabelById) ?? OUTSIDE_ACCOUNT_LABEL,
      detail: transferEndDetail(
        effects.to,
        choice.transferTo,
        choice.transferTo?.scope === 'tracked' ? labels.accountLabelById(choice.transferTo.accountId) : '',
      ),
    })
  }
  if (fields.dt !== undefined) {
    summaryRows.push({ label: 'Date', value: formatBulkEditDate(fields.dt) })
  }
  if (fields.notes !== undefined) {
    summaryRows.push({ label: 'Note', value: fields.notes === null ? 'Removed' : fields.notes })
  }

  const notes: string[] = []
  if (choice.endsAreOffered) {
    notes.push("A transfer's other half is a separate row. This changes only the rows selected.")
  }
  const sendsAnEnd = choice.endsAreOffered && (choice.transferFrom !== null || choice.transferTo !== null)
  if (sendsAnEnd && effects.leftAlone > 0) {
    notes.push(
      effects.leftAlone === 1
        ? '1 selected transaction is not a transfer and is left as it is.'
        : `${effects.leftAlone} selected transactions are not transfers and are left as they are.`,
    )
  }

  const warnings: string[] = []
  if (blockers.withoutMerchant.length > 0) {
    const count = blockers.withoutMerchant.length
    warnings.push(
      count === 1
        ? '1 selected transaction has no merchant recorded. Set a merchant above, or close this and untick it.'
        : `${count} selected transactions have no merchant recorded. Set a merchant above, or close this and untick them.`,
    )
  }
  if (blockers.unansweredFarSide.length > 0) {
    const count = blockers.unansweredFarSide.length
    warnings.push(
      count === 1
        ? '1 selected transfer does not record where the money went. Set From or To above, or close this and untick it.'
        : `${count} selected transfers do not record where the money went. Set From or To above, or close this and untick them.`,
    )
  }
  if (blockers.ownAccountFarSide.length > 0) {
    const count = blockers.ownAccountFarSide.length
    warnings.push(
      count === 1
        ? '1 selected transaction would end up recording the account it already sits in. Change From, To or Move to account, or close this and untick it.'
        : `${count} selected transactions would end up recording the account they already sit in. Change From, To or Move to account, or close this and untick them.`,
    )
  }
  if (blockers.sitsOutside.length > 0) {
    const count = blockers.sitsOutside.length
    warnings.push(
      count === 1
        ? '1 selected transaction would sit outside this app. Money leaves from or arrives in one of your accounts, so pick one for From or To, or close this and untick it.'
        : `${count} selected transactions would sit outside this app. Money leaves from or arrives in one of your accounts, so pick one for From or To, or close this and untick them.`,
    )
  }
  const currencyMismatches = groupCurrencyMismatches(
    rows,
    blockers.ownSideInAnotherCurrency,
    choice,
    chosenCategoryRecordsTransferTarget,
  )
  for (const mismatch of currencyMismatches) {
    warnings.push(
      mismatch.count === 1
        ? `1 selected transaction is in ${mismatch.rowCurrency} and would move into an account in ${mismatch.targetCurrency}. Pick an account in ${mismatch.rowCurrency}, or close this and untick it.`
        : `${mismatch.count} selected transactions are in ${mismatch.rowCurrency} and would move into an account in ${mismatch.targetCurrency}. Pick an account in ${mismatch.rowCurrency}, or close this and untick them.`,
    )
  }
  if (rows.length > MAX_BULK_EDIT_TRANSACTIONS) {
    warnings.push(`One edit covers at most ${MAX_BULK_EDIT_TRANSACTIONS} transactions. Untick some to continue.`)
  }

  return { rows: summaryRows, notes, warnings }
}
