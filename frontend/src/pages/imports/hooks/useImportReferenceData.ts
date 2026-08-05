import { useMemo } from 'react'
import { useAccounts, type AccountsOverview } from '@/api/accounts'
import { useCategories, type Category } from '@/api/categories'
import { useCurrencies, type Currency } from '@/api/currency'
import { useInstitutions, type Institution } from '@/api/institutions'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import {
  buildImportAccountOptions,
  buildImportCategoryMatchOptions,
  buildImportCurrencyOptions,
  buildImportInstitutionOptions,
} from '@/pages/imports/utils'

/**
 * Reference data shared by both import flows: the accounts, currencies, institutions and categories
 * the user already has, plus the dropdown options and by-id lookup maps built from them
 */
export interface ImportReferenceData {
  currencies: Currency[]
  categories: Category[] | undefined
  accountsLoading: boolean
  currenciesLoading: boolean
  institutionsLoading: boolean
  categoriesLoading: boolean

  /**
   * Whether the currency list could not be fetched
   *
   * Reading a file needs the real list, since a code absent from it counts as no currency at all,
   * so both flows block their upload until the list arrives. This says which of the two things
   * happened, so the user is told to reload rather than to wait
   */
  currenciesError: boolean

  /**
   * Whether the accounts list has never arrived and the last attempt at it failed
   *
   * Both halves matter. A step with no list to map onto offers only "Create New Account", so
   * everything gets mapped to new and the import duplicates accounts the user already has. A
   * refetch that fails over a list already in hand costs nothing, so it must not take the step
   * away, and neither must an empty list belonging to a user who has no accounts yet
   */
  accountsFailed: boolean

  /** Whether the categories list has never arrived and the last attempt at it failed */
  categoriesFailed: boolean

  /**
   * Whether each list has arrived at least once, which is what makes it safe to judge a stored
   * answer against
   *
   * A list that is still loading, whose first fetch failed, or whose query is switched off looks
   * exactly like a list with nothing in it, and clearing every answer against one of those would
   * throw away work the user has already done
   */
  accountsResolved: boolean
  categoriesResolved: boolean

  refetchAccounts: () => void
  refetchCategories: () => void
  selectableAccounts: AccountsOverview[]
  allAccounts: AccountsOverview[]
  accountOptions: DropdownOption[]
  currencyOptions: DropdownOption[]
  institutionOptions: DropdownOption[]
  categoryMatchOptions: DropdownOption[]
  accountById: Map<string, AccountsOverview>
  categoryById: Map<string, Category>
  institutionById: Map<string, Institution>
}

/**
 * Loads the accounts, currencies, institutions and categories both import flows resolve their
 * mappings against, and derives the dropdown options and by-id lookup maps every mapping step needs
 */
export function useImportReferenceData(): ImportReferenceData {
  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isError: accountsError,
    dataUpdatedAt: accountsUpdatedAt,
    refetch: refetchAccountsQuery,
  } = useAccounts()
  const { data: currencies = [], isLoading: currenciesLoading, isError: currenciesError } = useCurrencies()

  // The institution list gates nothing: the commit writes a null institution for a new account that
  // has none, so a step answered without the list still imports
  const { data: institutions = [], isLoading: institutionsLoading } = useInstitutions()
  const {
    data: categories,
    isLoading: categoriesLoading,
    isError: categoriesError,
    dataUpdatedAt: categoriesUpdatedAt,
    refetch: refetchCategoriesQuery,
  } = useCategories()

  // An archived account takes no new transactions, so it is left out of every source rows are
  // written to. A transfer's counterparty is the one place it stays offerable, since recording it
  // writes nothing to the account and the transfer usually predates the archiving
  const selectableAccounts = useMemo(
    () => accounts.filter((account) => !account.is_archived),
    [accounts],
  )

  const accountOptions = useMemo(
    () => buildImportAccountOptions(selectableAccounts),
    [selectableAccounts],
  )

  const currencyOptions = useMemo(
    () => buildImportCurrencyOptions(currencies),
    [currencies],
  )

  const institutionOptions = useMemo(
    () => buildImportInstitutionOptions(institutions),
    [institutions],
  )

  const categoryMatchOptions = useMemo(
    () => buildImportCategoryMatchOptions(categories),
    [categories],
  )

  // Every account, not only the selectable ones, or a transfer recording an archived counterparty
  // would preview with no name against it
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  )

  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  )

  const institutionById = useMemo(
    () => new Map(institutions.map((institution) => [institution.id, institution])),
    [institutions],
  )

  return {
    currencies,
    categories,
    accountsLoading,
    currenciesLoading,
    currenciesError,
    // Keyed on the list never having arrived rather than on it being empty, or a user who genuinely
    // has no accounts would lose the step to a failure message the moment a refetch failed, on the
    // one path where mapping everything to a new account is exactly right
    accountsFailed: accountsError && accountsUpdatedAt === 0,
    categoriesFailed: categoriesError && categoriesUpdatedAt === 0,

    // Set only when data is written, so it stays at zero through a first load, a first fetch that
    // failed, and a query switched off, and holds its earlier value when a later refetch fails
    accountsResolved: accountsUpdatedAt > 0,
    categoriesResolved: categoriesUpdatedAt > 0,
    refetchAccounts: refetchAccountsQuery,
    refetchCategories: refetchCategoriesQuery,
    institutionsLoading,
    categoriesLoading,
    selectableAccounts,
    allAccounts: accounts,
    accountOptions,
    currencyOptions,
    institutionOptions,
    categoryMatchOptions,
    accountById,
    categoryById,
    institutionById,
  }
}
