import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { TransactionImportAccountMapping, TransactionImportCategoryMapping } from '@/api/transaction-imports'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  getImportAccountCurrencyRequiredError,
  getImportAccountMappingError,
  getImportAccountTypeRequiredError,
  getImportAccountTypeUnsupportedError,
  getImportCategoryMappingError,
  getImportCategoryTypeRequiredError,
  getImportGroupAccountError,
  getImportGroupCategoryError,
  getImportReadOnlyAccountMappingError,
  IMPORT_ACCOUNT_NAME_MAX_LENGTH,
} from '@/pages/imports/constants'
import type { ImportAccountCreateDetails, ImportCategoryKind, ImportCategoryRename } from '@/pages/imports/types'
import { isImportAccountType } from '@/pages/imports/accountTypeGuard'
import { isImportableAccount } from './accountScope'
import { checkImportCategoryCreate, findReusedImportCategory } from './categoryMatching'
import { isGroupResource } from './resourceScope'

type AddError = (message: string) => void

interface ImportAccountAnswer {
  /** The mapping source, which the import's rows name the account by */
  source: string

  /** How the source is named in a refusal */
  label: string

  /** The name a new account is created under */
  name: string
  choice: string
  createDetails: Partial<ImportAccountCreateDetails> | undefined
  accountById: Map<string, AccountsOverview>

  /**
   * Whether the import writes rows to this account, which an archived or read-only account can't
   * take. A source only named as the other side of a transfer can point at one
   */
  takesRows: boolean

  /** Whether this import refuses a group account, which only the CSV import accepts */
  refusesGroupAccount: boolean

  /** Says why a new account's name is too long, for an import whose source app allows longer names */
  getNameTooLongError?: (label: string) => string
}

export interface ImportAccountMappingResult {
  mapping: TransactionImportAccountMapping

  /** The existing account rows land in, undefined for a new account or one no longer listed */
  account: AccountsOverview | undefined
}

/**
 * Turns one account answer into the mapping the server receives, reporting every reason the answer
 * can't be sent and returning null instead
 *
 * The CSV import's "outside this app" answer is its own and is settled before this is asked
 */
export function buildImportAccountMapping(answer: ImportAccountAnswer, addError: AddError): ImportAccountMappingResult | null {
  const { source, label, choice } = answer
  if (!choice) {
    addError(getImportAccountMappingError(label))
    return null
  }

  if (choice !== CREATE_ACCOUNT_VALUE) {
    const account = answer.accountById.get(choice)

    // A group account isn't offered where the import refuses one, so one still chosen is a stale
    // answer, refused wherever it points. Those imports write only the user's own records
    if (answer.refusesGroupAccount && account && isGroupResource(account)) {
      addError(getImportGroupAccountError(label))
      return null
    }

    // An account archived or made read-only after it was chosen is refused here rather than by the
    // server part way through the import
    if (answer.takesRows && account && !isImportableAccount(account)) {
      addError(getImportReadOnlyAccountMappingError(label, account))
      return null
    }

    return { mapping: { source, account_id: choice }, account }
  }

  if (answer.getNameTooLongError && [...answer.name].length > IMPORT_ACCOUNT_NAME_MAX_LENGTH) {
    addError(answer.getNameTooLongError(label))
    return null
  }

  const { accountType, currency, institutionId } = answer.createDetails ?? {}
  if (!accountType) addError(getImportAccountTypeRequiredError(label))
  if (!currency) addError(getImportAccountCurrencyRequiredError(label))
  if (!accountType || !currency) return null

  if (!isImportAccountType(accountType)) {
    addError(getImportAccountTypeUnsupportedError(label))
    return null
  }

  return {
    mapping: {
      source,
      create: {
        name: answer.name,
        account_type: accountType,
        currency: currency.toUpperCase(),
        institution_id: institutionId || null,
      },
    },
    account: undefined,
  }
}

interface ImportCategoryAnswer {
  /** The mapping source, which the import's rows name the category by */
  source: string

  /** How the source is named in a refusal */
  label: string

  /** The name a new category takes unless it's renamed */
  createName: string
  choice: string

  /** The type a new category is created with, empty while it has none */
  createKind: ImportCategoryKind | '' | undefined

  /** The name a new category takes instead of its own, because an existing category holds that name */
  rename: ImportCategoryRename | undefined
  categoryById: Map<string, Category>

  /** The new categories already declared, which the check for two of one name with different types reads */
  createdByKey: Map<string, { label: string; kind: ImportCategoryKind }>

  /** Whether this import refuses a group category, which only the CSV import accepts */
  refusesGroupCategory: boolean

  /**
   * The import's own rule for the category a source lands on, existing or new, returning a refusal
   * or null. Run before the checks on a new category's name
   */
  checkCategory?: (category: Pick<Category, 'kind' | 'name'>, isNew: boolean) => string | null
}

export interface ImportCategoryMappingResult {
  mapping: TransactionImportCategoryMapping

  /** The type rows land in, or null where the chosen category is no longer listed */
  kind: ImportCategoryKind | null

  /**
   * The existing category rows land in: the chosen one, or the one a new category reuses because it
   * already has that name
   */
  category: Category | undefined

  /** The name rows are filed under */
  name: string
}

/**
 * Turns one category answer into the mapping the server receives, reporting the reason the answer
 * can't be sent and returning null instead
 */
export function buildImportCategoryMapping(answer: ImportCategoryAnswer, addError: AddError): ImportCategoryMappingResult | null {
  const { source, label, choice, categoryById } = answer
  if (!choice) {
    addError(getImportCategoryMappingError(label))
    return null
  }

  if (choice !== CREATE_CATEGORY_VALUE) {
    const category = categoryById.get(choice)
    if (answer.refusesGroupCategory && category && isGroupResource(category)) {
      addError(getImportGroupCategoryError(label))
      return null
    }

    const refusal = category && answer.checkCategory?.(category, false)
    if (refusal) {
      addError(refusal)
      return null
    }

    return { mapping: { source, category_id: choice }, kind: category?.kind ?? null, category, name: category?.name ?? '' }
  }

  const kind = answer.createKind
  if (!kind) {
    addError(getImportCategoryTypeRequiredError(label))
    return null
  }

  const name = answer.rename?.name.trim() ?? answer.createName
  const refusal = answer.checkCategory?.({ kind, name }, true)
    ?? checkImportCategoryCreate({
      label,
      name,
      isRenamed: answer.rename !== undefined,
      kind,
      categoryById,
      createdByKey: answer.createdByKey,
    })
  if (refusal) {
    addError(refusal)
    return null
  }

  return {
    mapping: { source, create: { name, kind, icon: DEFAULT_CATEGORY_ICON } },
    kind,
    category: findReusedImportCategory(name, categoryById.values()),
    name,
  }
}
