import { useId, useMemo, useState } from 'react'
import { PencilLine, X } from 'lucide-react'
import { useCategories } from '@/api/categories'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import DateField from '@/components/date-field/DateField'
import Dropdown from '@/components/dropdown/Dropdown'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import CategoryNoticeLine from '@/pages/transactions/components/transaction-modal/controls/CategoryNoticeLine'
import TransactionModalPillSelector from '@/pages/transactions/components/transaction-modal/controls/PillSelector'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import {
  buildBulkEditFields,
  canApplyBulkEdit,
  countTransferEndEffects,
  doesAnyResultingCategoryRecordTransferTarget,
  doesChosenCategoryRecordTransferTarget,
  getBulkEditBlockers,
  getBulkMoveTargets,
  getTransferEndTargets,
  resolveTransferEnds,
  type BulkEditChoice,
  type BulkEditFields,
  type SelectedTransactionFacts,
  type TransferEndChoice,
  type TransferEndEffect,
} from '@/pages/transactions/components/bulk-edit/selection'
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
  { value: 'unchanged', label: 'Leave as it is' },
  { value: 'debit', label: 'Money out' },
  { value: 'credit', label: 'Money in' },
  { value: 'reverse', label: 'Turn around' },
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

/**
 * Renders the move and record-only notice lines for one end of a transfer edit, in the singular or
 * plural the count calls for
 *
 * A move notice only makes sense for a tracked account, since a row can never move into "outside
 * this app"; a row whose own end resolves to outside is refused instead, by the sitsOutside blocker
 */
function TransferEndEffectNotice({
  effect,
  choice,
  accountName,
}: {
  effect: TransferEndEffect
  choice: TransferEndChoice | null
  accountName: string
}) {
  return (
    <>
      <CategoryNoticeLine show={choice?.scope === 'tracked' && effect.moves > 0}>
        {effect.moves}
        {effect.moves === 1 ? ' selected transaction moves into ' : ' selected transactions move into '}
        {accountName}.
      </CategoryNoticeLine>
      <CategoryNoticeLine show={effect.recordsOnly > 0}>
        {effect.recordsOnly}
        {effect.recordsOnly === 1 ? ' selected transaction records ' : ' selected transactions record '}
        {choice?.scope === 'outside' ? 'the other side as outside this app.' : `${accountName} as the other side.`}
      </CategoryNoticeLine>
    </>
  )
}

/** One currency an own end would move blocked rows into, and how many rows share the pairing */
interface CurrencyMismatch {
  rowCurrency: string
  targetCurrency: string
  count: number
}

/**
 * Groups the rows blocked for sitting in another currency than the end they would move into, by the
 * pair of currencies involved, so the notice can name the right ones rather than assuming the
 * selection holds only one
 *
 * @param rows The selected transactions
 * @param blockedIds The row ids getBulkEditBlockers listed as ownSideInAnotherCurrency
 * @param choice What the edit holds
 * @param chosenCategoryRecordsTransferTarget Whether the category the edit sets records the other
 *     side, or undefined while the edit sets no category and each row keeps its own
 */
