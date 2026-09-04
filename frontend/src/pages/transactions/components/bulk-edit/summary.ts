/**
 * Turns a bulk edit's choice into what the modal's summary panel shows: a row per detail the edit
 * sends, a note for anything it passes over, and a warning for anything the server would refuse.
 *
 * A pure function of its inputs, so the panel can be tested without rendering the modal that feeds
 * it. blockers is the one exception: it is computed by the caller rather than here, so the panel
 * and the Apply button can never disagree about what the server would refuse.
 */
import type { BulkDirectionChange } from '@/api/transactions'
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

/**
 * One note or warning line, keyed by what it is about rather than by its current text, so a count
 * changing rewrites the text in place instead of the animated list treating it as a new line
 */
export interface BulkEditSummaryMessage {
  key: string
  text: string
}

/** What the summary panel shows for one edit: the rows it sends, notes, and warnings to settle */
export interface BulkEditSummary {
  rows: BulkEditSummaryRow[]
  notes: BulkEditSummaryMessage[]
  warnings: BulkEditSummaryMessage[]
}

const DIRECTION_ROW_VALUES: Record<BulkDirectionChange, string> = {
  debit: 'Debit',
  credit: 'Credit',
  reverse: 'Reversed',
}

/**
 * Returns the opening clause of a warning sentence: naming the whole selection once the count fills
 * it, naming both numbers otherwise, and dropping the count entirely once only one row is selected,
 * since "1 of the 1" says nothing "the selected" would not already
 *
 * @param count The rows the sentence is about
 * @param total Every selected row
 */
