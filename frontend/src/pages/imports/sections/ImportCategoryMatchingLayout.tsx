import type { ComponentProps, ReactNode } from 'react'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import {
  CATEGORIES_LOAD_FAILURE_EXPLANATION,
  CATEGORIES_LOAD_FAILURE_TITLE,
  CREATE_CATEGORY_VALUE,
} from '@/pages/imports/constants'
import { EmptyState, ImportLoadFailure, ImportStep, ImportValueMatchTable } from '@/pages/imports/components'

export type ImportCategoryMatchRow = ComponentProps<typeof ImportValueMatchTable>['rows'][number]

/**
 * The category matching step every importer shows, matching each category the import writes to an
 * existing category or queuing it to be created with a chosen kind
 */
export function ImportCategoryMatchingLayout({
  index,
  description,
  children,
  sourceLabel,
  rows,
  empty,
  options,
  categoriesLoading,
  categoriesFailed,
  refetchCategories,
}: {
  index: string
  description: string

  /** The notices and explanations shown above the categories */
  children?: ReactNode

  /** The heading of the column naming each category as the import found it */
  sourceLabel: string
  rows: ImportCategoryMatchRow[]

  /** What the step says while there are no categories to match */
  empty: { title: string; description: string }
  options: DropdownOption[]
  categoriesLoading: boolean
  categoriesFailed: boolean
  refetchCategories: () => void
}) {
  return (
    <ImportStep index={index} title="Category Matching" description={description}>
      {children}

      {categoriesFailed ? (
        <ImportLoadFailure
          title={CATEGORIES_LOAD_FAILURE_TITLE}
          description={CATEGORIES_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchCategories}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} />
      ) : (
        <ImportValueMatchTable
          sourceLabel={sourceLabel}
          detailLabel="Type"
          targetLabel="Existing Category"
          createValue={CREATE_CATEGORY_VALUE}
          rows={rows}
          options={options}
          disabled={categoriesLoading}
        />
      )}
    </ImportStep>
  )
}
