import { useMemo } from 'react'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME } from '@/utils/transfers'
import type { ImportAccountSource } from '@/pages/imports/types'
import { buildImportAccountOptions, dropVanishedAccountMappings, isAutoFilledAccountSource } from '@/pages/imports/utils'
import { getPersonalAccounts, getPersonalCategoryOptions, resolveProviderAccountMappings } from '@/pages/imports/utils/resourceScope'
import { useImportReferenceData } from './useImportReferenceData'

/**
 * The user's accounts, categories and currencies as a provider import reads them
 *
 * A provider import writes the user's own records, so its account and category choices leave out
 * every group one. The seeded categories the commit files transfer legs and balance rows under are
 * read here too, so the preview can show them
 */
export function useProviderImportReferenceData({ transferCategoryName }: { transferCategoryName: string }) {
  const reference = useImportReferenceData()
  const { categories, selectableAccounts, categoryMatchOptions: allCategoryMatchOptions, categoryById } = reference

  const accountOptions = useMemo(() => buildImportAccountOptions(getPersonalAccounts(selectableAccounts)), [selectableAccounts])
  const categoryMatchOptions = useMemo(
    () => getPersonalCategoryOptions(allCategoryMatchOptions, categoryById),
    [allCategoryMatchOptions, categoryById],
  )

  const transferCategory = useMemo(
    () => (categories ?? []).find((category) => category.is_system && category.name === transferCategoryName),
    [categories, transferCategoryName],
  )
  const balanceAdjustmentCategory = useMemo(
    () => (categories ?? []).find((category) => category.is_system && category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME),
    [categories],
  )

  return { ...reference, accountOptions, categoryMatchOptions, transferCategory, balanceAdjustmentCategory }
}

/**
 * Settles the account each source of a provider import is written to, from the answers the user
 * gave, a name match and the create-new default
 *
 * Every source takes rows or is created, so none can be answered as money outside the import
 */
export function useProviderAccountAnswers({
  sources,
  accountMappings,
  reference: { accountsResolved, accountsCurrent, accountById, selectableAccounts },
}: {
  sources: ImportAccountSource[]
  accountMappings: Record<string, string>
  reference: Pick<
    ReturnType<typeof useImportReferenceData>,
    'accountsResolved' | 'accountsCurrent' | 'accountById' | 'selectableAccounts'
  >
}) {
  // An answer pointing at a deleted account is dropped before anything is derived from it, or the
  // commit sends an id the server will refuse
  const liveAccountMappings = useMemo(
    () => (accountsResolved ? dropVanishedAccountMappings(accountMappings, accountById).mappings : accountMappings),
    [accountById, accountMappings, accountsResolved],
  )

  const resolvedAccountMappings = useMemo(
    () => resolveProviderAccountMappings({
      sources,
      liveMappings: liveAccountMappings,
      selectableAccounts,
      accountsCurrent,
    }),
    [accountsCurrent, liveAccountMappings, selectableAccounts, sources],
  )

  const autoFilledAccountSources = useMemo(
    () => new Set(sources.map((source) => source.id).filter((source) => (
      isAutoFilledAccountSource(liveAccountMappings[source] ?? '', resolvedAccountMappings[source] ?? '', false)
    ))),
    [liveAccountMappings, resolvedAccountMappings, sources],
  )

  // Read before the name match and the create-new default are layered on, so the batch bar can tell
  // an answer the user gave from one the step filled in for them
  const handAnsweredAccountSources = useMemo(
    () => new Set(Object.entries(liveAccountMappings).filter(([, choice]) => choice).map(([source]) => source)),
    [liveAccountMappings],
  )

  return { resolvedAccountMappings, autoFilledAccountSources, handAnsweredAccountSources }
}
