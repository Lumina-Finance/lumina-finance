import { JOURNAL_NO_CATEGORY_SOURCE } from '@/api/provider-imports'
import {
  IMPORT_TAG_NAME_MAX_LENGTH,
  JOURNAL_ROW_FIELD_MAX_LENGTHS,
  MAX_IMPORT_NOTES_LENGTH,
  MAX_IMPORT_TAGS_PER_ROW,
  getRowNotesTooLongReason,
  getRowTooManyTagsReason,
} from '@/pages/imports/constants'
import type { AccountType } from '@/api/accounts'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME } from '@/utils/transfers'
import {
  ACTUAL_ACCOUNT_TYPES,
  ACTUAL_OFF_BUDGET_CATEGORY_SOURCE_PREFIX,
  ACTUAL_TRANSACTION_DECIMALS,
  ACTUAL_TRANSFER_CATEGORY_NAME,
  ACTUAL_TRANSFER_SIDE_LEFT_OUT_REASON,
  ACTUAL_TRANSFER_CATEGORY_SOURCE_PREFIX,
  getActualPayeeTooLongReason,
  getActualTagTooLongReason,
  getActualUnbalancedSplitReason,
} from '@/pages/imports/actual/constants'
import type {
  ActualAccount,
  ActualAccountSource,
  ActualBudgetFile,
  ActualCategory,
  ActualCategoryRole,
  ActualCategorySource,
  ActualJournal,
  ActualJournalEntry,
  ActualPayee,
  ActualSkippedRow,
  ActualTransaction,
} from '@/pages/imports/actual/types'
import { formatScaledAmount } from './amounts'

