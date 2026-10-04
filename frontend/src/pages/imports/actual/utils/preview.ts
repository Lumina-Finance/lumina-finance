import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import type { ImportCategoryKind, ImportCategoryRename, PreviewTransactionRow } from '@/pages/imports/types'
import {
  buildPreviewCategory,
  buildPreviewTransactionRow,
  getPreviewCounterpartyScope,
  type PreviewAccount,
  resolvePreviewAccount,
} from '@/pages/imports/utils'
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
  categoryRenames: Record<string, ImportCategoryRename>
  categoryById: Map<string, Category>
  transferCategory: Category | undefined
  balanceAdjustmentCategory: Category | undefined
  currencies: Currency[]

  /** Rows the upload leaves out, which the preview leaves out too */
  skippedTransactionIds: ReadonlySet<string>
}

interface ActualPreviewAccount extends PreviewAccount {
  exponent: number
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
  const account = resolvePreviewAccount(
    options.accountMappings[source.id] ?? '',
    source.name,
    options.accountCreateDetails[source.id],
    options.accountById,
    options.institutionById,
  )
  const exponent = account ? findCurrencyExponent(options.currencies, account.currency.toUpperCase()) : null
  return account && exponent !== null ? { ...account, exponent } : null
}

function resolveCategory(sourceId: string, createName: string, options: ActualPreviewOptions): Category | undefined {
  const choice = options.categoryMappings[sourceId]
  if (choice !== CREATE_CATEGORY_VALUE) return choice ? options.categoryById.get(choice) : undefined
  return buildPreviewCategory(sourceId, options.categoryRenames[sourceId]?.name ?? createName, options.categoryCreateKinds[sourceId] ?? 'expense')
}

/** Converts hundredths into the minor units of a currency, or null when that currency can't hold them */
function toMinorUnits(hundredths: number, exponent: number) {
  if (exponent >= 2) return hundredths * 10 ** (exponent - 2)
  const divisor = 10 ** (2 - exponent)
  return hundredths % divisor === 0 ? hundredths / divisor : null
}

function buildPreviewRow(entry: ActualJournalEntry, leg: ActualPreviewLeg, legIndex: number, timestamp: string): PreviewTransactionRow {
  return buildPreviewTransactionRow({
    id: `actual-preview-${entry.transactionId}-${legIndex}`,
    account: leg.account,
    category: leg.category,
    dt: entry.date,
    amount: leg.minorUnits,
    merchantName: leg.merchantName,
    notes: entry.notes,
    counterpartyAccount: leg.counterpartyAccount,
    counterpartyScope: getPreviewCounterpartyScope(leg.category, leg.counterpartyAccount),
    tagNames: entry.tags,
    timestamp,
  })
}
