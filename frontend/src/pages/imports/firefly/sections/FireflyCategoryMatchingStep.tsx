import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { ImportCategoryMatchingLayout } from '@/pages/imports/sections'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'

type FireflyCategoryMatchingStepProps = Pick<
  FireflyImportWorkflow,
  | 'transactionsFile'
  | 'importedCategories'
  | 'resolvedCategoryMappings'
  | 'autoFilledCategories'
  | 'resolvedCategoryKinds'
  | 'categoryById'
  | 'setCategoryCreateKinds'
  | 'setCategoryMappings'
  | 'categoryMatchOptions'
  | 'categoriesLoading'
  | 'categoriesFailed'
  | 'refetchCategories'
>

/**
 * Category matching step of the Firefly III import flow, showing every category the imported rows
 * are written with
 */
export function FireflyCategoryMatchingStep({
  transactionsFile,
  importedCategories,
  resolvedCategoryMappings,
  autoFilledCategories,
  resolvedCategoryKinds,
  categoryById,
  setCategoryCreateKinds,
  setCategoryMappings,
  categoryMatchOptions,
  categoriesLoading,
  categoriesFailed,
  refetchCategories,
}: FireflyCategoryMatchingStepProps) {
  return (
    <ImportCategoryMatchingLayout
      index="03"
      description="Exported category names matched an existing category where possible. The rest are queued as new categories."
      sourceLabel="Category From Export"
      empty={transactionsFile
        ? {
            title: 'No categories to match',
            description: 'No imported row keeps a category of its own. Transfers are filed under Transfer and balance rows under Balance Adjustment.',
          }
        : { title: 'No imported categories detected', description: 'Upload the transactions CSV first.' }}
      rows={importedCategories.map((source) => {
        const value = resolvedCategoryMappings[source] ?? ''
        const existingMatch = Boolean(value) && value !== CREATE_CATEGORY_VALUE
        const detailKind = existingMatch
          ? categoryById.get(value)?.kind ?? ''
          : resolvedCategoryKinds[source] ?? ''

        return {
          id: source,
          source,
          autoFilled: autoFilledCategories.has(source),
          detailKind,
          detailDisabled: existingMatch,
          onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [source]: kind })),
          value,
          onChange: (nextValue) => setCategoryMappings((current) => ({ ...current, [source]: nextValue })),
        }
      })}
      options={categoryMatchOptions}
      categoriesLoading={categoriesLoading}
      categoriesFailed={categoriesFailed}
      refetchCategories={refetchCategories}
    />
  )
}