// Actual reads a tag as a # followed by anything up to whitespace or the next #, and a doubled ##
// as an escaped # that starts no tag
const ACTUAL_TAG_PATTERN = /(?<!#)#([^#\s]+)/g

// Built-in transfer categories a new spending category can't share a name with, since it would reuse
// one that can't carry spending
const ACTUAL_RESERVED_PAYMENT_NAMES = [ACTUAL_TRANSFER_CATEGORY_NAME, BALANCE_ADJUSTMENT_CATEGORY_NAME].map((name) => name.toLowerCase())

/**
 * Turns a read Actual budget into the rows the import uploads, and the ones it leaves out
 *
 * - A split parent stands in for nothing itself: each part becomes its own row, keeping the
 *   parent's payee when it has none and the parent's notes ahead of its own. A split whose parts
 *   don't add up to it is left out whole, since which part is wrong can't be told
 * - A transfer pairs only when both sides link to each other on the same day for exactly opposite
 *   amounts. The pair is uploaded once, from the side money leaves. A transfer whose other side
 *   can't be found is money leaving or arriving from outside Lumina, filed under a transfer category
 * - A transfer carrying a category, which Actual gives a payment to or from an off-budget account,
 *   names the category on its budget-side leg alone, under the category's transfer source. Each such
 *   category also has a spending source, so the user can file those payments as spending or income
 *   in it instead. They stay transfers unless the user says otherwise
 * - Rows dated after `today` are imported like any other. Lumina Finance counts them from their
 *   date, so each account's balance here is as of `today`
 *
 * @param budget - What the reader took from the file
 * @param today - Today's date in the user's own timezone
 */
export function normaliseActualBudget(budget: ActualBudgetFile, today: string): ActualJournal {
  const accountById = new Map(budget.accounts.map((account) => [account.id, account]))
  const categoryById = new Map(budget.categories.map((category) => [category.id, category]))
  const payeeById = new Map(budget.payees.map((payee) => [payee.id, payee]))
  const transactionById = new Map(budget.transactions.map((transaction) => [transaction.id, transaction]))
  const childrenByParent = groupChildren(budget.transactions)

  const entries: ActualJournalEntry[] = []
  const skippedRows: ActualSkippedRow[] = []
  const categoryUses = new CategoryUses()
  const describe = (transaction: ActualTransaction, reason: string, parent?: ActualTransaction): ActualSkippedRow => ({
    transactionId: transaction.id,
    date: transaction.date,
    accountName: accountById.get(transaction.accountId)?.name ?? '',
    amount: transaction.amount,
    payeeName: payeeById.get(transaction.payeeId ?? parent?.payeeId ?? '')?.name ?? null,
    categoryName: categoryById.get(transaction.categoryId ?? '')?.name ?? null,
    notes: joinNotes(parent?.notes ?? null, transaction.notes),
    reason,
  })

  const getLimitReason = (row: ActualTransaction) => {
    const rowParent = row.parentId ? transactionById.get(row.parentId) : undefined
    const notes = joinNotes(rowParent?.notes ?? null, row.notes)
    const payee = payeeById.get(row.payeeId ?? rowParent?.payeeId ?? '') ?? null
    return getRowLimitReason(notes, readActualTags(notes), payee?.transferAccountId ? null : payee?.name ?? null)
  }

  // Rows whose split was left out
  const leftOut = new Set<string>()
  for (const [parentId, children] of childrenByParent) {
    const parent = transactionById.get(parentId)
    if (!parent) continue
    const partsTotal = children.reduce((total, child) => total + child.amount, 0)
    if (partsTotal === parent.amount) continue
    const format = (amount: number) => formatHundredths(amount, budget.budgetDecimals)
    skippedRows.push(describe(parent, getActualUnbalancedSplitReason(format(partsTotal), format(parent.amount))))
    for (const child of children) leftOut.add(child.id)
  }

  // Actual counts a row's category only while the row's own account is on the budget, which is how
  // rows categorised before their account left the budget read
  const countedCategory = (row: ActualTransaction, rowAccount: ActualAccount) => (
    rowAccount.offBudget ? null : categoryById.get(row.categoryId ?? '') ?? null
  )

  for (const transaction of budget.transactions) {
    // A split's parts are imported in its place, but a parent left with none is an ordinary row
    if ((transaction.isParent && childrenByParent.has(transaction.id)) || leftOut.has(transaction.id)) continue
    const account = accountById.get(transaction.accountId)
    if (!account) continue
    const parent = transaction.parentId ? transactionById.get(transaction.parentId) : undefined

    const payee = payeeById.get(transaction.payeeId ?? parent?.payeeId ?? '') ?? null
    const counterpartAccount = payee?.transferAccountId ? accountById.get(payee.transferAccountId) : undefined
    const linked = counterpartAccount ? findTransferCounterpart(transaction, counterpartAccount, transactionById, payeeById, leftOut) : null

    // A transfer carries one category, so two sides that each count one come in as a row apiece
    const counterpart = linked && counterpartAccount
      && !(countedCategory(transaction, account) && countedCategory(linked, counterpartAccount))
      ? linked
      : null

    // A pair is uploaded from one side with that side's notes, so the pair stands or falls with it
    if (counterpart && !isUploadedSide(transaction, counterpart)) {
      if (getLimitReason(counterpart)) skippedRows.push(describe(transaction, ACTUAL_TRANSFER_SIDE_LEFT_OUT_REASON, parent))
      continue
    }

    const notes = joinNotes(parent?.notes ?? null, transaction.notes)
    const tags = readActualTags(notes)
    const limitReason = getLimitReason(transaction)
    if (limitReason) {
      skippedRows.push(describe(transaction, limitReason, parent))
      continue
    }

    const base = { transactionId: transaction.id, date: transaction.date, amount: Math.abs(transaction.amount), notes, tags }
    if (transaction.isStartingBalance) {
      entries.push({
        ...base,
        type: 'opening balance',
        sourceAccountId: transaction.amount < 0 ? account.id : null,
        destinationAccountId: transaction.amount < 0 ? null : account.id,
        payeeName: null,
        counterpartAccountName: null,
        categorySourceId: null,
        categoryLeg: null,
      })
      continue
    }

    if (counterpartAccount) {
      if (counterpart) {
        entries.push(buildTransferPair(
          base,
          account,
          counterpartAccount,
          countedCategory(transaction, account),
          countedCategory(counterpart, counterpartAccount),
          categoryUses,
        ))
        continue
      }

      // The other side is missing or doesn't match, so only this side's money is certain
      const category = countedCategory(transaction, account)
      entries.push({
        ...base,
        ...getOneSidedAccounts(transaction, account),
        payeeName: null,
        counterpartAccountName: getMerchantSafeName(counterpartAccount.name),
        categorySourceId: categoryUses.add('transfer', category ?? null, null),
        categoryLeg: null,
      })
      continue
    }

    const category = countedCategory(transaction, account)
    const role: ActualCategoryRole = category ? 'spending' : account.offBudget ? 'offBudgetUncategorized' : 'uncategorized'
    entries.push({
      ...base,
      ...getOneSidedAccounts(transaction, account),
      payeeName: payee?.name || null,
      counterpartAccountName: null,
      categorySourceId: categoryUses.add(role, category, account.offBudget ? account : null),
      categoryLeg: null,
    })
  }

  // Payments a category carries to off-budget accounts can be filed as spending in it, so the
  // category needs a spending source even when no ordinary row uses it
  for (const categoryId of categoryUses.getTransferCategoryIds()) {
    const category = categoryById.get(categoryId)
    if (category && !categoryUses.hasSpending(categoryId)) categoryUses.add('spending', category, null, 0)
  }

  // A category budgeted in Actual is offered even without rows, so its budget can still track it.
  // Income budgets aren't imported, so an income category needs rows to be offered
  for (const figure of budget.budgetFigures) {
    const category = categoryById.get(figure.categoryId)
    if (category && !category.isIncome && figure.amount > 0 && !categoryUses.hasSpending(category.id)) {
      categoryUses.add('spending', category, null, 0)
    }
  }

  return {
    accounts: buildAccountSources(budget.accounts, entries, today),
    categories: categoryUses.toSources(budget.categories, accountById),
    entries,
    skippedRows,
  }
}

function groupChildren(transactions: ActualTransaction[]) {
  const children = new Map<string, ActualTransaction[]>()
  for (const transaction of transactions) {
    if (!transaction.parentId) continue
    children.set(transaction.parentId, [...(children.get(transaction.parentId) ?? []), transaction])
  }
  return children
}

/**
 * Finds the other side of a transfer, trusted only when each side links to the other, each names
 * the other's account, the two accounts differ, both sit on one day, the amounts are exactly
 * opposite, neither is a split parent, and the other side is itself imported
 */
function findTransferCounterpart(
  transaction: ActualTransaction,
  counterpartAccount: ActualAccount,
  transactionById: Map<string, ActualTransaction>,
  payeeById: Map<string, ActualPayee>,
  leftOut: ReadonlySet<string>,
) {
  const counterpart = transactionById.get(transaction.transferredId ?? '')
  if (!counterpart || counterpart.transferredId !== transaction.id || leftOut.has(counterpart.id)) return null
  if (counterpart.accountId !== counterpartAccount.id || counterpart.accountId === transaction.accountId) return null
  const counterpartParent = counterpart.parentId ? transactionById.get(counterpart.parentId) : undefined
  const counterpartPayee = payeeById.get(counterpart.payeeId ?? counterpartParent?.payeeId ?? '')
  if (counterpartPayee?.transferAccountId !== transaction.accountId || counterpart.date !== transaction.date) return null
  if (counterpart.amount !== -transaction.amount || counterpart.isParent || transaction.isParent) return null
  return counterpart
}

/**
 * Whether a paired side is the one the pair is uploaded from: the side money leaves, and for a
 * zero transfer, which moves nothing, the side with the lower id
 */
function isUploadedSide(transaction: ActualTransaction, counterpart: ActualTransaction) {
  if (transaction.amount !== 0) return transaction.amount < 0
  return transaction.id < counterpart.id
}

function buildTransferPair(
  base: Pick<ActualJournalEntry, 'transactionId' | 'date' | 'amount' | 'notes' | 'tags'>,
  account: ActualAccount,
  counterpartAccount: ActualAccount,
  sourceCategory: ActualCategory | null,
  destinationCategory: ActualCategory | null,
  categoryUses: CategoryUses,
): ActualJournalEntry {
  // At most one side counts a category, since a pair where both do is imported as two rows. The
  // uploaded side is the one money leaves, so it is the source leg
  const category = sourceCategory ?? destinationCategory
  const categoryLeg = sourceCategory ? 'source' : destinationCategory ? 'destination' : null

  return {
    ...base,
    type: 'transfer',
    sourceAccountId: account.id,
    destinationAccountId: counterpartAccount.id,
    payeeName: null,
    counterpartAccountName: getMerchantSafeName(categoryLeg === 'destination' ? account.name : counterpartAccount.name),
    categorySourceId: category ? categoryUses.add('transfer', category, null) : null,
    categoryLeg,
  }
}

// An account name becomes a merchant when a payment is filed as spending, and one too long for a
// merchant name leaves the row without one
function getMerchantSafeName(name: string) {
  return [...name].length > JOURNAL_ROW_FIELD_MAX_LENGTHS.payee ? null : name || null
}

function getOneSidedAccounts(transaction: ActualTransaction, account: ActualAccount) {
  const isOutflow = transaction.amount < 0
  return {
    type: isOutflow ? 'withdrawal' as const : 'deposit' as const,
    sourceAccountId: isOutflow ? account.id : null,
    destinationAccountId: isOutflow ? null : account.id,
  }
}

/**
 * Returns why a row holds a value the import endpoint cannot take, or null. The server refuses the
 * whole import for any of them, so the row is left out instead
 */
function getRowLimitReason(notes: string | null, tags: string[], payeeName: string | null) {
  const notesLength = [...(notes ?? '')].length
  if (notesLength > MAX_IMPORT_NOTES_LENGTH) return getRowNotesTooLongReason(notesLength)
  if (tags.length > MAX_IMPORT_TAGS_PER_ROW) return getRowTooManyTagsReason(tags.length)
  const longTag = tags.find((tag) => [...tag].length > IMPORT_TAG_NAME_MAX_LENGTH)
  if (longTag) return getActualTagTooLongReason(longTag)
  const payeeLength = [...(payeeName ?? '')].length
  if (payeeLength > JOURNAL_ROW_FIELD_MAX_LENGTHS.payee) return getActualPayeeTooLongReason(payeeLength)
  return null
}

function joinNotes(parentNotes: string | null, notes: string | null) {
  return [parentNotes, notes].map((part) => part?.trim() ?? '').filter(Boolean).join('\n') || null
}

/**
 * Reads the tags Actual shows for a row's notes, each once whatever its capitals, since Lumina
 * matches tag names that way
 */
export function readActualTags(notes: string | null): string[] {
  const tags = new Map<string, string>()
  for (const match of (notes ?? '').matchAll(ACTUAL_TAG_PATTERN)) {
    const tag = match[1]
    if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag)
  }
  return [...tags.values()]
}