function groupCurrencyMismatches(
  rows: SelectedTransactionFacts[],
  blockedIds: string[],
  choice: BulkEditChoice,
  chosenCategoryRecordsTransferTarget: boolean | undefined,
): CurrencyMismatch[] {
  const blocked = new Set(blockedIds)
  const groups = new Map<string, CurrencyMismatch>()

  for (const row of rows) {
    if (!blocked.has(row.id)) continue
    const endsUpRecordingFarSide = chosenCategoryRecordsTransferTarget ?? row.recordsFarSide
    const { ownEnd } = resolveTransferEnds(row, choice, endsUpRecordingFarSide)
    if (ownEnd?.scope !== 'tracked') continue

    const key = `${row.currency}-${ownEnd.currency}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { rowCurrency: row.currency, targetCurrency: ownEnd.currency, count: 1 })
  }

  return [...groups.values()]
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
  const endsAreOffered = doesAnyResultingCategoryRecordTransferTarget(chosenCategory, rows)

  const moveTargets = useMemo(
    () => getBulkMoveTargets(accounts, selectedCurrencies),
    [accounts, selectedCurrencies],
  )
  const accountOptions = moveTargets.map((account) => ({ value: account.id, label: account.name ?? 'Account' }))

  const endTargets = useMemo(() => getTransferEndTargets(accounts), [accounts])
  const endOptions = [
    { value: '', label: 'Leave it as it is' },
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
  const tagOptions = tags
    .filter((tag) => !tagIds.includes(tag.id))
    .map((tag) => ({ value: tag.id, label: tag.name }))

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
  const endEffects = countTransferEndEffects(rows, choice, chosenCategoryRecordsTransferTarget)
  const currencyMismatches = groupCurrencyMismatches(
    rows,
    blockers.ownSideInAnotherCurrency,
    choice,
    chosenCategoryRecordsTransferTarget,
  )
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
      <div className="space-y-5">
        <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          A control left alone leaves that detail as it is on every selected transaction.
        </p>

        <CreateModalSectionFrame step="01" title="Type & Direction">
          <div>
            <CreateModalFieldLabelRow label="Which way the money moves" />
            <TransactionModalPillSelector
              value={direction ?? 'unchanged'}
              options={DIRECTION_OPTIONS}
              ariaLabel="Set which way the money moves"
              onChange={(value) => setDirection(value === 'unchanged' ? null : value)}
            />
            <CategoryNoticeLine show={endsAreOffered}>
              A transfer&apos;s other half is a separate row. This changes only the rows selected.
            </CategoryNoticeLine>
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="02" title="Source/Destination">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-account" label="Move to account" />
              <Dropdown
                id="bulk-account"
                options={accountOptions}
                value={accountId}
                onChange={changeMoveAccount}
                placeholder={accountOptions.length === 0 ? 'No account it can move to' : 'Leave as it is'}
                searchable
                disabled={accountOptions.length === 0 || sendsAnEnd}
              />
              <CategoryNoticeLine show={selectedCurrencies.length > 1}>
                These transactions are in more than one currency, so they cannot move to one account
                together. Narrow the selection to a single currency first.
              </CategoryNoticeLine>
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
                placeholder="Leave as it is"
                searchable
                filterOptions={false}
                searchValue={merchantSearch.search}
                onSearchChange={merchantSearch.setSearch}
                isLoading={merchantQuery.isFetching}
                hasMore={merchantQuery.hasNextPage}
                onLoadMore={merchantQuery.fetchNextPage}
              />
              <CategoryNoticeLine show={blockers.withoutMerchant.length > 0}>
                {blockers.withoutMerchant.length}
                {blockers.withoutMerchant.length === 1
                  ? ' selected transaction has no merchant recorded, and cannot be changed until it does. Set one here, or close this and untick it.'
                  : ' selected transactions have no merchant recorded, and cannot be changed until they do. Set one here, or close this and untick them.'}
              </CategoryNoticeLine>
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-category" label="Category" />
              <Dropdown
                id="bulk-category"
                options={categoryOptions}
                value={categoryId}
                onChange={setCategoryId}
                placeholder="Leave as it is"
                searchable
              />
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor="bulk-tags" label="Add a tag" />
              <Dropdown
                id="bulk-tags"
                options={tagOptions}
                value=""
                onChange={(value) => {
                  const picked = tagOptions.find((option) => option.value === value)
                  if (picked) setChosenTags((current) => [...current, picked])
                }}
                placeholder="Leave them as they are"
                searchable
                filterOptions={false}
                searchValue={tagSearch.search}
                onSearchChange={tagSearch.setSearch}
                isLoading={tagQuery.isFetching}
                hasMore={tagQuery.hasNextPage}
                onLoadMore={tagQuery.fetchNextPage}
              />
              {chosenTags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-2">
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
            </div>

            {endsAreOffered && (
              <>
                <div>
                  <CreateModalFieldLabelRow htmlFor="bulk-transfer-from" label="From" />
                  <Dropdown
                    id="bulk-transfer-from"
                    options={endOptions}
                    value={transferEndValue(transferFrom)}
                    onChange={(value) => changeTransferEnd(setTransferFrom, value)}
                    placeholder="Leave it as it is"
                    searchable
                    disabled={Boolean(accountId)}
                  />
                </div>

                <div>
                  <CreateModalFieldLabelRow htmlFor="bulk-transfer-to" label="To" />
                  <Dropdown
                    id="bulk-transfer-to"
                    options={endOptions}
                    value={transferEndValue(transferTo)}
                    onChange={(value) => changeTransferEnd(setTransferTo, value)}
                    placeholder="Leave it as it is"
                    searchable
                    disabled={Boolean(accountId)}
                  />
                </div>

                <div className="sm:col-span-2">
                  <TransferEndEffectNotice
                    effect={endEffects.from}
                    choice={transferFrom}
                    accountName={transferFrom?.scope === 'tracked' ? accountName(transferFrom.accountId) : ''}
                  />
                  <TransferEndEffectNotice
                    effect={endEffects.to}
                    choice={transferTo}
                    accountName={transferTo?.scope === 'tracked' ? accountName(transferTo.accountId) : ''}
                  />
                  <CategoryNoticeLine show={sendsAnEnd && endEffects.leftAlone > 0}>
                    {endEffects.leftAlone}
                    {endEffects.leftAlone === 1
                      ? ' selected transaction is not a transfer and is left as it is.'
                      : ' selected transactions are not transfers and are left as they are.'}
                  </CategoryNoticeLine>
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <CategoryNoticeLine show={blockers.sitsOutside.length > 0}>
                {blockers.sitsOutside.length}
                {blockers.sitsOutside.length === 1
                  ? ' selected transaction would sit outside this app. Money leaves from or arrives in one of your accounts, so pick one, or close this and untick it.'
                  : ' selected transactions would sit outside this app. Money leaves from or arrives in one of your accounts, so pick one, or close this and untick them.'}
              </CategoryNoticeLine>

              {currencyMismatches.map((mismatch) => (
                <CategoryNoticeLine key={`${mismatch.rowCurrency}-${mismatch.targetCurrency}`} show>
                  {mismatch.count}
                  {mismatch.count === 1
                    ? ` selected transaction is in ${mismatch.rowCurrency} and would move into an account in ${mismatch.targetCurrency}. Pick an account in ${mismatch.rowCurrency}, or close this and untick it.`
                    : ` selected transactions are in ${mismatch.rowCurrency} and would move into an account in ${mismatch.targetCurrency}. Pick an account in ${mismatch.rowCurrency}, or close this and untick them.`}
                </CategoryNoticeLine>
              ))}

              <CategoryNoticeLine show={blockers.unansweredFarSide.length > 0}>
                {blockers.unansweredFarSide.length}
                {blockers.unansweredFarSide.length === 1
                  ? ' selected transfer does not record where the money went. Answer that here, or close this and untick it.'
                  : ' selected transfers do not record where the money went. Answer that here, or close this and untick them.'}
              </CategoryNoticeLine>

              <CategoryNoticeLine show={blockers.ownAccountFarSide.length > 0}>
                {blockers.ownAccountFarSide.length}
                {blockers.ownAccountFarSide.length === 1
                  ? ' selected transaction would end up recording the account it already sits in. Pick a different account, or close this and untick it.'
                  : ' selected transactions would end up recording the account they already sit in. Pick a different account, or close this and untick them.'}
              </CategoryNoticeLine>
            </div>
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
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={clearsNote}
                    onChange={(event) => setClearsNote(event.target.checked)}
                  />
                  Take the note off instead
                </label>
              )}
            />
            <input
              id="bulk-note"
              type="text"
              className="app-input disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={clearsNote ? 'The note comes off' : 'Leave it as it is'}
              value={note}
              disabled={clearsNote}
              onChange={(event) => setNote(event.target.value)}
              maxLength={MAX_NOTE_LENGTH}
            />
          </div>
        </CreateModalSectionFrame>

        <CategoryNoticeLine show={overCap}>
          One edit covers at most {MAX_BULK_EDIT_TRANSACTIONS} transactions. Untick some to continue.
        </CategoryNoticeLine>
      </div>
    </ModalTitledPanel>
  )
}
