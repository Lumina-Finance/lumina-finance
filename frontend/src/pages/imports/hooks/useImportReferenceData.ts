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
  selectableAccounts: AccountsOverview[]
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
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts()
  const { data: currencies = [], isLoading: currenciesLoading } = useCurrencies()
  const { data: institutions = [], isLoading: institutionsLoading } = useInstitutions()
  const { data: categories, isLoading: categoriesLoading } = useCategories()

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

  const accountById = useMemo(
    () => new Map(selectableAccounts.map((account) => [account.id, account])),
    [selectableAccounts],
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
    institutionsLoading,
    categoriesLoading,
    selectableAccounts,
    accountOptions,
    currencyOptions,
    institutionOptions,
    categoryMatchOptions,
    accountById,
    categoryById,
    institutionById,
  }
}