/**
 * Writes signed hundredths as decimal text for the user to read, in the decimal places of the
 * budget's currency, such as none for yen. An amount that has cents all the same keeps them
 */
export function formatHundredths(amount: number, decimals = ACTUAL_TRANSACTION_DECIMALS) {
  const sign = amount < 0 ? '-' : ''
  const text = formatScaledAmount(amount, ACTUAL_TRANSACTION_DECIMALS, decimals)
    ?? formatScaledAmount(amount, ACTUAL_TRANSACTION_DECIMALS, ACTUAL_TRANSACTION_DECIMALS)
  return `${sign}${text}`
}

function buildAccountSources(accounts: ActualAccount[], entries: ActualJournalEntry[], today: string): ActualAccountSource[] {
  const balances = new Map<string, number>()
  const rowCounts = new Map<string, number>()
  const withFutureRows = new Set<string>()

  // A row after today counts toward no balance until its date, as Lumina Finance counts it, and
  // an account receiving a future transfer holds a future row as much as the one sending it
  const add = (accountId: string | null, amount: number, date: string) => {
    if (!accountId) return
    rowCounts.set(accountId, (rowCounts.get(accountId) ?? 0) + 1)
    if (date > today) {
      withFutureRows.add(accountId)
      return
    }
    balances.set(accountId, (balances.get(accountId) ?? 0) + amount)
  }
  for (const entry of entries) {
    add(entry.sourceAccountId, -entry.amount, entry.date)
    add(entry.destinationAccountId, entry.amount, entry.date)
  }

  // A shared name is told apart by where the account sits, and numbered when that is shared too
  const nameCounts = countBy(accounts.map((account) => account.name.toLowerCase()))
  const describeAccount = (account: ActualAccount) => (
    `${account.offBudget ? 'off budget' : 'on budget'}${account.closed ? ', closed' : ''}`
  )
  const detailCounts = countBy(accounts.map((account) => `${account.name.toLowerCase()}\n${describeAccount(account)}`))
  const detailSeen = new Map<string, number>()
  const labelAccount = (account: ActualAccount) => {
    if ((nameCounts.get(account.name.toLowerCase()) ?? 0) < 2) return account.name
    const key = `${account.name.toLowerCase()}\n${describeAccount(account)}`
    if ((detailCounts.get(key) ?? 0) < 2) return `${account.name} (${describeAccount(account)})`
    const position = (detailSeen.get(key) ?? 0) + 1
    detailSeen.set(key, position)
    return `${account.name} (${describeAccount(account)}, ${position})`
  }

  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    label: labelAccount(account),
    offBudget: account.offBudget,
    closed: account.closed,
    balance: balances.get(account.id) ?? 0,
    rowCount: rowCounts.get(account.id) ?? 0,
    hasFutureRows: withFutureRows.has(account.id),
    proposedType: proposeAccountType(account, balances.get(account.id) ?? 0),
  }))
}

