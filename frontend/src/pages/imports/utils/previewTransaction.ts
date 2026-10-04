import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Institution } from '@/api/institutions'
import type { TransferCounterpartyScope } from '@/api/transactions'
import { CREATE_ACCOUNT_VALUE, DEFAULT_CATEGORY_ICON } from '@/pages/imports/constants'
import type { ImportAccountCreateDetails, ImportCategoryKind, PreviewTransactionRow } from '@/pages/imports/types'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, doesTransferRecordCounterpartyAccount } from '@/utils/transfers'
import { getPreviewDateLabel } from './valueParsers'

/**
 * The ledger account a previewed transaction lands in, after the user's account answer is applied
 *
 * An account queued for creation has no id yet, so it carries the create sentinel and the name of
 * the source it comes from
 */
export interface PreviewAccount {
  id: string
  name: string
  currency: string
  institution: Institution | null
}

/**
 * The other account a previewed transfer names, which can also be one queued for creation
 */
export interface PreviewCounterpartyAccount {
  id: string
  name: string
}

interface PreviewTransactionInput {
  /** Unique among the preview's rows, and the prefix of the stand-in ids the row's parts carry */
  id: string
  account: PreviewAccount
  category: Category | undefined
  dt: string

  /** Signed minor units in the account's currency, kept exact as a bigint where the import reads them that way */
  amount: number | bigint
  merchantName: string | null
  notes: string | null
  counterpartyAccount: PreviewCounterpartyAccount | null
  counterpartyScope: TransferCounterpartyScope | null
  tagNames: string[]
  timestamp: string
}

/**
 * Wraps one row the import will write in the shape the shared transaction row renders
 */
export function buildPreviewTransactionRow(input: PreviewTransactionInput): PreviewTransactionRow {
  const { id, account, category, amount } = input
  const tagIds = input.tagNames.map((tag, tagIndex) => `${id}-tag-${tagIndex}-${tag}`)
  const transaction = {
    id,
    created_by_user_id: 'import-preview',
    account_id: account.id,
    dt: input.dt,
    merchant_id: input.merchantName ? `${id}-merchant` : null,
    merchant_name: input.merchantName,
    category_id: category?.id ?? '',
    currency: account.currency,
    fx_rate: null,
    notes: input.notes,
    counterparty_account_id: input.counterpartyAccount?.id ?? null,
    counterparty_account_scope: input.counterpartyScope,
    created_at: input.timestamp,
    updated_at: input.timestamp,
    tag_ids: tagIds,
    tags: input.tagNames.map((tag, tagIndex) => ({ id: tagIds[tagIndex], group_id: null, name: tag })),
  }

  return {
    id,
    accountInstitution: account.institution,
    accountName: account.name,
    category,
    currency: account.currency,
    dateLabel: getPreviewDateLabel(input.dt),
    counterpartyAccountName: input.counterpartyAccount?.name,

    // The two branches keep one amount type across the three amount fields, as the row's type requires
    transaction: typeof amount === 'bigint'
      ? { ...transaction, amount, account_amount: amount, base_currency_amount: amount }
      : { ...transaction, amount, account_amount: amount, base_currency_amount: amount },
  }
}

/**
 * Builds the stand-in record for a category the import will create, since it has no row of its own yet
 *
 * @param source - The source value the category comes from, which keeps the stand-in id unique
 * @param name - The name it will be created under, which a rename can make differ from the source
 */
export function buildPreviewCategory(source: string, name: string, kind: ImportCategoryKind): Category {
  return {
    id: `import-preview-category-${source}`,
    group_id: null,
    owner_id: null,
    name,
    kind,
    icon: DEFAULT_CATEGORY_ICON,
    is_system: false,
    created_at: '',
  }
}

/**
 * Resolves the account an answered source lands in, or null when the source has no answer yet or
 * its chosen account is no longer listed
 *
 * @param sourceName - The name a new account is created under
 * @param createDetails - What the user chose for a new account, read only when the answer is to create one
 */
export function resolvePreviewAccount(
  choice: string,
  sourceName: string,
  createDetails: Pick<ImportAccountCreateDetails, 'currency' | 'institutionId'> | undefined,
  accountById: Map<string, AccountsOverview>,
  institutionById: Map<string, Institution>,
): PreviewAccount | null {
  if (!choice) return null

  if (choice === CREATE_ACCOUNT_VALUE) {
    return {
      id: CREATE_ACCOUNT_VALUE,
      name: sourceName,
      currency: (createDetails?.currency ?? '').trim().toUpperCase(),
      institution: institutionById.get(createDetails?.institutionId ?? '') ?? null,
    }
  }

  const account = accountById.get(choice)
  if (!account) return null
  return { id: account.id, name: account.name, currency: account.currency, institution: account.institution }
}

/**
 * Resolves what a previewed transaction records about where its money went, mirroring the commit
 *
 * A row naming another account records it. Otherwise a transfer records that the money left the
 * app, except Balance Adjustment, which the backend matches by name and which has no other side,
 * and a category that isn't a transfer records neither
 */
export function getPreviewCounterpartyScope(
  category: Category | undefined,
  counterpartyAccount: PreviewCounterpartyAccount | null,
): TransferCounterpartyScope | null {
  if (counterpartyAccount) return 'tracked'
  return doesPreviewCategoryRecordCounterparty(category) ? 'outside' : null
}

/**
 * Reports whether a previewed row's category can record where the money went
 */
export function doesPreviewCategoryRecordCounterparty(category: Pick<Category, 'kind' | 'name'> | undefined) {
  if (!category) return false
  return doesTransferRecordCounterpartyAccount(category.kind, category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME)
}
