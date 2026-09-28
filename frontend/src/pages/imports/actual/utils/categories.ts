import { ACCOUNT_KIND_BY_TYPE, type AccountsOverview, type AccountType } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { getCategoryNameKey } from '@/pages/imports/utils/categoryMatching'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, CREDIT_CARD_PAYMENT_CATEGORY_NAME, doesTransferRecordCounterpartyAccount } from '@/utils/transfers'
import {
  ACTUAL_CREDIT_PAYMENT_CATEGORY_SOURCE,
  ACTUAL_CREDIT_PAYMENT_LABEL,
  ACTUAL_DEFAULT_PAYMENT_MODE,
  ACTUAL_MISCELLANEOUS_CATEGORY_NAME,
  ACTUAL_TRANSFER_CATEGORY_NAME,
} from '@/pages/imports/actual/constants'
import type { ActualCategorySource, ActualJournal, ActualPaymentMode } from '@/pages/imports/actual/types'
import type { ActualAccountCreateDetails } from './payload'
import { isGroupResource } from '@/pages/imports/utils/resourceScope'

/**
 * Says what kind of category a source is created as: transfer sources can only be transfers, since
 * their rows stay transfers between accounts, and a spending source follows Actual's income group
 */
export function getActualCategoryKind(source: ActualCategorySource): ImportCategoryKind {
  if (source.role === 'transfer') return 'transfer'
  return source.isIncome ? 'income' : 'expense'
}

/** Whether a category can carry a leg that stays a transfer, which has to record the other account */
export function canCarryActualTransfer(category: Pick<Category, 'kind' | 'name'>) {
  return doesTransferRecordCounterpartyAccount(category.kind, category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME)
}

/**
 * Fills in the category answers the user has not given
 *
 * Rows without a category go to Miscellaneous, as they do for Firefly III, and transfers whose other
 * side is gone go to Transfer. Credit card payments take Credit Card Payment by its name. Every other source takes an existing personal or built-in category of
 * the same name and kind, capitals folded, and is created otherwise
 */
export function inferActualCategoryMappings(
  sources: ActualCategorySource[],
  explicitMappings: Record<string, string>,
  categories: Category[],
): Record<string, string> {
  const systemCategory = (name: string) => categories.find((category) => category.is_system && category.name === name)
  const miscellaneous = systemCategory(ACTUAL_MISCELLANEOUS_CATEGORY_NAME)
  const transfer = systemCategory(ACTUAL_TRANSFER_CATEGORY_NAME)
  const spendingLabelByCategory = new Map(sources.flatMap((source) => (
    source.role === 'spending' && source.categoryId ? [[source.categoryId, source.label] as const] : []
  )))

  const mappings: Record<string, string> = {}
  for (const source of sources) {
    if (explicitMappings[source.id]) {
      mappings[source.id] = explicitMappings[source.id]
      continue
    }

    if (source.role === 'uncategorized' || source.role === 'offBudgetUncategorized') {
      mappings[source.id] = miscellaneous?.id ?? CREATE_CATEGORY_VALUE
      continue
    }
    if (source.role === 'transfer' && !source.categoryId && source.id !== ACTUAL_CREDIT_PAYMENT_CATEGORY_SOURCE) {
      mappings[source.id] = transfer?.id ?? CREATE_CATEGORY_VALUE
      continue
    }

    // A category's payments kept as transfers take a transfer category of Actual's own name first,
    // such as the built-in Credit Card Payment, before the one they would be created under
    const kind = getActualCategoryKind(source)
    const names = source.role === 'transfer' && source.categoryId
      ? [spendingLabelByCategory.get(source.categoryId), source.createName]
      : [source.createName]
    const match = names.flatMap((name) => (name ? [getCategoryNameKey(name)] : [])).map((key) => categories.find((category) => (
      !isGroupResource(category)
      && getCategoryNameKey(category.name) === key
      && category.kind === kind
      && (source.role !== 'transfer' || canCarryActualTransfer(category))
    ))).find(Boolean)
    mappings[source.id] = match?.id ?? CREATE_CATEGORY_VALUE
  }
  return mappings
}

/**
 * Narrows the category choices for a transfer source to creating one and the categories that can
 * take its rows, which stay transfers between accounts
 */
export function getActualTransferCategoryOptions(options: DropdownOption[], categoryById: Map<string, Category>) {
  return options.filter((option) => {
    if (option.value === CREATE_CATEGORY_VALUE) return true
    const category = categoryById.get(option.value)
    return category ? canCarryActualTransfer(category) : false
  })
}

export function getActualPaymentMode(modes: Record<string, ActualPaymentMode>, transferSourceId: string) {
  return modes[transferSourceId] ?? ACTUAL_DEFAULT_PAYMENT_MODE
}

/**
 * Returns the journal as the import sends it once each category's payments to off-budget accounts
 * are filed the way the user chose
 *
 * A payment filed as spending moves from the category's transfer source to its spending source,
 * which is named by Actual's category id, keeping its budget-side leg and taking the other
 * account's name as its payee. A spending source with no rows of its own is shown only through
 * the transfer row then, so it takes that row's label, which is how an answer the import refuses
 * for it names a row the user can see
 *
 * @param modes - Payment modes keyed by transfer source id, a missing one taking the default
 */