/**
 * Proposes what a new Lumina account is, from Actual's own type when it kept one. Otherwise an
 * off-budget account owing money reads as a loan and one holding money as an investment, and a
 * budget account owing money as a credit card
 */
function proposeAccountType(account: ActualAccount, balance: number): AccountType {
  const stated = ACTUAL_ACCOUNT_TYPES[account.type?.toLowerCase() ?? '']
  if (stated) return stated
  if (account.offBudget) return balance < 0 ? 'loan' : 'investment'
  return balance < 0 ? 'credit_card' : 'checking'
}

function countBy(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

/** Collects the category sources rows use, counting rows so the steps can say how many each files */
class CategoryUses {
  private readonly uses = new Map<string, { role: ActualCategoryRole; categoryId: string | null; accountId: string | null; count: number }>()

  add(role: ActualCategoryRole, category: ActualCategory | null, account: ActualAccount | null, count = 1) {
    const id = getCategorySourceId(role, category?.id ?? null, account?.id ?? null)
    const use = this.uses.get(id) ?? { role, categoryId: category?.id ?? null, accountId: account?.id ?? null, count: 0 }
    use.count += count
    this.uses.set(id, use)
    return id
  }

  hasSpending(categoryId: string) {
    return this.uses.has(getCategorySourceId('spending', categoryId, null))
  }

  getTransferCategoryIds() {
    return [...this.uses.values()].flatMap((use) => (use.role === 'transfer' && use.categoryId ? [use.categoryId] : []))
  }

  toSources(categories: ActualCategory[], accountById: Map<string, ActualAccount>): ActualCategorySource[] {
    const categoryById = new Map(categories.map((category) => [category.id, category]))

    const sources = [...this.uses].map(([id, use]): ActualCategorySource => {
      const category = use.categoryId ? categoryById.get(use.categoryId) : undefined
      const accountName = use.accountId ? accountById.get(use.accountId)?.name ?? '' : ''
      const name = category ? getActualCategoryName(category, categories) : ''
      const labels = getSourceLabels(use.role, name, accountName)
      return {
        id,
        role: use.role,
        ...labels,
        categoryId: use.categoryId,
        accountId: use.accountId,
        isIncome: category?.isIncome ?? false,
        rowCount: use.count,
      }
    })

    const roleOrder: ActualCategoryRole[] = ['spending', 'transfer', 'uncategorized', 'offBudgetUncategorized']
    return sources.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.label.localeCompare(b.label))
  }
}

