import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useCategories } from '@/api/categories'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import type { BulkUpdateTransactionsPayload } from '@/api/transactions'
import Dropdown from '@/components/dropdown/Dropdown'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import {
  buildBulkEditFields,
  hasBulkEditChoice,
} from '@/pages/transactions/components/bulk-edit/selection'
import { useDebouncedReferenceSearch } from '@/pages/transactions/components/transaction-modal/hooks/useDebouncedReferenceSearch'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import {
  BALANCE_ADJUSTMENT_CATEGORY_NAME,
  doesTransferRecordCounterpartyAccount,
} from '@/utils/transfers'

const REFERENCE_SEARCH_DEBOUNCE_MS = 250
const REFERENCE_PAGE_SIZE = 20

interface BulkEditBarProps {
  selectedIds: string[]
  onApply: (payload: Omit<BulkUpdateTransactionsPayload, 'transaction_ids'>) => void
  onCancel: () => void
}

/**
 * The controls for a bulk edit, held at the bottom of the list
 *
 * At the bottom rather than in the toolbar, because the toolbar publishes its height to every
 * sticky date heading and a bar added to it would move all of them.
 */
export function BulkEditBar({ selectedIds, onApply, onCancel }: BulkEditBarProps) {
  const [categoryId, setCategoryId] = useState('')

  // The chosen merchant and tags are held with the label they were picked under. Closing a dropdown
  // resets its search, which refetches the first page of records, and a record the search had found
  // is not in it, so a label read back off the loaded page would turn into an identifier
  const [merchant, setMerchant] = useState<{ value: string; label: string } | null>(null)
  const [chosenTags, setChosenTags] = useState<{ value: string; label: string }[]>([])
  const merchantId = merchant?.value ?? ''
  const tagIds = chosenTags.map((tag) => tag.value)

  const { data: categories } = useCategories()

  // A category recording a counterparty account is left out. This request carries no field for one,
  // and a row that does not already record one is refused, so offering the choice would mostly
  // produce a refused batch. Balance Adjustment stays, being the one transfer category that records
  // no counterparty and so applies to any row
  const categoryOptions = useMemo(
    () => buildCategoryOptions(
      (categories ?? []).filter(
        (category) => !doesTransferRecordCounterpartyAccount(
          category.kind,
          category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME,
        ),
      ),
    ),
    [categories],
  )

  const merchantSearch = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)
  const merchantQuery = useInfiniteMerchants(
    { q: merchantSearch.activeSearchText || undefined },
    REFERENCE_PAGE_SIZE,
  )
  const merchants = merchantQuery.data?.pages.flat() ?? []
  const merchantOptions = merchants.map((record) => ({ value: record.id, label: record.name }))

  const tagSearch = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)
  const tagQuery = useInfiniteTags({ q: tagSearch.activeSearchText || undefined }, REFERENCE_PAGE_SIZE)
  const tags = tagQuery.data?.pages.flat() ?? []
  const tagOptions = tags
    .filter((tag) => !tagIds.includes(tag.id))
    .map((tag) => ({ value: tag.id, label: tag.name }))

  const choice = { categoryId, merchantId, tagIds }
  const overCap = selectedIds.length > MAX_BULK_EDIT_TRANSACTIONS
  const setsSomething = hasBulkEditChoice(choice)

  return (
    <div
      // Sticky rather than fixed, so it takes the width of the page content instead of the whole
      // viewport, keeps clear of the sidebar, and lands after the last row rather than covering it
      className="sticky bottom-0 z-30 border-t px-3 py-3"
      style={{ background: 'var(--app-surface-soft)', borderColor: 'var(--app-border)' }}
      role="region"
      aria-label="Edit the selected transactions"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <p className="text-sm font-medium">
          {selectedIds.length} selected
        </p>

        <Dropdown
          options={categoryOptions}
          value={categoryId}
          onChange={setCategoryId}
          placeholder="Category"
          searchable
          className="min-w-40 flex-1"
        />

        <Dropdown
          options={merchantOptions}
          value={merchantId}
          selectedOption={merchant ?? undefined}
          onChange={(value) => setMerchant(
            merchantOptions.find((option) => option.value === value) ?? null,
          )}
          placeholder="Merchant"
          searchable
          filterOptions={false}
          searchValue={merchantSearch.search}
          onSearchChange={merchantSearch.setSearch}
          isLoading={merchantQuery.isFetching}
          hasMore={merchantQuery.hasNextPage}
          onLoadMore={merchantQuery.fetchNextPage}
          className="min-w-40 flex-1"
        />

        <Dropdown
          options={tagOptions}
          value=""
          onChange={(value) => {
            const picked = tagOptions.find((option) => option.value === value)
            if (picked) setChosenTags((current) => [...current, picked])
          }}
          placeholder="Add a tag"
          searchable
          filterOptions={false}
          searchValue={tagSearch.search}
          onSearchChange={tagSearch.setSearch}
          isLoading={tagQuery.isFetching}
          hasMore={tagQuery.hasNextPage}
          onLoadMore={tagQuery.fetchNextPage}
          className="min-w-40 flex-1"
        />

        <button
          type="button"
          className="app-primary-button h-9 px-4 text-sm"
          disabled={!setsSomething || overCap}
          onClick={() => onApply(buildBulkEditFields(choice))}
        >
          Apply
        </button>

        <button type="button" className="app-secondary-button h-9 px-3 text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {chosenTags.length > 0 && (
        <div className="mx-auto mt-2 flex max-w-6xl flex-wrap gap-1">
          {chosenTags.map((tag) => (
            <span
              key={tag.value}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{ background: 'var(--app-accent-soft)' }}
            >
              {tag.label}
              <button
                type="button"
                aria-label={`Remove ${tag.label}`}
                onClick={() => setChosenTags((current) => current.filter((item) => item.value !== tag.value))}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {overCap && (
        <p className="mx-auto mt-2 max-w-6xl text-xs" style={{ color: 'var(--app-negative)' }}>
          One edit covers at most {MAX_BULK_EDIT_TRANSACTIONS} transactions. Deselect some to continue.
        </p>
      )}
    </div>
  )
}
