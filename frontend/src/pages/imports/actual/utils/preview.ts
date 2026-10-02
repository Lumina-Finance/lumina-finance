import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, DEFAULT_CATEGORY_ICON } from '@/pages/imports/constants'
import type { ImportCategoryKind, PreviewTransactionRow } from '@/pages/imports/types'
import { getPreviewDateLabel } from '@/pages/imports/utils'
import { findCurrencyExponent } from '@/utils/moneyInput'
import type { ActualAccountSource, ActualJournal, ActualJournalEntry } from '@/pages/imports/actual/types'
import type { ActualAccountCreateDetails } from './payload'
import { canCarryActualTransfer } from './categories'

export interface ActualPreviewOptions {
  accountMappings: Record<string, string>
  accountCreateDetails: Record<string, ActualAccountCreateDetails>
  accountById: Map<string, AccountsOverview>
  institutionById: Map<string, Institution>
  categoryMappings: Record<string, string>
  categoryCreateKinds: Record<string, ImportCategoryKind>

  /** New categories created under another name, because an existing category holds their own */
  categoryRenames: Record<string, string>
  categoryById: Map<string, Category>
  transferCategory: Category | undefined
  balanceAdjustmentCategory: Category | undefined
  currencies: Currency[]

  /** Rows the upload leaves out, which the preview leaves out too */
  skippedTransactionIds: ReadonlySet<string>
}

interface ActualPreviewAccount {
  id: string
  name: string
  currency: string
  exponent: number
  institution: Institution | null
}

interface ActualPreviewLeg {
  account: ActualPreviewAccount
  minorUnits: number
  category: Category | undefined
  merchantName: string | null
  counterpartyAccount: ActualPreviewAccount | null
}

/**
 * Compiles the first uploaded rows into the ledger entries the commit writes, applying the account
 * and category answers the way the commit does
 *
 * A row waiting on an account answer is left out until it has one, since its currency and so its
 * amount aren't known yet
 */
export function buildActualPreviewRows(journal: ActualJournal, options: ActualPreviewOptions, limit: number): PreviewTransactionRow[] {
  const sources = new Map(journal.accounts.map((account) => [account.id, account]))
  const categorySources = new Map(journal.categories.map((source) => [source.id, source]))
  const timestamp = new Date().toISOString()
  const previewRows: PreviewTransactionRow[] = []

  for (const entry of journal.entries) {
    if (previewRows.length >= limit) break
    if (options.skippedTransactionIds.has(entry.transactionId)) continue

    const legs = resolveLegs(entry, sources, categorySources, options)
    if (!legs) continue
    for (const [legIndex, leg] of legs.entries()) {
      if (previewRows.length >= limit) break
      previewRows.push(buildPreviewRow(entry, leg, legIndex, timestamp))
    }
  }
  return previewRows
}

function resolveLegs(
  entry: ActualJournalEntry,
  sources: Map<string, ActualAccountSource>,
  categorySources: Map<string, { createName: string }>,
  options: ActualPreviewOptions,
): ActualPreviewLeg[] | null {
  const source = entry.sourceAccountId ? resolveAccount(sources.get(entry.sourceAccountId), options) : null
  const destination = entry.destinationAccountId ? resolveAccount(sources.get(entry.destinationAccountId), options) : null
  if ((entry.sourceAccountId && !source) || (entry.destinationAccountId && !destination)) return null

  const mappedCategory = entry.categorySourceId
    ? resolveCategory(entry.categorySourceId, categorySources.get(entry.categorySourceId)?.createName ?? '', options)
    : undefined
  const units = (account: ActualPreviewAccount) => toMinorUnits(entry.amount, account.exponent)

  if (entry.type === 'opening balance') {
    const account = (destination ?? source)!
    const amount = units(account)
    if (amount === null) return null
    return [{
      account,
      minorUnits: destination ? amount : -amount,
      category: options.balanceAdjustmentCategory,
      merchantName: null,
      counterpartyAccount: null,
    }]
  }

  if (entry.type === 'transfer' && source && destination) {
    const sourceAmount = units(source)
    const destinationAmount = units(destination)
    if (sourceAmount === null || destinationAmount === null) return null

    // The budget-side leg of a categorised transfer keeps its category, and the other takes Transfer.
    // Filed as spending or income, that leg records no other account and takes it as its merchant. A
    // credit card payment files both legs under its category
    const buildLeg = (leg: 'source' | 'destination', account: ActualPreviewAccount, minorUnits: number, other: ActualPreviewAccount): ActualPreviewLeg => {
      if (entry.categoryLeg !== leg && entry.categoryLeg !== 'both') return { account, minorUnits, category: options.transferCategory, merchantName: null, counterpartyAccount: other }
      const isSpending = mappedCategory && !canCarryActualTransfer(mappedCategory)
      return {
        account,
        minorUnits,
        category: mappedCategory,
        merchantName: isSpending ? entry.payeeName : null,
        counterpartyAccount: isSpending ? null : other,
      }
    }
    return [
      buildLeg('source', source, -sourceAmount, destination),
      buildLeg('destination', destination, destinationAmount, source),
    ]
  }

  const account = (source ?? destination)!
  const amount = units(account)
  if (amount === null) return null
  return [{
    account,
    minorUnits: source ? -amount : amount,
    category: mappedCategory,
    merchantName: entry.payeeName,
    counterpartyAccount: null,
  }]
}

