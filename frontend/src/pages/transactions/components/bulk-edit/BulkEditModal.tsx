import { useId, useMemo, useState, type ReactNode } from 'react'
import { PencilLine } from 'lucide-react'
import { useCategories } from '@/api/categories'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import { Checkbox } from '@/components/forms/Checkbox'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import DateField from '@/components/date-field/DateField'
import Dropdown from '@/components/dropdown/Dropdown'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import IconTooltip from '@/components/tooltips/IconTooltip'
import TransactionModalPillSelector from '@/pages/transactions/components/transaction-modal/controls/PillSelector'
import BulkEditSummaryPanel from '@/pages/transactions/components/bulk-edit/BulkEditSummary'
import {
  buildBulkEditFields,
  canApplyBulkEdit,
  doesAnyResultingCategoryRecordTransferTarget,
  doesChosenCategoryRecordTransferTarget,
  getBulkEditBlockers,
  getBulkMoveTargets,
  getTransferEndTargets,
  toggleChosenTag,
  type BulkEditChoice,
  type BulkEditFields,
  type ChosenTagOption,
  type SelectedTransactionFacts,
  type TransferEndChoice,
} from '@/pages/transactions/components/bulk-edit/selection'
import { describeBulkEdit, type BulkEditSummaryLabels } from '@/pages/transactions/components/bulk-edit/summary'
import type { BulkDirectionChange } from '@/api/transactions'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'
import { useDebouncedReferenceSearch } from '@/pages/transactions/components/transaction-modal/hooks/useDebouncedReferenceSearch'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import { OUTSIDE_ACCOUNT_LABEL, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'

const REFERENCE_SEARCH_DEBOUNCE_MS = 250
const REFERENCE_PAGE_SIZE = 20

// The cap the single-transaction form puts on the same field, so one edit cannot write a note the
// other screen would refuse
const MAX_NOTE_LENGTH = 500

// Leaving it alone is an option of its own here, unlike on the single-transaction form, where every
// transaction points one way or the other and none of them can abstain
const DIRECTION_OPTIONS = [
  { value: 'unchanged', label: 'Leave as is' },
  { value: 'debit', label: 'Money out' },
  { value: 'credit', label: 'Money in' },
  { value: 'reverse', label: 'Reverse' },
] as const

/** Turns a dropdown's raw string value into the end choice the panel holds */
function parseTransferEndValue(value: string, accounts: TransactionListAccount[]): TransferEndChoice | null {
  if (value === '') return null
  if (value === OUTSIDE_ACCOUNT_VALUE) return { scope: 'outside' }
  const currency = accounts.find((account) => account.id === value)?.currency ?? ''
  return { scope: 'tracked', accountId: value, currency }
}

/** Turns an end choice back into the string a dropdown shows as selected */
function transferEndValue(choice: TransferEndChoice | null): string {
  if (choice === null) return ''
  return choice.scope === 'outside' ? OUTSIDE_ACCOUNT_VALUE : choice.accountId
}

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
  const [transferFrom, setTransferFrom] = useState<TransferEndChoice | null>(null)
  const [transferTo, setTransferTo] = useState<TransferEndChoice | null>(null)
  const [direction, setDirection] = useState<BulkDirectionChange | null>(null)

  // The chosen merchant and tags are held with the label they were picked under. Closing a dropdown
  // resets its search, which refetches the first page of records, and a record the search had found
  // is not in it, so a label read back off the loaded page would turn into an identifier
  const [merchant, setMerchant] = useState<{ value: string; label: string } | null>(null)
  const [chosenTags, setChosenTags] = useState<ChosenTagOption[]>([])
  const merchantId = merchant?.value ?? ''
  const tagIds = chosenTags.map((tag) => tag.value)

  const { data: categories } = useCategories()
  const categoryOptions = useMemo(() => buildCategoryOptions(categories ?? []), [categories])

  const chosenCategory = categories?.find((category) => category.id === categoryId)

  // Undefined while no category is chosen, which is what says each row keeps its own
  const chosenCategoryRecordsTransferTarget = chosenCategory
    ? doesChosenCategoryRecordTransferTarget(chosenCategory)
    : undefined
  const endsAreOffered = doesAnyResultingCategoryRecordTransferTarget(chosenCategory, rows)

  const moveTargets = useMemo(
    () => getBulkMoveTargets(accounts, selectedCurrencies),
    [accounts, selectedCurrencies],
  )
  const accountOptions = moveTargets.map((account) => ({ value: account.id, label: account.name ?? 'Account' }))

  const endTargets = useMemo(() => getTransferEndTargets(accounts), [accounts])
  const endOptions = [
    { value: '', label: 'Leave as is' },
    { value: OUTSIDE_ACCOUNT_VALUE, label: OUTSIDE_ACCOUNT_LABEL },
    ...endTargets.map((account) => ({ value: account.id, label: account.name ?? 'Account' })),
  ]
  // Read alongside endsAreOffered rather than on its own, so an end chosen under a category that
  // no longer offers the controls cannot hold the move field disabled with no way on screen to
  // clear it
  const sendsAnEnd = endsAreOffered && (transferFrom !== null || transferTo !== null)

  /**
   * Applies a From or To dropdown's new value, moving the account picker out of the way once either
   * end holds a real answer
   */
  function changeTransferEnd(setEnd: (choice: TransferEndChoice | null) => void, value: string) {
    const next = parseTransferEndValue(value, accounts)
    setEnd(next)
    if (next !== null) setAccountId('')
  }

  /**
   * Applies the Move to account picker's new value, clearing both ends so the two controls cannot
   * disagree about which account a row moves into
   */
  function changeMoveAccount(value: string) {
    setAccountId(value)
    if (value) {
      setTransferFrom(null)
      setTransferTo(null)
    }
  }

  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? 'Account'

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

  // Chosen tags lead the list, ticked, ahead of the search results, so one can always be unticked
  // whatever the search box holds. Search results already chosen are dropped rather than repeated
  const tagOptions = [
    ...chosenTags,
    ...tags.filter((tag) => !tagIds.includes(tag.id)).map((tag) => ({ value: tag.id, label: tag.name })),
  ]

  // The trigger shows this while any tag is chosen, since the dropdown's own value stays blank so
  // a pick never closes the list. getSelectedDropdownOption only keeps it when its value matches
  // the blank value passed below, which is also why it goes undefined rather than an empty label
  // once every tag is unticked
  const chosenTagsOption = chosenTags.length > 0
    ? { value: '', label: chosenTags.map((tag) => tag.label).join(', ') }
    : undefined

  const choice: BulkEditChoice = {
    categoryId,
    merchantId,
    tagIds,
    accountId,
    date,
    note,
    clearsNote,
    transferFrom,
    transferTo,
    direction,
    endsAreOffered,
  }
  const blockers = getBulkEditBlockers(rows, choice, chosenCategoryRecordsTransferTarget)
  const canApply = canApplyBulkEdit(rows, choice, blockers)

  const transactionsWord = rows.length === 1 ? 'transaction' : 'transactions'

  // Display text the panel resolves ids against, read off the same state the dropdowns already
  // hold rather than looked up again, so the summary can never name an account, category, merchant
  // or tag differently than the control that chose it
  const summaryLabels: BulkEditSummaryLabels = {
    accountLabelById: accountName,
    categoryLabel: chosenCategory?.name ?? '',
    merchantLabel: merchant?.label ?? '',
    tagLabels: chosenTags.map((tag) => tag.label),
  }
  const summary = describeBulkEdit(choice, rows, blockers, summaryLabels, chosenCategoryRecordsTransferTarget)

  const spansMultipleCurrencies = selectedCurrencies.length > 1
  const hasNoAccountForCurrency = selectedCurrencies.length === 1 && accountOptions.length === 0

  // At most one icon beside Move to account, in the order its disabled reasons take priority: a
  // selection spanning currencies refuses every account, then a single currency with nothing open
  // to hold it, then an end already answering where the money moves instead
  let moveAccountIcon: ReactNode = null
  if (spansMultipleCurrencies) {
    moveAccountIcon = (
      <IconTooltip label="Multiple currencies" level="warn" widthClassName="w-72">
        These transactions are in more than one currency, so they cannot move to one account
        together. Narrow the selection to a single currency first.
      </IconTooltip>
    )
  } else if (hasNoAccountForCurrency) {
    moveAccountIcon = (
      <IconTooltip label="No account for this currency" level="warn">
        No open account holds this currency.
      </IconTooltip>
    )
  } else if (sendsAnEnd) {
    moveAccountIcon = (
      <IconTooltip label="Cleared by From or To" level="info">
        Cleared while From or To is set.
      </IconTooltip>
    )
  }

  // From and To disable themselves the moment Move to account holds a value, so both carry the
  // same explanation rather than only the one nearer the control
  const clearedByMoveAccountIcon = accountId ? (
    <IconTooltip label="Cleared by Move to account" level="info">
      Cleared while Move to account is set.
    </IconTooltip>
  ) : null

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
      <div className="space-y-5">
        <CreateModalSectionFrame step="01" title="Type & Direction">
          <div>
            <CreateModalFieldLabelRow label="Which way the money moves" />
            <TransactionModalPillSelector
              value={direction ?? 'unchanged'}
              options={DIRECTION_OPTIONS}
              ariaLabel="Set which way the money moves"
              onChange={(value) => setDirection(value === 'unchanged' ? null : value)}
            />
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="02" title="Source/Destination">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-account" label="Move to account" accessory={moveAccountIcon} />
              <Dropdown
                id="bulk-account"
                options={accountOptions}
                value={accountId}
                onChange={changeMoveAccount}
                placeholder={accountOptions.length === 0 ? 'No account it can move to' : 'Leave as is'}
                searchable
                disabled={accountOptions.length === 0 || sendsAnEnd}
              />
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-merchant" label="Merchant" />
              <Dropdown
                id="bulk-merchant"
                options={merchantOptions}
                value={merchantId}
                selectedOption={merchant ?? undefined}
                onChange={(value) => setMerchant(
                  merchantOptions.find((option) => option.value === value) ?? null,
                )}
                placeholder="Leave as is"
                searchable
                filterOptions={false}
                searchValue={merchantSearch.search}
                onSearchChange={merchantSearch.setSearch}
                isLoading={merchantQuery.isFetching}
                hasMore={merchantQuery.hasNextPage}
                onLoadMore={merchantQuery.fetchNextPage}
              />
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-category" label="Category" />
              <Dropdown
                id="bulk-category"
                options={categoryOptions}
                value={categoryId}
                onChange={setCategoryId}
                placeholder="Leave as is"
                searchable
              />
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-tags" label="Add a tag" />
              <Dropdown
                id="bulk-tags"
                options={tagOptions}
                value=""
                selectedOption={chosenTagsOption}
                selectedValues={tagIds}
                closeOnSelect={false}
                onChange={(value) => {
                  const picked = tagOptions.find((option) => option.value === value)
                  if (picked) setChosenTags((current) => toggleChosenTag(current, picked))
                }}
                placeholder="Leave as is"
                searchable
                filterOptions={false}
                searchValue={tagSearch.search}
                onSearchChange={tagSearch.setSearch}
                isLoading={tagQuery.isFetching}
                hasMore={tagQuery.hasNextPage}
                onLoadMore={tagQuery.fetchNextPage}
              />
            </div>

            {endsAreOffered && (
              <>
                <div>
                  <CreateModalFieldLabelRow htmlFor="bulk-transfer-from" label="From" accessory={clearedByMoveAccountIcon} />
                  <Dropdown
                    id="bulk-transfer-from"
                    options={endOptions}
                    value={transferEndValue(transferFrom)}
                    onChange={(value) => changeTransferEnd(setTransferFrom, value)}
                    placeholder="Leave as is"
                    blankOptionIsPlaceholder
                    searchable
                    disabled={Boolean(accountId)}
                  />
                </div>

                <div>
                  <CreateModalFieldLabelRow htmlFor="bulk-transfer-to" label="To" accessory={clearedByMoveAccountIcon} />
                  <Dropdown
                    id="bulk-transfer-to"
                    options={endOptions}
                    value={transferEndValue(transferTo)}
                    onChange={(value) => changeTransferEnd(setTransferTo, value)}
                    placeholder="Leave as is"
                    blankOptionIsPlaceholder
                    searchable
                    disabled={Boolean(accountId)}
                  />
                </div>
              </>
            )}
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="03" title="Details">
          <div className="sm:max-w-[11rem]">
            <CreateModalFieldLabelRow htmlFor="bulk-date" label="Date" />
            <DateField
              id="bulk-date"
              ariaLabel="Date"
              value={date}
              onChange={setDate}
            />
          </div>

          <div>
            <CreateModalFieldLabelRow
              htmlFor="bulk-note"
              label="Note"
              action={(
                <div className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={clearsNote}
                    label="Take the note off instead"
                    onChange={() => setClearsNote((current) => !current)}
                  />
                  <span aria-hidden onClick={() => setClearsNote((current) => !current)}>
                    Take the note off instead
                  </span>
                </div>
              )}
            />
            <input
              id="bulk-note"
              type="text"
              className="app-input disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={clearsNote ? 'The note comes off' : 'Leave as is'}
              value={note}
              disabled={clearsNote}
              onChange={(event) => setNote(event.target.value)}
              maxLength={MAX_NOTE_LENGTH}
            />
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="04" title="What changes">
          <BulkEditSummaryPanel summary={summary} />
        </CreateModalSectionFrame>
      </div>
    </ModalTitledPanel>
  )
}
