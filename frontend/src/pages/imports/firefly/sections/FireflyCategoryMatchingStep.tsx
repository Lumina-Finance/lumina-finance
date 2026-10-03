import {
  CREATE_CATEGORY_VALUE,
  getImportCategoryRenameHelp,
  getImportCategoryRenameLabel,
  TRANSFERS_AND_DEBT_PAYMENTS_TITLE,
  TRANSFERS_EXPLANATION,
} from '@/pages/imports/constants'
import { ImportInfoCard } from '@/pages/imports/components'
import { ImportCategoryMatchingLayout } from '@/pages/imports/sections'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'

type FireflyCategoryMatchingStepProps = Pick<
  FireflyImportWorkflow,
  | 'transactionsFile'
  | 'importedCategories'
  | 'resolvedCategoryMappings'
  | 'autoFilledCategories'
  | 'resolvedCategoryKinds'
  | 'categoryRenames'
  | 'categoryById'
  | 'setCategoryCreateKinds'
  | 'setCategoryCreateNames'
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
  categoryRenames,
  categoryById,
  setCategoryCreateKinds,
  setCategoryCreateNames,
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
        const rename = categoryRenames[source]

        return {
          id: source,
          source,
          autoFilled: autoFilledCategories.has(source),
          detailKind,
          detailDisabled: existingMatch,
          onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [source]: kind })),
          value,
          onChange: (nextValue) => setCategoryMappings((current) => ({ ...current, [source]: nextValue })),
          rename: rename === undefined ? undefined : {
            label: getImportCategoryRenameLabel(source),
            help: getImportCategoryRenameHelp(rename),
            value: rename.name,
            isProposed: rename.isProposed,
            onChange: (name: string) => setCategoryCreateNames((current) => ({ ...current, [source]: name })),
          },
        }
      })}
      options={categoryMatchOptions}
      categoriesLoading={categoriesLoading}
      categoriesFailed={categoriesFailed}
      refetchCategories={refetchCategories}
    >
      {/* Worded to the row resolution: a journal between two imported accounts is a transfer
          whatever its Firefly III type, and only a row paying or paid by someone keeps its category */}
      {transactionsFile && (
        <ImportInfoCard title={TRANSFERS_AND_DEBT_PAYMENTS_TITLE}>
          {TRANSFERS_EXPLANATION} Anything in Firefly III between two accounts you're importing, like your asset accounts, loans, debts and mortgages, is imported as a transfer, whatever its type in Firefly III. So a payment recorded as a withdrawal into a loan, debt or mortgage is a transfer too, and its category isn't imported. A payment recorded as a withdrawal to an expense account is imported as spending in its category, which you can match to Debt Payment below.
        </ImportInfoCard>
      )}
    </ImportCategoryMatchingLayout>
  )
}
