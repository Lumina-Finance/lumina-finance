import type { AccountsOverview } from '@/api/accounts'
import {
  REVIEW_PAUSE_COUNT,
  REVIEW_RESUME_COUNT,
  type BankReviewBacklog,
  type BankReviewItem,
  type BankReviewItemKind,
  type CorrectableBankField,
} from '@/api/bank-sync'
import { isOwnPersonalAccount } from '@/utils/bankSync'
import { DATE_FORMATS, formatDate, parseYmd } from '@/utils/date'
import { formatExactMovedAmount } from '@/utils/formatCurrency'

export const REVIEW_KIND_LABELS: Record<BankReviewItemKind, string> = {
  new: 'New',
  correction: 'Correction',
  removal: 'Removal',
}

// What "The bank changed the …" calls each field, in the order the line names them
const CHANGED_FIELD_NAMES: [CorrectableBankField, string][] = [
  ['amount', 'amount'],
  ['date', 'date'],
  ['description', 'bank description'],
]

// The text an amount exactly as the bank sent it can take, as the server checks it
const RAW_AMOUNT_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/

/** One account's bank items, or the backlog notice's account, named as the accounts list names it */
type ReviewAccount = Pick<AccountsOverview, 'id' | 'name'>

/**
 * How a review row shows its amount: signed text, its direction for the colour, and whether it is
 * struck through as an amount a removal would take out of the ledger
 */
export type ReviewItemAmount = {
  text: string
  sign: -1 | 0 | 1
  isStruckThrough: boolean
}

/**
 * The notice above the items when an account in scope is paused or close to pausing for its backlog
 */
export type BacklogNotice = {
  tone: 'paused' | 'warning'
  text: string
}

/**
 * Joins names into a list read as one phrase, as in "amount, date and bank description"
 */
