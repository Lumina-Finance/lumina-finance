import { useMemo, useState } from 'react'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME } from '@/utils/transfers'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import type { ImportAccountSource, ImportCategoryKind } from '@/pages/imports/types'
import {
  buildImportAccountOptions,
  dropVanishedAccountMappings,
  dropVanishedCategoryMappings,
  getImportCategoryRenames,
  isAutoFilledAccountSource,
} from '@/pages/imports/utils'
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

/**
 * The user's category answers in a provider import: the category each source is matched to, and
 * the type and name of one created for it
 */
export function useProviderCategoryAnswerState() {
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({})
  const [categoryCreateKinds, setCategoryCreateKinds] = useState<Record<string, ImportCategoryKind>>({})
  const [categoryCreateNames, setCategoryCreateNames] = useState<Record<string, string>>({})

  const resetCategoryAnswers = () => {
    setCategoryMappings({})
    setCategoryCreateKinds({})
    setCategoryCreateNames({})
  }

  return {
    categoryMappings,
    categoryCreateKinds,
    categoryCreateNames,
    setCategoryMappings,
    setCategoryCreateKinds,
    setCategoryCreateNames,
    resetCategoryAnswers,
  }
}

/**
 * Settles the category each source of a provider import is written to, from the answers the user
 * gave and the import's own match, with the type and name each new category is created under
 *
 * @param sources - Each category source with the name a new category takes from it
 * @param inferMappings - The import's own match, filling in the sources the user left unanswered
 * @param proposedKinds - The type each new category is proposed with until the user picks one
 * @param fixedKindSources - Sources whose new category can only take its proposed type
 * @param appName - The app the import comes from, which a proposed new name carries
 */
export function useProviderCategoryAnswers({
  sources,
  answers: { categoryMappings, categoryCreateKinds, categoryCreateNames },
  inferMappings,
  proposedKinds,
  fixedKindSources,
  appName,
  reference: { categoriesResolved, categoryById },
}: {
  sources: Array<{ id: string; name: string }>
  answers: Pick<ReturnType<typeof useProviderCategoryAnswerState>, 'categoryMappings' | 'categoryCreateKinds' | 'categoryCreateNames'>
  inferMappings: (liveMappings: Record<string, string>) => Record<string, string>
  proposedKinds: Record<string, ImportCategoryKind>
  fixedKindSources?: ReadonlySet<string>
  appName: string
  reference: Pick<ReturnType<typeof useImportReferenceData>, 'categoriesResolved' | 'categoryById'>
}) {
  // Same reason as the accounts: a match pointing at a deleted category would reach the commit
  const liveCategoryMappings = useMemo(
    () => (categoriesResolved ? dropVanishedCategoryMappings(categoryMappings, categoryById).mappings : categoryMappings),
    [categoriesResolved, categoryById, categoryMappings],
  )

  const resolvedCategoryMappings = useMemo(() => inferMappings(liveCategoryMappings), [inferMappings, liveCategoryMappings])

  const autoFilledCategories = useMemo(
    () => new Set(sources.map((source) => source.id).filter((source) => (
      !liveCategoryMappings[source] && resolvedCategoryMappings[source] !== CREATE_CATEGORY_VALUE
    ))),
    [liveCategoryMappings, resolvedCategoryMappings, sources],
  )

  const resolvedCategoryKinds = useMemo(
    () => {
      const kinds: Record<string, ImportCategoryKind> = {}
      for (const { id } of sources) {
        kinds[id] = fixedKindSources?.has(id) ? proposedKinds[id] : categoryCreateKinds[id] ?? proposedKinds[id]
      }
      return kinds
    },
    [categoryCreateKinds, fixedKindSources, proposedKinds, sources],
  )

  const categoryRenames = useMemo(
    () => getImportCategoryRenames({
      sources,
      mappings: resolvedCategoryMappings,
      kinds: resolvedCategoryKinds,
      typedNames: categoryCreateNames,
      categoryById,
      appName,
    }),
    [appName, categoryById, categoryCreateNames, resolvedCategoryKinds, resolvedCategoryMappings, sources],
  )

  return { resolvedCategoryMappings, autoFilledCategories, resolvedCategoryKinds, categoryRenames }
}