export function applyActualPaymentModes(journal: ActualJournal, modes: Record<string, ActualPaymentMode>): ActualJournal {
  const spendingTransferSources = new Map<string, ActualCategorySource>()
  for (const source of journal.categories) {
    if (source.role === 'transfer' && source.categoryId && getActualPaymentMode(modes, source.id) === 'category') {
      spendingTransferSources.set(source.id, source)
    }
  }
  if (spendingTransferSources.size === 0) return journal

  const transferLabelsByCategory = new Map([...spendingTransferSources.values()].map((source) => [source.categoryId, source.label]))
  return {
    ...journal,
    categories: journal.categories.map((source) => {
      const transferLabel = transferLabelsByCategory.get(source.categoryId)
      return source.role === 'spending' && source.rowCount === 0 && transferLabel ? { ...source, label: transferLabel } : source
    }),
    entries: journal.entries.map((entry) => {
      const source = spendingTransferSources.get(entry.categorySourceId ?? '')
      if (!source?.categoryId) return entry
      return { ...entry, categorySourceId: source.categoryId, payeeName: entry.counterpartAccountName }
    }),
  }
}

/**
 * Leaves out the category sources the categories step doesn't show: a spending source with no rows
 * of its own for a category whose payments to off-budget accounts have a transfer row, which stands
 * for the whole category while those payments are spending. It shows once they are transfers and a
 * selected budget tracks it, so its answer can still be given
 *
 * @param budgetSourceIds - Category sources the selected budgets track
 */
export function getVisibleActualCategorySources(
  sources: ActualCategorySource[],
  modes: Record<string, ActualPaymentMode>,
  budgetSourceIds: ReadonlySet<string>,
) {
  const transferSourceIds = new Map(sources.flatMap((source) => (
    source.role === 'transfer' && source.categoryId ? [[source.categoryId, source.id] as const] : []
  )))
  return sources.filter((source) => {
    const transferSourceId = source.role === 'spending' && source.rowCount === 0 ? transferSourceIds.get(source.categoryId ?? '') : undefined
    if (!transferSourceId) return true
    return getActualPaymentMode(modes, transferSourceId) === 'transfer' && budgetSourceIds.has(source.id)
  })
}

/**
 * Returns the journal with each transfer that pays a credit card, line of credit or HELOC filed
 * under one source of its own, which Credit Card Payment takes on both legs, as a payment entered in
 * the app is
 *
 * Only a transfer Actual gave no category counts, from an account that isn't revolving credit into
 * one that is, going by the types the account step settles. A transfer between two credit accounts
 * moves a balance rather than paying one, so it stays a transfer
 *
 * @param revolvingAccountIds - Actual accounts that are revolving credit in Lumina Finance
 */
export function applyActualCreditPayments(journal: ActualJournal, revolvingAccountIds: ReadonlySet<string>): ActualJournal {
  let rowCount = 0
  const entries = journal.entries.map((entry) => {
    if (entry.type !== 'transfer' || entry.categorySourceId || !entry.sourceAccountId || !entry.destinationAccountId) return entry
    if (!revolvingAccountIds.has(entry.destinationAccountId) || revolvingAccountIds.has(entry.sourceAccountId)) return entry
    rowCount += 1
    return { ...entry, categorySourceId: ACTUAL_CREDIT_PAYMENT_CATEGORY_SOURCE, categoryLeg: 'both' as const }
  })
  if (rowCount === 0) return journal

  const source: ActualCategorySource = {
    id: ACTUAL_CREDIT_PAYMENT_CATEGORY_SOURCE,
    role: 'transfer',
    label: ACTUAL_CREDIT_PAYMENT_LABEL,
    createName: CREDIT_CARD_PAYMENT_CATEGORY_NAME,
    categoryId: null,
    accountId: null,
    isIncome: false,
    rowCount,
  }

  // Listed after the categorised transfers, where the other transfer rows are
  const insertAt = journal.categories.findIndex((candidate) => candidate.role === 'uncategorized' || candidate.role === 'offBudgetUncategorized')
  const categories = [...journal.categories]
  categories.splice(insertAt === -1 ? categories.length : insertAt, 0, source)
  return { ...journal, categories, entries }
}

/**
 * Returns the Actual accounts that are revolving credit in Lumina Finance, going by the existing
 * account each is linked to or the type it is created as. An account without an answer yet isn't one
 *
 * @param accountMappings - Each Actual account's answer: an existing account id, create, or empty
 * @param accountCreateDetails - Each Actual account's details for when it is created
 */
export function getActualRevolvingAccountIds(
  accountIds: string[],
  accountMappings: Record<string, string>,
  accountCreateDetails: Record<string, Pick<ActualAccountCreateDetails, 'accountType'>>,
  accountById: ReadonlyMap<string, Pick<AccountsOverview, 'account_kind'>>,
): Set<string> {
  return new Set(accountIds.filter((id) => {
    const choice = accountMappings[id]
    const createdType = accountCreateDetails[id]?.accountType
    const kind = choice === CREATE_ACCOUNT_VALUE
      ? createdType ? ACCOUNT_KIND_BY_TYPE[createdType as AccountType] : undefined
      : accountById.get(choice ?? '')?.account_kind
    return kind === 'revolving'
  }))
}