function joinWithAnd(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Says what a review item asks of the user, on the line under its description
 *
 * A new item always needs a merchant and a category, and an amount too when the bank sent more
 * decimal places than the account's currency holds, since that amount can't be stored as sent
 */
export function describeReviewItem(item: BankReviewItem): string {
  if (item.kind === 'removal') return 'The bank no longer reports this transaction'
  if (item.kind === 'new') {
    return item.bank.amount === null ? 'Needs amount, merchant and category' : 'Needs merchant and category'
  }
  const changed = CHANGED_FIELD_NAMES.filter(([field]) => item.changed_fields.includes(field)).map(([, name]) => name)
  return changed.length > 0 ? `The bank changed the ${joinWithAnd(changed)}` : 'The bank changed this transaction'
}

/**
 * Formats an amount exactly as the bank sent it, with every decimal place it carried, signed as any
 * amount that moved is. Text the server would never send is shown as it came
 */
export function formatRawAmount(rawAmount: string, currency: string): Omit<ReviewItemAmount, 'isStruckThrough'> {
  const match = RAW_AMOUNT_PATTERN.exec(rawAmount)
  if (!match) return { text: rawAmount, sign: 0 }
  const [, sign, whole, fraction = ''] = match
  const amount = BigInt(`${whole}${fraction}`) * (sign === '-' ? -1n : 1n)
  return {
    text: formatExactMovedAmount(amount, currency, fraction.length),
    sign: amount < 0n ? -1 : amount > 0n ? 1 : 0,
  }
}

/**
 * Returns the amount a review row shows, in the account's currency
 *
 * A removal shows the ledger amount it would take out, struck through, since the bank's last value
 * can differ from the one the user approved. Every other item shows the bank's amount, or the amount
 * exactly as the bank sent it when its currency can't hold it
 *
 * @param formatMovedCurrency - The app's formatter for an amount that moved, bound to the currency list
 */
export function getReviewItemAmount(
  item: BankReviewItem,
  currency: string,
  formatMovedCurrency: (minorUnits: number, currency: string) => string,
): ReviewItemAmount {
  const isStruckThrough = item.kind === 'removal'
  const amount = isStruckThrough && item.current ? item.current.amount : item.bank.amount
  if (amount === null) {
    return { ...formatRawAmount(item.bank.raw_amount ?? '', currency), isStruckThrough }
  }
  return { text: formatMovedCurrency(amount, currency), sign: amount < 0 ? -1 : amount > 0 ? 1 : 0, isStruckThrough }
}

/**
 * Formats the bank's date of an item, adding the year only for a date outside today's year
 *
 * @param today - Today as "YYYY-MM-DD" in the user's profile timezone
 */
export function formatReviewDate(ymd: string, today: string): string {
  const date = parseYmd(ymd)
  if (!date) return ymd
  return formatDate(date, ymd.slice(0, 4) === today.slice(0, 4) ? DATE_FORMATS.monthDay : DATE_FORMATS.monthDayYear)
}

/**
 * Words the backlog notice for the accounts in scope, naming them in the order they are given
 *
 * A paused account takes precedence, since its sync has stopped, and a warning shows only when none
 * is paused. Several accounts are listed together, separated by commas
 *
 * @param accounts - The accounts in scope, in the order to name them
 */
export function describeBacklogNotice(backlogs: BankReviewBacklog[], accounts: ReviewAccount[]): BacklogNotice | null {
  const backlogByAccount = new Map(backlogs.map((backlog) => [backlog.account_id, backlog]))
  const named = accounts.flatMap((account) => {
    const backlog = backlogByAccount.get(account.id)
    return backlog ? [{ name: account.name, backlog }] : []
  })
  const list = (entries: typeof named) =>
    entries
      .map(({ name, backlog }) => `${backlog.waiting_new_count.toLocaleString()} new to review in ${name}`)
      .join(', ')

  const paused = named.filter(({ backlog }) => backlog.paused)
  if (paused.length > 0) {
    return { tone: 'paused', text: `Paused · ${list(paused)}. Sync resumes at ${REVIEW_RESUME_COUNT} or fewer.` }
  }
  const warned = named.filter(({ backlog }) => backlog.review_warning)
  if (warned.length > 0) {
    return { tone: 'warning', text: `${list(warned)}. Sync pauses at ${REVIEW_PAUSE_COUNT}.` }
  }
  return null
}

/**
 * Returns the accounts whose bank items the review block and the pending strip show for a transaction list
 *
 * Only a linked account has bank items, so a user with no linked account reads none at all. A list of
 * every account otherwise reads every account's items. The server keeps those to the user's own
 * personal accounts. A list scoped to some accounts reads only those of them that are the user's own
 * personal accounts and linked, since the server refuses the first kind of the rest, and none at all
 * when it holds none of them
 *
 * @param listAccountIds - The accounts the list is filtered or fixed to, empty or absent for every account
 * @param linkedAccountIds - The accounts that have a bank link
 * @returns The accounts to read, or undefined for every account
 */
export function getReviewAccountIds(
  accounts: Pick<AccountsOverview, 'id' | 'owner_id' | 'group_id'>[],
  userId: string,
  listAccountIds: string[] | undefined,
  linkedAccountIds: ReadonlySet<string>,
): string[] | undefined {
  if (linkedAccountIds.size === 0) return []
  if (!listAccountIds || listAccountIds.length === 0) return undefined
  const ownPersonal = new Set(
    accounts.filter((account) => isOwnPersonalAccount(account, userId)).map((account) => account.id),
  )
  return listAccountIds.filter((accountId) => ownPersonal.has(accountId) && linkedAccountIds.has(accountId))
}

/**
 * Picks the new item to review after the given one: the next new item in the block's order, or once
 * none follows, the first new item before it. Null when no other new item is loaded
 *
 * @param items - The loaded items in the block's order
 */
export function findNextNewItem(items: BankReviewItem[], itemId: string): BankReviewItem | null {
  const index = items.findIndex((item) => item.id === itemId)
  const following = items.slice(index + 1)
  const preceding = index === -1 ? [] : items.slice(0, index)
  return [...following, ...preceding].find((item) => item.kind === 'new') ?? null
}
