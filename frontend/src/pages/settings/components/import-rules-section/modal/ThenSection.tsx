import { useMemo } from 'react'
import { useCategories } from '@/api/categories'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import Dropdown from '@/components/dropdown/Dropdown'
import { buildCategoryOptions } from '@/components/transactions/transaction-modal/utils/categories'
import { useDebouncedReferenceSearch } from '@/components/transactions/transaction-modal/hooks/useDebouncedReferenceSearch'
import { toggleChosenTag, type ChosenTagOption } from '@/components/transactions/bulk-edit/selection'
import {
  REFERENCE_PAGE_SIZE,
  REFERENCE_SEARCH_DEBOUNCE_MS,
  RULE_MODAL_IDS,
} from '@/pages/settings/components/import-rules-section/constants'
import type { PickedReference } from '@/pages/settings/components/import-rules-section/types'
import { formatValueList } from '@/utils/formatList'
import { getFieldLabelId } from '@/utils/fieldLabel'

type ThenSectionProps = {
  merchant: PickedReference | null
  categoryId: string
  tags: ChosenTagOption[]

  /** Marks all three while the rule sets none of them */
  hasError: boolean
  errorId: string | undefined
  onMerchant: (merchant: PickedReference | null) => void
  onCategory: (categoryId: string) => void
  onTags: (tags: ChosenTagOption[]) => void
  onTouch: () => void
}

/**
 * The three things a rule sets: a merchant, a category and tags, each picked with the app's own pickers
 *
 * Merchants and tags are searched on the server a page at a time, and the chosen merchant and tags are
 * held with the names they were picked under, since closing a picker resets its search and the page that
 * held a found record is gone. A rule never sets a transfer category, balance adjustment included, since it
 * says nothing about the account on the other side of a transfer. Records a group owns are left out, since
 * a rule belongs to one user. Picking a merchant with a default category picks that category too
 */
export function ThenSection({
  merchant,
  categoryId,
  tags,
  hasError,
  errorId,
  onMerchant,
  onCategory,
  onTags,
  onTouch,
}: ThenSectionProps) {
  const merchantSearch = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)
  const merchantQuery = useInfiniteMerchants({ q: merchantSearch.activeSearchText || undefined }, REFERENCE_PAGE_SIZE)
  const ownMerchants = useMemo(
    () => (merchantQuery.data?.pages.flat() ?? []).filter((record) => record.group_id === null),
    [merchantQuery.data],
  )
  const merchantOptions = useMemo(
    () => [{ value: '', label: 'No merchant' }, ...ownMerchants.map((record) => ({ value: record.id, label: record.name }))],
    [ownMerchants],
  )

  const { data: categories } = useCategories()
  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'No category' },
      ...buildCategoryOptions(
        (categories ?? []).filter((category) => category.kind !== 'transfer' && category.group_id === null),
      ),
    ],
    [categories],
  )

  const tagSearch = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)
  const tagQuery = useInfiniteTags({ q: tagSearch.activeSearchText || undefined }, REFERENCE_PAGE_SIZE)
  const tagIds = tags.map((tag) => tag.value)
  // The chosen tags come first so they can be unticked whatever the search text holds
  const tagOptions = [
    ...tags,
    ...(tagQuery.data?.pages.flat() ?? [])
      .filter((tag) => tag.group_id === null && !tagIds.includes(tag.id))
      .map((tag) => ({ value: tag.id, label: tag.name })),
  ]

  return (
    <div className="grid gap-3 min-[750px]:grid-cols-3">
      <div className="min-w-0">
        <CreateModalFieldLabelRow htmlFor={RULE_MODAL_IDS.merchant} label="Set merchant" />
        <Dropdown
          id={RULE_MODAL_IDS.merchant}
          options={merchantOptions}
          value={merchant?.value ?? ''}
          selectedOption={merchant ?? undefined}
          onChange={(value) => {
            onMerchant(value === '' ? null : (merchantOptions.find((option) => option.value === value) ?? null))
            // A merchant's default category comes with it, as it does in the transaction dialogue, unless the
            // rule can't set that category, such as a transfer one
            const defaultCategoryId = ownMerchants.find((record) => record.id === value)?.default_category_id
            if (defaultCategoryId && categoryOptions.some((option) => option.value === defaultCategoryId)) {
              onCategory(defaultCategoryId)
            }
            onTouch()
          }}
          hasError={hasError}
          describedBy={errorId}
          labelledBy={getFieldLabelId(RULE_MODAL_IDS.merchant)}
          placeholder="No merchant"
          matchFieldWidth
          blankOptionIsPlaceholder
          searchable
          filterOptions={false}
          searchValue={merchantSearch.search}
          onSearchChange={merchantSearch.setSearch}
          isLoading={merchantQuery.isFetching}
          hasMore={merchantQuery.hasNextPage}
          onLoadMore={merchantQuery.fetchNextPage}
        />
      </div>

      <div className="min-w-0">
        <CreateModalFieldLabelRow htmlFor={RULE_MODAL_IDS.category} label="Set category" />
        <Dropdown
          id={RULE_MODAL_IDS.category}
          options={categoryOptions}
          value={categoryId}
          onChange={(value) => {
            onCategory(value)
            onTouch()
          }}
          hasError={hasError}
          describedBy={errorId}
          labelledBy={getFieldLabelId(RULE_MODAL_IDS.category)}
          placeholder="No category"
          matchFieldWidth
          blankOptionIsPlaceholder
          searchable
        />
      </div>

      <div className="min-w-0">
        <CreateModalFieldLabelRow htmlFor={RULE_MODAL_IDS.tags} label="Add tags" />
        <Dropdown
          id={RULE_MODAL_IDS.tags}
          options={tagOptions}
          value=""
          selectedOption={
            tags.length > 0 ? { value: '', label: formatValueList(tags.map((tag) => tag.label)) } : undefined
          }
          selectedValues={tagIds}
          closeOnSelect={false}
          onChange={(value) => {
            const picked = tagOptions.find((option) => option.value === value)
            if (picked) onTags(toggleChosenTag(tags, picked))
            onTouch()
          }}
          hasError={hasError}
          describedBy={errorId}
          labelledBy={getFieldLabelId(RULE_MODAL_IDS.tags)}
          placeholder="No tags"
          matchFieldWidth
          searchable
          filterOptions={false}
          searchValue={tagSearch.search}
          onSearchChange={tagSearch.setSearch}
          isLoading={tagQuery.isFetching}
          hasMore={tagQuery.hasNextPage}
          onLoadMore={tagQuery.fetchNextPage}
        />
      </div>
    </div>
  )
}
