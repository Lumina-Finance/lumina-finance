import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useCategories } from '@/api/categories'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import Dropdown from '@/components/dropdown/Dropdown'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import {
  buildBulkEditFields,
  hasBulkEditChoice,
  type BulkEditFields,
  type TransferTargetChoice,
} from '@/pages/transactions/components/bulk-edit/selection'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'
import { useDebouncedReferenceSearch } from '@/pages/transactions/components/transaction-modal/hooks/useDebouncedReferenceSearch'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import {
  BALANCE_ADJUSTMENT_CATEGORY_NAME,
  doesTransferRecordCounterpartyAccount,
  OUTSIDE_ACCOUNT_LABEL,
  OUTSIDE_ACCOUNT_VALUE,
} from '@/utils/transfers'

const REFERENCE_SEARCH_DEBOUNCE_MS = 250
const REFERENCE_PAGE_SIZE = 20

interface BulkEditBarProps {
  selectedIds: string[]

  /** Currencies of the selected transactions, which is what limits where they can move to */
  selectedCurrencies: string[]

  accounts: TransactionListAccount[]
  onApply: (payload: BulkEditFields) => void
  onCancel: () => void
}

/**
 * The controls for a bulk edit, held at the bottom of the list
 *
 * At the bottom rather than in the toolbar, because the toolbar publishes its height to every
 * sticky date heading and a panel added to it would move all of them.
 */
export function BulkEditBar({
  selectedIds,
  selectedCurrencies,
  accounts,
  onApply,
  onCancel,
}: BulkEditBarProps) {
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [clearsNote, setClearsNote] = useState(false)
  const [transferTarget, setTransferTarget] = useState<TransferTargetChoice | null>(null)

  // The chosen merchant and tags are held with the label they were picked under. Closing a dropdown
  // resets its search, which refetches the first page of records, and a record the search had found
  // is not in it, so a label read back off the loaded page would turn into an identifier
  const [merchant, setMerchant] = useState<{ value: string; label: string } | null>(null)
  const [chosenTags, setChosenTags] = useState<{ value: string; label: string }[]>([])
  const merchantId = merchant?.value ?? ''
  const tagIds = chosenTags.map((tag) => tag.value)

  const { data: categories } = useCategories()
  const categoryOptions = useMemo(() => buildCategoryOptions(categories ?? []), [categories])

  const chosenCategory = categories?.find((category) => category.id === categoryId)
  const categoryRecordsTransferTarget = Boolean(
    chosenCategory
    && doesTransferRecordCounterpartyAccount(
      chosenCategory.kind,
      chosenCategory.name === BALANCE_ADJUSTMENT_CATEGORY_NAME,
    ),
  )

  // A move keeps each row's stored exchange rate, and almost no imported row has one, so an account
  // in another currency would refuse the whole batch. Offering only the ones that fit turns that
  // refusal into a choice the user can see is unavailable
  const moveTargets = useMemo(
    () => accounts.filter(
      (account) => !account.is_archived
        && !account.closed_at
        && selectedCurrencies.length === 1
        && account.currency === selectedCurrencies[0],
    ),
    [accounts, selectedCurrencies],
  )
  const accountOptions = moveTargets.map((account) => ({ value: account.id, label: account.name ?? 'Account' }))

  const transferTargetOptions = [
    { value: OUTSIDE_ACCOUNT_VALUE, label: OUTSIDE_ACCOUNT_LABEL },
    ...accounts.map((account) => ({ value: account.id, label: account.name ?? 'Account' })),
  ]
  const transferTargetValue = transferTarget === null
    ? ''
    : transferTarget.scope === 'outside' ? OUTSIDE_ACCOUNT_VALUE : transferTarget.accountId

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

  const choice = {
    categoryId,
    merchantId,
    tagIds,
    accountId,
    date,
    note,
    clearsNote,
    transferTarget,
    categoryRecordsTransferTarget,
  }
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
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        <div className="grid gap-2 min-[750px]:grid-cols-2">
          <Dropdown
            options={categoryOptions}
            value={categoryId}
            onChange={setCategoryId}
            placeholder="Category"
            searchable
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
          />

          <Dropdown
            options={accountOptions}
            value={accountId}
            onChange={setAccountId}
            placeholder="Move to account"
            searchable
            disabled={accountOptions.length === 0}
          />

          <input
            type="date"
            className="app-input app-date-field h-9"
            aria-label="Set the date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />

          <div className="flex items-center gap-2">
            <input
              type="text"
              className="app-input h-9 min-w-0 flex-1"
              aria-label="Set the note"
              placeholder="Note"
              value={note}
              disabled={clearsNote}
              onChange={(event) => setNote(event.target.value)}
            />
            <label className="flex shrink-0 items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={clearsNote}
                onChange={(event) => setClearsNote(event.target.checked)}
              />
              Clear
            </label>
          </div>

          {categoryRecordsTransferTarget && (
            <Dropdown
              options={transferTargetOptions}
              value={transferTargetValue}
              onChange={(value) => setTransferTarget(
                value === OUTSIDE_ACCOUNT_VALUE
                  ? { scope: 'outside' }
                  : { scope: 'tracked', accountId: value },
              )}
              placeholder="Where the money went"
              searchable
            />
          )}
        </div>

        {chosenTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
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

        {selectedCurrencies.length > 1 && (
          <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            The selected transactions are in more than one currency, so they cannot move to another
            account together. Narrow the selection to one currency first.
          </p>
        )}

        {categoryRecordsTransferTarget && transferTarget === null && (
          <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            A transfer records where the money went, so answer that before applying.
          </p>
        )}

        {overCap && (
          <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
            One edit covers at most {MAX_BULK_EDIT_TRANSACTIONS} transactions. Deselect some to continue.
          </p>
        )}

        <div className="flex items-center gap-2">
          <p className="mr-auto text-sm font-medium">{selectedIds.length} selected</p>

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
      </div>
    </div>
  )
}