export function shareOpening(count: number, total: number): string {
  if (total === 1) return 'The selected'
  if (count === total) return `All ${total} selected`
  return `${count} of the ${total} selected`
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
 * Renders one transfer end's detail line: what it moves and what it only records, mirroring the
 * notice the modal showed under the control before it moved into the panel
 *
 * Each clause is hidden once its count reaches every selected row, since a change true of the whole
 * selection needs no line singling any of it out. A move clause only makes sense for a tracked
 * account, since a row can never move into "outside this app"; a row whose own end resolves to
 * outside is refused instead, by the sitsOutside blocker, so its detail carries only what it
 * records. A row whose own end already sits in the account named carries no clause at all, since
 * countTransferEndEffects counts it as neither a move nor a record. The record clause reads which
 * way the money crosses the far side this control just set: To reads as where it now goes, From as
 * where it now comes from
 *
 * @param end Which control this detail belongs to, since From and To phrase the record clause
 *     differently
 * @param effect What the end would move and record, from countTransferEndEffects
 * @param choice What the control holds
 * @param accountLabel The tracked account's name, meaningless while the control is set to outside
 * @param total Every selected row, which is what a clause matching in full is hidden against
 */
function transferEndDetail(
  end: 'from' | 'to',
  effect: TransferEndEffect,
  choice: TransferEndChoice | null,
  accountLabel: string,
  total: number,
): string | undefined {
  const clauses: string[] = []

  if (choice?.scope === 'tracked' && effect.moves > 0 && effect.moves < total) {
    clauses.push(`${effect.moves} of the ${total} ${effect.moves === 1 ? 'moves' : 'move'} into ${accountLabel}`)
  }
  if (effect.recordsOnly > 0 && effect.recordsOnly < total) {
    const verb = end === 'to'
      ? (effect.recordsOnly === 1 ? 'goes' : 'go')
      : (effect.recordsOnly === 1 ? 'comes' : 'come')
    const target = end === 'to'
      ? (choice?.scope === 'outside' ? 'outside this app' : `to ${accountLabel}`)
      : (choice?.scope === 'outside' ? 'from outside this app' : `from ${accountLabel}`)
    clauses.push(`${effect.recordsOnly} of the ${total} now ${verb} ${target}`)
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
 * absent here the same way it stays absent from the request. The Direction row reads whichever of
 * direction and the transfer-only direction the request carries, since either one means the pills
 * show a value. A row's detail says what the edit would do; whether the row is then refused is the
 * warnings' job instead.
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
  const transferRowCount = rows.length - effects.leftAlone

  const summaryRows: BulkEditSummaryRow[] = []

  const directionValue = fields.direction ?? fields.transfer_direction
  if (directionValue) {
    const directionIsImplied = fields.transfer_direction !== undefined
    summaryRows.push({
      label: 'Direction',
      value: DIRECTION_ROW_VALUES[directionValue],
      detail: directionIsImplied && transferRowCount < rows.length
        ? `applies to ${transferRowCount} of the ${rows.length} selected transactions`
        : undefined,
    })
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
        'from',
        effects.from,
        choice.transferFrom,
        choice.transferFrom?.scope === 'tracked' ? labels.accountLabelById(choice.transferFrom.accountId) : '',
        rows.length,
      ),
    })
  }
  if (fields.transfer_to !== undefined) {
    summaryRows.push({
      label: 'To',
      value: transferEndValueLabel(choice.transferTo, labels.accountLabelById) ?? OUTSIDE_ACCOUNT_LABEL,
      detail: transferEndDetail(
        'to',
        effects.to,
        choice.transferTo,
        choice.transferTo?.scope === 'tracked' ? labels.accountLabelById(choice.transferTo.accountId) : '',
        rows.length,
      ),
    })
  }
  if (fields.dt !== undefined) {
    summaryRows.push({ label: 'Date', value: formatBulkEditDate(fields.dt) })
  }
  if (fields.notes !== undefined) {
    summaryRows.push({ label: 'Note', value: fields.notes === null ? 'Removed' : fields.notes })
  }

  const notes: BulkEditSummaryMessage[] = []
  const sendsAnEnd = choice.endsAreOffered && (choice.transferFrom !== null || choice.transferTo !== null)
  if ((sendsAnEnd || directionValue !== undefined) && transferRowCount > 0) {
    notes.push({
      key: 'other-half',
      text: 'Adjustments to a transfer affect the selected transaction only and do not update its counterpart.',
    })
  }
  if (sendsAnEnd && effects.leftAlone > 0) {
    notes.push({
      key: 'left-alone',
      text: `Changes to From and To apply only to ${transferRowCount} of the ${rows.length} selected transactions.`,
    })
  }

  const warnings: BulkEditSummaryMessage[] = []
  if (blockers.withoutMerchant.length > 0) {
    const count = blockers.withoutMerchant.length
    const noun = rows.length === 1 ? 'transaction' : 'transactions'
    const verb = count === 1 ? 'is' : 'are'
    warnings.push({
      key: 'without-merchant',
      text: `${shareOpening(count, rows.length)} ${noun} ${verb} missing merchant information.`,
    })
  }
  if (blockers.unansweredFarSide.length > 0) {
    const count = blockers.unansweredFarSide.length
    const noun = rows.length === 1 ? 'transfer' : 'transfers'
    const verb = count === 1 ? 'is' : 'are'
    warnings.push({
      key: 'unanswered',
      text: `${shareOpening(count, rows.length)} ${noun} ${verb} missing the To or From account.`,
    })
  }
  if (blockers.ownAccountFarSide.length > 0) {
    const count = blockers.ownAccountFarSide.length
    const noun = rows.length === 1 ? 'transfer' : 'transfers'
    warnings.push({
      key: 'own-account',
      text: `${shareOpening(count, rows.length)} ${noun} can't have the same account on both sides.`,
    })
  }
  const currencyMismatches = groupCurrencyMismatches(
    rows,
    blockers.ownSideInAnotherCurrency,
    choice,
    chosenCategoryRecordsTransferTarget,
  )
  for (const mismatch of currencyMismatches) {
    const noun = rows.length === 1 ? 'transaction' : 'transactions'
    warnings.push({
      key: `currency-${mismatch.rowCurrency}-${mismatch.targetCurrency}`,
      text: `${shareOpening(mismatch.count, rows.length)} ${noun} in ${mismatch.rowCurrency} `
        + `can't move to a ${mismatch.targetCurrency} account.`,
    })
  }

  return { rows: summaryRows, notes, warnings }
}
