import { useId, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PencilLine } from 'lucide-react'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import { useCategories } from '@/api/categories'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import { Checkbox } from '@/components/forms/Checkbox'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import CreateModalSectionHeadingRow from '@/components/create-modal/SectionHeadingRow'
import DateField from '@/components/date-field/DateField'
import Dropdown from '@/components/dropdown/Dropdown'
import { InfoCallout } from '@/components/InfoCallout'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { DIRECTION_OPTIONS, EASE } from '@/components/transactions/transaction-modal/constants'
import TransactionModalPillSelector from '@/components/transactions/transaction-modal/controls/PillSelector'
import BulkEditSummaryPanel from '@/components/transactions/bulk-edit/BulkEditSummary'
import {
  buildBulkEditFields,
  doesAnyResultingCategoryRecordTransferTarget,
  doesChosenCategoryRecordTransferTarget,
  endsAfterDirectionClick,
  endsAfterEndPick,
  getBulkEditBlockers,
  getBulkEditChangeProblem,
  getBulkEditSelectionBlockReason,
  getBulkMoveTargets,
  getTransferEndTargets,
  impliedDirection,
  isMixedSelection,
  nextDirectionAfterEndChange,
  rowFactsKey,
  toggleChosenTag,
  type BulkDirectionChoice,
  type BulkEditChoice,
  type BulkEditFields,
  type ChosenTagOption,
  type SelectedTransactionFacts,
  type TransferEndChoice,
} from '@/components/transactions/bulk-edit/selection'
import { describeBulkEdit, type BulkEditSummaryLabels } from '@/components/transactions/bulk-edit/summary'
import type { BulkDirectionChange } from '@/api/transactions'
import type { TransactionListAccount } from '@/components/transactions/types/transactionList'
import { useDebouncedReferenceSearch } from '@/components/transactions/transaction-modal/hooks/useDebouncedReferenceSearch'
import { buildCategoryOptions } from '@/components/transactions/transaction-modal/utils/categories'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { OUTSIDE_ACCOUNT_LABEL, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { formatValueList } from '@/utils/formatList'

// This option clears assignments rather than identifying a stored tag
const REMOVE_ALL_TAGS_VALUE = 'remove-all-tags'
const REMOVE_ALL_TAGS_LABEL = 'Remove all tags'

// What the edit changes is the one place Apply can be refused, since every control starts as leave as is
const BULK_EDIT_FIELDS = ['changes'] as const
const BULK_EDIT_FIELD_IDS = { changes: 'bulk-changes' } as const
const CHANGES_ERROR_ID = 'bulk-changes-error'

const REFERENCE_SEARCH_DEBOUNCE_MS = 250
const REFERENCE_PAGE_SIZE = 20

// The cap the single-transaction form puts on the same field, so one edit cannot write a note the
// other screen would refuse
const MAX_NOTE_LENGTH = 500

// Leaving it alone is an option of its own here, unlike on the single-transaction form, where every
// transaction points one way or the other and none of them can abstain. Debit and Credit come from
// the single-transaction form's own list, so the two pill sets cannot end up naming the same values
// differently
const BULK_DIRECTION_OPTIONS: { value: BulkDirectionChange | 'unchanged'; label: string }[] = [
  { value: 'unchanged', label: 'Leave as is' },
  ...DIRECTION_OPTIONS,
  { value: 'reverse', label: 'Reverse' },
]

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

  // Nothing set reads as implied, so the first end change to imply a direction lands the same way a
  // later one clearing it does, rather than the initial state needing its own case
  const [direction, setDirection] = useState<BulkDirectionChoice>({ value: null, source: 'implied' })

  // Bumped whenever the rule, rather than a pill the user clicked, changes what the pills show, so
  // the pulse below only draws the eye to a change the user did not make themselves
  const [directionHighlightKey, setDirectionHighlightKey] = useState(0)

  // The chosen merchant and tags are held with the label they were picked under. Closing a dropdown
  // resets its search, which refetches the first page of records, and a record the search had found
  // is not in it, so a label read back off the loaded page would turn into an identifier
  const [merchant, setMerchant] = useState<{ value: string; label: string } | null>(null)
  const [chosenTags, setChosenTags] = useState<ChosenTagOption[]>([])
  const [overrideTags, setOverrideTags] = useState(false)
  const merchantId = merchant?.value ?? ''
  const tagIds = chosenTags.map((tag) => tag.value)

  const { data: categories } = useCategories()
  const categoryOptions = useMemo(() => buildCategoryOptions(categories ?? []), [categories])

  // Leading blank entry lets a pick be undone without closing the modal, ahead of every kind group
  const categoryDropdownOptions = useMemo(
    () => [{ value: '', label: 'Leave as is' }, ...categoryOptions],
    [categoryOptions],
  )

  const chosenCategory = categories?.find((category) => category.id === categoryId)

  // Undefined while no category is chosen, which is what says each row keeps its own
  const chosenCategoryRecordsTransferTarget = chosenCategory
    ? doesChosenCategoryRecordTransferTarget(chosenCategory)
    : undefined
  const endsAreOffered = doesAnyResultingCategoryRecordTransferTarget(chosenCategory, rows)

  // Adjusted during render rather than in an effect, following React's own guidance for state that
  // has to change in response to a prop, since a setState call in an effect body would cost this
  // component an extra commit for every category change. A category change can turn a row into a
  // transfer row or out of one, which is what decides each row's own side, so an outside end already
  // on screen is re-checked against the new pairing the moment the category settles rather than
  // waiting for the user to touch a pill or an end again. Keyed on rowFactsKey rather than on rows
  // itself, since rows is a useMemo in ListSection.tsx over the displayed transactions and any
  // refetch, an unrelated window focus included, rebuilds it with a new reference even when every
  // fact the rules below read is unchanged. Keying on the reference would rerun this correction on
  // that refetch and let an implied direction overwrite a direction the user had chosen
  const [lastCheckedCategoryRule, setLastCheckedCategoryRule] = useState(chosenCategoryRecordsTransferTarget)
  const rowsKey = useMemo(() => rowFactsKey(rows), [rows])
  const [lastCheckedRowsKey, setLastCheckedRowsKey] = useState(rowsKey)
  if (chosenCategoryRecordsTransferTarget !== lastCheckedCategoryRule || rowsKey !== lastCheckedRowsKey) {
    setLastCheckedCategoryRule(chosenCategoryRecordsTransferTarget)
    setLastCheckedRowsKey(rowsKey)

    const { from: correctedFrom, to: correctedTo } = endsAfterDirectionClick(
      direction.value, transferFrom, transferTo, rows, chosenCategoryRecordsTransferTarget,
    )
    const impliedByCorrectedEnds = impliedDirection(rows, correctedFrom, correctedTo, chosenCategoryRecordsTransferTarget)
    const nextDirection = nextDirectionAfterEndChange(direction, impliedByCorrectedEnds)
    if (nextDirection.value !== direction.value) setDirectionHighlightKey((key) => key + 1)

    if (correctedFrom !== transferFrom) setTransferFrom(correctedFrom)
    if (correctedTo !== transferTo) setTransferTo(correctedTo)
    setDirection(nextDirection)
  }

  const moveTargets = useMemo(
    () => getBulkMoveTargets(accounts, selectedCurrencies),
    [accounts, selectedCurrencies],
  )
  const accountOptions = moveTargets.map((account) => ({ value: account.id, label: account.name ?? 'Account' }))

  // Leading blank entry lets a pick be undone without closing the modal, matching From and To, but
  // only when there is an account to move to. Adding it unconditionally would give an empty
  // accountOptions a blank entry that matches the trigger's empty value, hiding the placeholder
  // computed below for a currency no unarchived account the user can write to holds
  const moveAccountOptions = accountOptions.length > 0
    ? [{ value: '', label: 'Leave as is' }, ...accountOptions]
    : []

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
   * Applies what the changed pairing of ends implies to the direction pills, pulsing them when the
   * rule actually moves what they show
   */
  function applyDirectionChange(implied: BulkDirectionChange | null) {
    const next = nextDirectionAfterEndChange(direction, implied)
    if (next.value !== direction.value) setDirectionHighlightKey((key) => key + 1)
    setDirection(next)
  }

  /**
   * Applies a From or To dropdown's new value, moving the account picker out of the way once either
   * end holds a real answer, then updates the direction pills against the new pairing. The
   * implication reads the end just changed and the other end's current value rather than state that
   * has not updated yet. Routed through endsAfterEndPick first, so picking outside on the end still
   * left as it is drops that one back to Leave as is rather than leaving both sides untracked
   */
  function changeTransferEnd(end: 'from' | 'to', value: string) {
    const picked = parseTransferEndValue(value, accounts)
    const pickedFrom = end === 'from' ? picked : transferFrom
    const pickedTo = end === 'to' ? picked : transferTo
    const { from: nextFrom, to: nextTo } = endsAfterEndPick(pickedFrom, pickedTo, end)

    setTransferFrom(nextFrom)
    setTransferTo(nextTo)
    if (picked !== null) setAccountId('')

    applyDirectionChange(impliedDirection(rows, nextFrom, nextTo, chosenCategoryRecordsTransferTarget))
  }

  /**
   * Applies a direction pill's new value, first reverting whichever end the new direction would put
   * outside the tracked accounts on some transfer row's own side, since a pick made from a stale
   * pairing of ends could otherwise leave one of them with nowhere real to sit.
   *
   * A click on the value the pills already show is a no-op, read off effectiveDirection rather than
   * off the held direction, since an implied direction whose controls have gone displays Leave as
   * is and a click there has nothing to widen. Without the guard, clicking a lit pill again would
   * turn an implied direction, which only reaches the transfer rows, into one the user chose, which
   * reaches every selected row, with nothing on screen to show the change
   */
  function changeDirection(value: BulkDirectionChange | 'unchanged') {
    if (value === (effectiveDirection ?? 'unchanged')) return

    const nextValue = value === 'unchanged' ? null : value
    const { from: nextFrom, to: nextTo } = endsAfterDirectionClick(
      nextValue, transferFrom, transferTo, rows, chosenCategoryRecordsTransferTarget,
    )
    setTransferFrom(nextFrom)
    setTransferTo(nextTo)
    setDirection({ value: nextValue, source: 'user' })
  }

  /**
   * Applies the Move to account picker's new value, clearing both ends so the two controls cannot
   * disagree about which account a row moves into, and running the clear through the same direction
   * rule as an end change, with nothing implied
   */
  function changeMoveAccount(value: string) {
    setAccountId(value)
    if (value) {
      setTransferFrom(null)
      setTransferTo(null)
      applyDirectionChange(null)
    }
  }

  /**
   * Flips whether the note comes off, clearing any typed text along with it so the disabled input
   * cannot keep showing text the edit no longer sends
   */
  function toggleClearsNote() {
    const next = !clearsNote
    setClearsNote(next)
    if (next) setNote('')
  }

  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? 'Account'

  const merchantSearch = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)
  const merchantQuery = useInfiniteMerchants(
    { q: merchantSearch.activeSearchText || undefined },
    REFERENCE_PAGE_SIZE,
  )
  const merchants = merchantQuery.data?.pages.flat() ?? []
  const merchantOptions = merchants.map((record) => ({ value: record.id, label: record.name }))

  // Leading blank entry lets a pick be undone without closing the modal, ahead of the search
  // results whatever the search text holds
  const merchantDropdownOptions = [{ value: '', label: 'Leave as is' }, ...merchantOptions]

  const tagSearch = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)
  const tagQuery = useInfiniteTags({ q: tagSearch.activeSearchText || undefined }, REFERENCE_PAGE_SIZE)
  const tags = tagQuery.data?.pages.flat() ?? []

  // Keep chosen tags before search results so they can be unticked regardless of the search text
  // Remove all tags remains available even when the search returns no tags
  const tagOptions = [
    { value: REMOVE_ALL_TAGS_VALUE, label: REMOVE_ALL_TAGS_LABEL },
    ...chosenTags,
    ...tags.filter((tag) => !tagIds.includes(tag.id)).map((tag) => ({ value: tag.id, label: tag.name })),
  ]

  // The trigger uses the blank value required by the multi-select dropdown
  // An empty selection with Override enabled represents an intentional clear
  const chosenTagsOption = chosenTags.length > 0
    ? { value: '', label: formatValueList(chosenTags.map((tag) => tag.label)) }
    : overrideTags ? { value: '', label: REMOVE_ALL_TAGS_LABEL } : undefined

  // An implied direction is tied to the pairing of ends that produced it, so it drops out once
  // endsAreOffered goes false, as when a category change turns the controls off, rather than
  // outliving the controls it came from. A direction the user picked has no such tie and stays
  const effectiveDirection: BulkDirectionChange | null = direction.source === 'implied' && !endsAreOffered
    ? null
    : direction.value

  const choice: BulkEditChoice = {
    categoryId,
    merchantId,
    tagIds,
    overrideTags,
    accountId,
    date,
    note,
    clearsNote,
    transferFrom,
    transferTo,
    direction: effectiveDirection,
    directionIsImplied: direction.source === 'implied',
    endsAreOffered,
  }
  const blockers = getBulkEditBlockers(rows, choice, chosenCategoryRecordsTransferTarget, accounts)
  // Nothing chosen and the warnings are problems of the edit, marked on the What changes heading once Apply
  // is pressed. A missing or oversized selection is a state of the page, so it keeps Apply faded throughout
  const selectionBlockReason = getBulkEditSelectionBlockReason(rows)
  const refusal = useRefusedSubmit(
    { changes: getBulkEditChangeProblem(choice, blockers) },
    BULK_EDIT_FIELDS,
    BULK_EDIT_FIELD_IDS,
  )

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

  // At most one reason for Move to account, in the order its disabled reasons take priority: a
  // selection spanning currencies refuses every account, then a single currency no unarchived
  // account the user can write to holds, then an end already answering where the money moves
  // instead
  let moveAccountReason: string | undefined
  if (spansMultipleCurrencies) {
    moveAccountReason = 'The selected transactions span more than one currency, so they cannot move to one account together'
  } else if (hasNoAccountForCurrency) {
    moveAccountReason = 'No unarchived account holds this currency'
  } else if (sendsAnEnd) {
    moveAccountReason = 'Cleared while From or To is set'
  }

  // From and To disable themselves the moment Move to account holds a value, so both carry the
  // same explanation rather than only the one nearer the control
  const clearedByMoveAccountReason = accountId ? 'Cleared while Move to account is set' : undefined

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
          className={`flex shrink-0 items-center justify-end gap-2 py-4 ${MODAL_INSET_CLASS_NAME.page}`}
          style={{ borderTop: '1px solid var(--app-border)' }}
        >
          <button type="button" className="app-secondary-button h-9 px-3 text-sm" onClick={onClose}>
            Cancel
          </button>
          <DisabledReasonButton
            className="app-primary-button h-9 px-4 text-sm"
            disabledReason={selectionBlockReason ?? refusal.blockedReason}
            onClick={() => {
              if (!refusal.guard()) return
              onApply(buildBulkEditFields(choice))
            }}
          >
            Apply
          </DisabledReasonButton>
        </div>
      }
    >
      <div className="space-y-5">
        {isMixedSelection(rows) && (
          <InfoCallout>
            You selected both transfers and other transactions. We recommend editing them separately
            to avoid unintended changes to either kind.
          </InfoCallout>
        )}

        <CreateModalSectionFrame step="01" title="Account & Direction">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <CreateModalFieldLabelRow htmlFor="bulk-account" label="Move to account" />
              <Dropdown
                id="bulk-account"
                options={moveAccountOptions}
                value={accountId}
                onChange={changeMoveAccount}
                placeholder={accountOptions.length === 0 ? 'No account to move to' : 'Leave as is'}
                blankOptionIsPlaceholder
                searchable
                disabled={accountOptions.length === 0 || sendsAnEnd}
                disabledReason={moveAccountReason}
              />
            </div>

            <div className="sm:col-span-2">
              <CreateModalFieldLabelRow label="Direction" optionGroupId="bulk-direction" />
              <div className="relative rounded-lg">
                <AnimatePresence initial={false}>
                  {directionHighlightKey > 0 && (
                    <motion.span
                      key={directionHighlightKey}
                      className="pointer-events-none absolute inset-0 rounded-lg"
                      initial={{ boxShadow: '0 0 0 0 var(--app-accent-soft)' }}
                      animate={{ boxShadow: ['0 0 0 0 var(--app-accent-soft)', '0 0 0 3px var(--app-accent-soft)', '0 0 0 0 var(--app-accent-soft)'] }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.45, ease: EASE }}
                      aria-hidden
                    />
                  )}
                </AnimatePresence>
                <TransactionModalPillSelector
                  id="bulk-direction"
                  value={effectiveDirection ?? 'unchanged'}
                  options={BULK_DIRECTION_OPTIONS}
                  ariaLabel="Transaction direction"
                  compactOnMobile
                  onChange={changeDirection}
                />
              </div>
            </div>

            {endsAreOffered && (
              <>
                <div>
                  <CreateModalFieldLabelRow htmlFor="bulk-transfer-from" label="From" />
                  <Dropdown
                    id="bulk-transfer-from"
                    options={endOptions}
                    value={transferEndValue(transferFrom)}
                    onChange={(value) => changeTransferEnd('from', value)}
                    placeholder="Leave as is"
                    blankOptionIsPlaceholder
                    searchable
                    disabled={Boolean(accountId)}
                    disabledReason={clearedByMoveAccountReason}
                  />
                </div>

                <div>
                  <CreateModalFieldLabelRow htmlFor="bulk-transfer-to" label="To" />
                  <Dropdown
                    id="bulk-transfer-to"
                    options={endOptions}
                    value={transferEndValue(transferTo)}
                    onChange={(value) => changeTransferEnd('to', value)}
                    placeholder="Leave as is"
                    blankOptionIsPlaceholder
                    searchable
                    disabled={Boolean(accountId)}
                    disabledReason={clearedByMoveAccountReason}
                  />
                </div>
              </>
            )}
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="02" title="Details">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-date" label="Date" />
              <DateField
                id="bulk-date"
                ariaLabel="Date"
                value={date}
                onChange={setDate}
              />
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-merchant" label="Merchant" />
              <Dropdown
                id="bulk-merchant"
                options={merchantDropdownOptions}
                value={merchantId}
                selectedOption={merchant ?? undefined}
                onChange={(value) => setMerchant(
                  value === '' ? null : merchantOptions.find((option) => option.value === value) ?? null,
                )}
                placeholder="Leave as is"
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

            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-category" label="Category" />
              <Dropdown
                id="bulk-category"
                options={categoryDropdownOptions}
                value={categoryId}
                onChange={setCategoryId}
                placeholder="Leave as is"
                blankOptionIsPlaceholder
                searchable
              />
            </div>

            <div>
              <CreateModalFieldLabelRow
                htmlFor="bulk-tags"
                label="Add a tag"
                action={(
                  <div className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={overrideTags}
                      label="Override existing tags"
                      onChange={() => setOverrideTags((current) => !current)}
                    />
                    <span aria-hidden onClick={() => setOverrideTags((current) => !current)}>
                      Override existing tags
                    </span>
                  </div>
                )}
              />
              <Dropdown
                id="bulk-tags"
                options={tagOptions}
                value=""
                selectedOption={chosenTagsOption}
                selectedValues={overrideTags && !tagIds.length ? [REMOVE_ALL_TAGS_VALUE] : tagIds}
                closeOnSelect={false}
                onChange={(value) => {
                  if (value === REMOVE_ALL_TAGS_VALUE) {
                    setChosenTags([])
                    setOverrideTags(true)
                    return
                  }
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

            <div className="sm:col-span-2">
              <CreateModalFieldLabelRow
                htmlFor="bulk-note"
                label="Note"
                action={(
                  <div className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={clearsNote}
                      label="Take the note off instead"
                      onChange={toggleClearsNote}
                    />
                    <span aria-hidden onClick={toggleClearsNote}>
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
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="03">
          <div className="min-w-0 space-y-3">
            {/* Takes focus when Apply is refused, so the message is read and scrolled to rather than left off screen */}
            <div
              id={BULK_EDIT_FIELD_IDS.changes}
              tabIndex={-1}
              className="outline-none"
              aria-describedby={refusal.errors.changes ? CHANGES_ERROR_ID : undefined}
            >
              <CreateModalSectionHeadingRow label="What changes" error={refusal.errors.changes} errorId={CHANGES_ERROR_ID} />
            </div>
            <BulkEditSummaryPanel summary={summary} />
          </div>
        </CreateModalSectionFrame>
      </div>
    </ModalTitledPanel>
  )
}
