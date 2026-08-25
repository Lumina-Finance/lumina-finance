import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useCategories } from '@/api/categories'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import type { BulkUpdateTransactionsPayload } from '@/api/transactions'
import Dropdown from '@/components/dropdown/Dropdown'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import { useDebouncedReferenceSearch } from '@/pages/transactions/components/transaction-modal/hooks/useDebouncedReferenceSearch'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'

const REFERENCE_SEARCH_DEBOUNCE_MS = 250
const REFERENCE_PAGE_SIZE = 20

interface BulkEditBarProps {
  selectedIds: string[]
  onApply: (payload: Omit<BulkUpdateTransactionsPayload, 'transaction_ids'>) => void
  onCancel: () => void
}

/**
 * The controls for a bulk edit, docked to the bottom of the viewport
 *
 * Docked there rather than in the toolbar, because the toolbar publishes its height to every sticky
 * date heading and a bar added to it would move all of them.
 */
export function BulkEditBar({ selectedIds, onApply, onCancel }: BulkEditBarProps) {
  const [categoryId, setCategoryId] = useState('')
  const [merchantId, setMerchantId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])

  const { data: categories } = useCategories()
  const categoryOptions = useMemo(() => buildCategoryOptions(categories ?? []), [categories])

  const merchantSearch = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)
  const merchantQuery = useInfiniteMerchants(
    { q: merchantSearch.activeSearchText || undefined },
    REFERENCE_PAGE_SIZE,
  )
  const merchants = merchantQuery.data?.pages.flat() ?? []
  const merchantOptions = merchants.map((merchant) => ({ value: merchant.id, label: merchant.name }))

  const tagSearch = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)
  const tagQuery = useInfiniteTags({ q: tagSearch.activeSearchText || undefined }, REFERENCE_PAGE_SIZE)
  const tags = tagQuery.data?.pages.flat() ?? []
  const tagOptions = tags
    .filter((tag) => !tagIds.includes(tag.id))
    .map((tag) => ({ value: tag.id, label: tag.name }))
  const tagNamesById = new Map(tags.map((tag) => [tag.id, tag.name]))

  const overCap = selectedIds.length > MAX_BULK_EDIT_TRANSACTIONS
  const setsSomething = Boolean(categoryId) || Boolean(merchantId) || tagIds.length > 0

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t px-3 py-3"
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
          onChange={setMerchantId}
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
          onChange={(value) => setTagIds((current) => [...current, value])}
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
          onClick={() =>
            onApply({
              ...(categoryId ? { category_id: categoryId } : {}),
              ...(merchantId ? { merchant_id: merchantId } : {}),
              ...(tagIds.length ? { add_tag_ids: tagIds } : {}),
            })
          }
        >
          Apply
        </button>

        <button type="button" className="app-secondary-button h-9 px-3 text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {tagIds.length > 0 && (
        <div className="mx-auto mt-2 flex max-w-6xl flex-wrap gap-1">
          {tagIds.map((tagId) => (
            <span
              key={tagId}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{ background: 'var(--app-accent-soft)' }}
            >
              {tagNamesById.get(tagId) ?? tagId}
              <button
                type="button"
                aria-label={`Remove ${tagNamesById.get(tagId) ?? tagId}`}
                onClick={() => setTagIds((current) => current.filter((id) => id !== tagId))}
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
