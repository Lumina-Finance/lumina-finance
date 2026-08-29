import { useId, useMemo, useState } from 'react'
import { PencilLine, X } from 'lucide-react'
import { useCategories } from '@/api/categories'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import Dropdown from '@/components/dropdown/Dropdown'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import {
  buildBulkEditFields,
  canApplyBulkEdit,
  doesChosenCategoryRecordTransferTarget,
  doEveryResultingCategoryRecordTransferTarget,
  getBulkEditBlockers,
  getBulkMoveTargets,
  type BulkEditFields,
  type SelectedTransactionFacts,
  type TransferTargetChoice,
} from '@/pages/transactions/components/bulk-edit/selection'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'
import { useDebouncedReferenceSearch } from '@/pages/transactions/components/transaction-modal/hooks/useDebouncedReferenceSearch'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import { OUTSIDE_ACCOUNT_LABEL, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'

const REFERENCE_SEARCH_DEBOUNCE_MS = 250
const REFERENCE_PAGE_SIZE = 20

interface BulkEditModalProps {
  open: boolean
  onClose: () => void

  /** Runs once the close animation has finished, so the caller can unmount and reset the controls */
  onExitComplete: () => void

  /** The selected transactions, as the rules about what an edit may do to them see them */
  rows: SelectedTransactionFacts[]

  /** Currencies of the selected transactions, which is what limits where they can move to */
  selectedCurrencies: string[]

  accounts: TransactionListAccount[]
  onApply: (payload: BulkEditFields) => void
}

/**
 * Sets one set of details across every selected transaction
 *
 * Every control starts empty, meaning leave that field alone, and only the ones filled in are sent. The
 * server writes the batch whole or not at all, so the refusals it would answer with are counted here and
 * hold the button until they are settled.
 */
export function BulkEditModal({
  open,
  onClose,
  onExitComplete,
  rows,
  selectedCurrencies,
  accounts,
  onApply,
}: BulkEditModalProps) {
  const titleId = useId()
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

  // Undefined while no category is chosen, which is what says each row keeps its own
  const chosenCategoryRecordsTransferTarget = chosenCategory
    ? doesChosenCategoryRecordTransferTarget(chosenCategory)
    : undefined
  const resultingCategoriesRecordTransferTarget =
    doEveryResultingCategoryRecordTransferTarget(chosenCategory, rows)

  const moveTargets = useMemo(
    () => getBulkMoveTargets(accounts, selectedCurrencies),
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
    resultingCategoriesRecordTransferTarget,
  }
  const blockers = getBulkEditBlockers(rows, choice, chosenCategoryRecordsTransferTarget)
  const overCap = rows.length > MAX_BULK_EDIT_TRANSACTIONS
  const canApply = canApplyBulkEdit(rows, choice, blockers)

  const transactionsWord = rows.length === 1 ? 'transaction' : 'transactions'

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      titleId={titleId}
      eyebrow="Bulk edit"
      title={`Edit ${rows.length} ${transactionsWord}`}
      RailIcon={PencilLine}
      railLabel="Bulk edit"
      footer={
        <div
          className="flex shrink-0 items-center justify-end gap-2 px-4 py-4 min-[1050px]:px-8"
          style={{ borderTop: '1px solid var(--app-border)' }}
        >
          <button type="button" className="app-secondary-button h-9 px-3 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="app-primary-button h-9 px-4 text-sm"
            disabled={!canApply}
            onClick={() => onApply(buildBulkEditFields(choice))}
          >
            Apply
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          A control left alone leaves that detail as it is on every selected transaction.
        </p>

        <div className="grid gap-3 min-[750px]:grid-cols-2">
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

          {resultingCategoriesRecordTransferTarget && (
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

        {/* Each of these is a refusal the server answers for the whole batch, so it says what to do
            about it here. Unticking a row is not one of the options, since every row behind this panel
            is out of reach while it is open */}
        {blockers.withoutMerchant.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            {blockers.withoutMerchant.length} selected {blockers.withoutMerchant.length === 1 ? 'transaction has' : 'transactions have'} no
            merchant recorded. Set one here, or close this and untick them.
          </p>
        )}

        {blockers.unansweredFarSide.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            {blockers.unansweredFarSide.length} selected {blockers.unansweredFarSide.length === 1 ? 'transfer does' : 'transfers do'} not
            record where the money went.{' '}
            {resultingCategoriesRecordTransferTarget
              ? 'Answer that here, or close this and untick them.'
              : 'Close this and untick them, since the others in this selection are not transfers.'}
          </p>
        )}

        {blockers.ownAccountFarSide.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            {blockers.ownAccountFarSide.length} selected {blockers.ownAccountFarSide.length === 1 ? 'transaction would' : 'transactions would'} end
            up recording the account it already sits in. Pick a different account, or close this and untick them.
          </p>
        )}

        {selectedCurrencies.length > 1 && (
          <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            The selected transactions are in more than one currency, so they cannot move to another
            account together. Narrow the selection to one currency first.
          </p>
        )}

        {overCap && (
          <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
            One edit covers at most {MAX_BULK_EDIT_TRANSACTIONS} transactions. Deselect some to continue.
          </p>
        )}
      </div>
    </ModalTitledPanel>
  )
}