/** Names a category, with its group when another category shares its name, capitals folded */
export function getActualCategoryName(category: ActualCategory, categories: ActualCategory[]) {
  const key = category.name.toLowerCase()
  const isShared = categories.filter((candidate) => candidate.name.toLowerCase() === key).length > 1
  return isShared && category.groupName ? `${category.name} (${category.groupName})` : category.name
}

/** Names the transfer source of an Actual category, or of transfers with no category when given none */
export function getActualTransferSourceId(categoryId: string | null) {
  return `${ACTUAL_TRANSFER_CATEGORY_SOURCE_PREFIX}${categoryId ?? ''}`
}

function getCategorySourceId(role: ActualCategoryRole, categoryId: string | null, accountId: string | null) {
  if (role === 'spending') return categoryId ?? JOURNAL_NO_CATEGORY_SOURCE
  if (role === 'transfer') return getActualTransferSourceId(categoryId)
  if (role === 'offBudgetUncategorized') return `${ACTUAL_OFF_BUDGET_CATEGORY_SOURCE_PREFIX}${accountId ?? ''}`
  return JOURNAL_NO_CATEGORY_SOURCE
}

/**
 * Names a source for the categories step and for the category it creates. A category's transfer
 * source needs a name apart from its spending source, since one Lumina category can't be both, and a
 * spending source named after a built-in category that can't carry spending needs one of its own
 */
function getSourceLabels(role: ActualCategoryRole, name: string, accountName: string) {
  if (role === 'transfer') {
    if (!name) return { label: 'Transfers whose other side is missing', createName: 'Transfer' }
    return { label: `${name} (transfers in Actual)`, createName: `${name} Transfers` }
  }
  if (role === 'offBudgetUncategorized') return { label: `No category · ${accountName}`, createName: accountName }
  if (role === 'uncategorized') return { label: 'No category', createName: 'Miscellaneous' }
  const isReserved = ACTUAL_RESERVED_PAYMENT_NAMES.includes(name.toLowerCase())
  return { label: name, createName: isReserved ? `${name} Payments` : name }
}