function resolveAccount(source: ActualAccountSource | undefined, options: ActualPreviewOptions): ActualPreviewAccount | null {
  if (!source) return null
  const choice = options.accountMappings[source.id]
  if (!choice) return null

  if (choice === CREATE_ACCOUNT_VALUE) {
    const details = options.accountCreateDetails[source.id]
    const currency = (details?.currency ?? '').toUpperCase()
    const exponent = findCurrencyExponent(options.currencies, currency)
    if (exponent === null) return null
    return {
      id: CREATE_ACCOUNT_VALUE,
      name: source.name,
      currency,
      exponent,
      institution: options.institutionById.get(details?.institutionId ?? '') ?? null,
    }
  }

  const account = options.accountById.get(choice)
  const exponent = account ? findCurrencyExponent(options.currencies, account.currency.toUpperCase()) : null
  if (!account || exponent === null) return null
  return { id: account.id, name: account.name, currency: account.currency, exponent, institution: account.institution }
}

function resolveCategory(sourceId: string, createName: string, options: ActualPreviewOptions): Category | undefined {
  const choice = options.categoryMappings[sourceId]
  if (choice !== CREATE_CATEGORY_VALUE) return choice ? options.categoryById.get(choice) : undefined
  return {
    id: `actual-preview-category-${sourceId}`,
    group_id: null,
    owner_id: null,
    name: options.categoryRenames[sourceId] ?? createName,
    kind: options.categoryCreateKinds[sourceId] ?? 'expense',
    icon: DEFAULT_CATEGORY_ICON,
    is_system: false,
    created_at: '',
  }
}

/** Converts hundredths into the minor units of a currency, or null when that currency can't hold them */
function toMinorUnits(hundredths: number, exponent: number) {
  if (exponent >= 2) return hundredths * 10 ** (exponent - 2)
  const divisor = 10 ** (2 - exponent)
  return hundredths % divisor === 0 ? hundredths / divisor : null
}

function getCounterpartyScope(leg: ActualPreviewLeg) {
  if (leg.counterpartyAccount) return 'tracked'
  return leg.category && canCarryActualTransfer(leg.category) ? 'outside' : null
}

function buildPreviewRow(entry: ActualJournalEntry, leg: ActualPreviewLeg, legIndex: number, timestamp: string): PreviewTransactionRow {
  const id = `actual-preview-${entry.transactionId}-${legIndex}`
  const tagIds = entry.tags.map((tag, tagIndex) => `${id}-tag-${tagIndex}-${tag}`)

  return {
    id,
    accountInstitution: leg.account.institution,
    accountName: leg.account.name,
    category: leg.category,
    currency: leg.account.currency,
    dateLabel: getPreviewDateLabel(entry.date),
    counterpartyAccountName: leg.counterpartyAccount?.name,
    transaction: {
      id,
      created_by_user_id: 'import-preview',
      account_id: leg.account.id,
      dt: entry.date,
      merchant_id: leg.merchantName ? `${id}-merchant` : null,
      merchant_name: leg.merchantName,
      category_id: leg.category?.id ?? '',
      amount: leg.minorUnits,
      account_amount: leg.minorUnits,
      base_currency_amount: leg.minorUnits,
      currency: leg.account.currency,
      fx_rate: null,
      notes: entry.notes,
      counterparty_account_id: leg.counterpartyAccount?.id ?? null,
      counterparty_account_scope: getCounterpartyScope(leg),
      created_at: timestamp,
      updated_at: timestamp,
      tag_ids: tagIds,
      tags: entry.tags.map((tag, tagIndex) => ({ id: tagIds[tagIndex], group_id: null, name: tag })),
    },
  }
}
