import { AnimatePresence, motion } from 'motion/react'
import { Tag as TagIcon, X } from 'lucide-react'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { AppSlotMachineText } from '@/components/display/SlotMachineText'
import {
  EASE,
  TRANSACTION_MODAL_FIELD_IDS,
} from '@/pages/transactions/components/transaction-modal/constants'
import TransferCashFlowNotice from '@/pages/transactions/components/transaction-modal/controls/TransferCashFlowNotice'
import { doesTransferRecordCounterpartyAccount } from '@/utils/transfers'
import type {
  TransactionDirection,
  TransactionModalKind,
} from '@/pages/transactions/components/transaction-modal/types'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { getFieldLabelId } from '@/utils/fieldLabel'

type SelectedTransactionTag = {
  id: string
  name: string
}

interface TransactionReferencesSectionProps {
  accountOptions: DropdownOption[]
  selectedArchivedAccountOption?: DropdownOption
  accountValue: string
  accountError?: string | false
  accountPlaceholder: string
  runningBalance?: { amount: number; currency: string }

  // Set instead of the one above when a paired transfer puts the recorded account in the second slot
  counterpartyAccountRunningBalance?: { amount: number; currency: string }
  kind: TransactionModalKind

  // Whether the amount is leaving (debit) or entering (credit) the recorded account, used to
  // label the counterparty-account field as money going out or coming in
  direction: TransactionDirection

  isSymmetricTransfer: boolean

  // Whether to offer the checkbox at all. It asks for a second transaction to be created, which is
  // only something a new transfer can do, so an existing one is not shown it
  isTransferPairOffered: boolean

  // Every account plus the "outside this app" entry, for the field recording where a transfer's
  // counterparty account sits
  counterpartyAccountOptions: DropdownOption[]

  // The recorded account when it has since been archived, which keeps it off the list above
  selectedArchivedCounterpartyAccountOption?: DropdownOption
  counterpartyAccountValue: string
  counterpartyAccountError?: string | false
  merchantOptions: DropdownOption[]
  selectedMerchantOption?: DropdownOption
  merchantValue: string
  merchantError?: string | false
  merchantSearch: string
  merchantLoading: boolean
  merchantLoadingText: string
  merchantHideOptionsWhileLoading: boolean
  merchantHasMore: boolean
  categoryOptions: DropdownOption[]
  categoryValue: string
  categoryError?: string | false

  // True when the chosen category is the synthetic balance adjustment, which is excluded from cash flow
  isBalanceAdjustmentCategory: boolean
  showMerchantDefaultCategoryAction: boolean
  merchantDefaultCategoryActionLabel: string
  merchantDefaultCategoryPending: boolean
  tagOptions: DropdownOption[]
  tagsDisabled: boolean
  tagSearch: string
  tagLoading: boolean
  tagLoadingText: string
  tagHideOptionsWhileLoading: boolean
  tagHasMore: boolean
  selectedTags: SelectedTransactionTag[]
  readOnly: boolean
  onAccountChange: (value: string) => void
  onSymmetricTransferChange: (value: boolean) => void
  onCounterpartyAccountChange: (value: string) => void
  onMerchantChange: (value: string) => void
  onMerchantSearchChange: (value: string) => void
  onMerchantSearchCommit: (value: string) => void
  onMerchantLoadMore: () => void
  onCreateMerchant: (name: string) => void
  onMakeMerchantDefaultCategory: () => void
  onCategoryChange: (value: string) => void
  onCreateCategory: (name: string) => void
  onTagChange: (value: string) => void
  onTagSearchChange: (value: string) => void
  onTagSearchCommit: (value: string) => void
  onTagLoadMore: () => void
  onCreateTag: (name: string) => void
  onRemoveTag: (tagId: string) => void
}

/**
 * Shows what the account's balance becomes once the transaction is added, under whichever of the
 * two account dropdowns is currently holding that account
 */
function RunningBalanceRow({ runningBalance }: { runningBalance?: { amount: number; currency: string } }) {
  const { formatCurrency } = useMoneyFormatters()

  return (
    <AnimatePresence initial={false}>
      {runningBalance && (
        <motion.div
          key="running-balance"
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0, y: -3 }}
          animate={{ height: 'auto', opacity: 1, y: 0 }}
          exit={{ height: 0, opacity: 0, y: -3 }}
          transition={{ duration: 0.2, ease: EASE }}
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 px-0.5 pt-2 text-xs">
            <span className="font-medium" style={{ color: 'var(--app-text-muted)' }}>
              Running balance
            </span>
            <span className="font-financial text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
              {formatCurrency(runningBalance.amount, runningBalance.currency)}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Renders account, merchant, category, and tag reference controls for the transaction form
 */
export default function TransactionReferencesSection({
  accountOptions,
  selectedArchivedAccountOption,
  accountValue,
  accountError,
  accountPlaceholder,
  runningBalance,
  counterpartyAccountRunningBalance,
  kind,
  direction,
  isSymmetricTransfer,
  isTransferPairOffered,
  counterpartyAccountOptions,
  selectedArchivedCounterpartyAccountOption,
  counterpartyAccountValue,
  counterpartyAccountError,
  merchantOptions,
  selectedMerchantOption,
  merchantValue,
  merchantError,
  merchantSearch,
  merchantLoading,
  merchantLoadingText,
  merchantHideOptionsWhileLoading,
  merchantHasMore,
  categoryOptions,
  categoryValue,
  categoryError,
  isBalanceAdjustmentCategory,
  showMerchantDefaultCategoryAction,
  merchantDefaultCategoryActionLabel,
  merchantDefaultCategoryPending,
  tagOptions,
  tagsDisabled,
  tagSearch,
  tagLoading,
  tagLoadingText,
  tagHideOptionsWhileLoading,
  tagHasMore,
  selectedTags,
  readOnly,
  onAccountChange,
  onSymmetricTransferChange,
  onCounterpartyAccountChange,
  onMerchantChange,
  onMerchantSearchChange,
  onMerchantSearchCommit,
  onMerchantLoadMore,
  onCreateMerchant,
  onMakeMerchantDefaultCategory,
  onCategoryChange,
  onCreateCategory,
  onTagChange,
  onTagSearchChange,
  onTagSearchCommit,
  onTagLoadMore,
  onCreateTag,
  onRemoveTag,
}: TransactionReferencesSectionProps) {
  // Every transfer-kind category except Balance Adjustment records which counterparty account the
  // money touched
  const recordsCounterpartyAccount = doesTransferRecordCounterpartyAccount(kind, isBalanceAdjustmentCategory)

  // Ticking the checkbox writes a transaction in both accounts, so neither one is the single account
  // it was recorded in. The two fields then read source first, which is why the one below says the
  // money went to it whatever the direction toggle is set to
  const accountLabel = kind === 'transfer' && isSymmetricTransfer
    ? 'From account'
    : recordsCounterpartyAccount ? 'Recorded in' : 'Account'

  return (
    <CreateModalSectionFrame step="02" title="Source/Destination">
      <div>
        <CreateModalFieldLabelRow
          htmlFor={TRANSACTION_MODAL_FIELD_IDS.account}
          label={accountLabel}
          error={accountError}
        />
        <Dropdown
          id={TRANSACTION_MODAL_FIELD_IDS.account}
          options={accountOptions}
          selectedOption={selectedArchivedAccountOption}
          value={accountValue}
          onChange={onAccountChange}
          hasError={!!accountError}
          labelledBy={getFieldLabelId(TRANSACTION_MODAL_FIELD_IDS.account)}
          placeholder={accountPlaceholder}
          searchable
          searchPlaceholder="Search accounts..."
          disabled={readOnly}
        />
        <RunningBalanceRow runningBalance={runningBalance} />

        <AnimatePresence initial={false}>
          {recordsCounterpartyAccount && (
            <motion.div
              key="symmetric-transfer"
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ height: { duration: 0.2, ease: EASE }, opacity: { duration: 0.14, ease: 'linear' } }}
            >
              <div className="pt-3">
                <CreateModalFieldLabelRow
                  htmlFor={TRANSACTION_MODAL_FIELD_IDS.counterpartyAccount}
                  label={(
                    <>
                      {/* Only the part that changes rolls, so "Money" stays put rather than
                          re-animating every character on a direction switch */}
                      Money{' '}
                      <AppSlotMachineText
                        text={isSymmetricTransfer || direction === 'debit' ? 'went to' : 'came from'}
                        reserveText="came from"
                      />
                    </>
                  )}
                  error={counterpartyAccountError}
                />
                <Dropdown
                  id={TRANSACTION_MODAL_FIELD_IDS.counterpartyAccount}
                  options={counterpartyAccountOptions}
                  selectedOption={selectedArchivedCounterpartyAccountOption}
                  value={counterpartyAccountValue}
                  onChange={onCounterpartyAccountChange}
                  hasError={!!counterpartyAccountError}
                  labelledBy={getFieldLabelId(TRANSACTION_MODAL_FIELD_IDS.counterpartyAccount)}
                  placeholder="Select account..."
                  searchable
                  searchPlaceholder="Search accounts..."
                  // An account archived since this transfer was recorded is off the list, so the
                  // field is held at what it already says rather than letting one change strand the
                  // answer somewhere it can never be put back
                  disabled={readOnly || Boolean(selectedArchivedCounterpartyAccountOption)}
                />
                <RunningBalanceRow runningBalance={counterpartyAccountRunningBalance} />
                <AnimatePresence initial={false}>
                  {/* Ticking the checkbox below does create one there, and its own description says
                      so, so this would contradict it. The padding sits inside the collapsing element
                      so it goes with the text rather than holding the gap open after it leaves */}
                  {!isSymmetricTransfer && (
                    <motion.div
                      key="counterparty-account-note"
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0, y: -3 }}
                      animate={{ height: 'auto', opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -3 }}
                      transition={{ duration: 0.2, ease: EASE }}
                    >
                      <p className="pt-2 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                        Records the fact only, creating no transaction in that account
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {isTransferPairOffered && (
                <div className="pt-3">
                  <label
                    htmlFor="txn-symmetric-transfer"
                    className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-1"
                  >
                    <input
                      id="txn-symmetric-transfer"
                      type="checkbox"
                      checked={isSymmetricTransfer}
                      onChange={(event) => onSymmetricTransferChange(event.target.checked)}
                      disabled={readOnly}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                      style={{ accentColor: 'var(--app-accent)' }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                        Record in both accounts
                      </span>
                      <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                        Also create the matching entry in the receiving account
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div>
        <CreateModalFieldLabelRow
          htmlFor={TRANSACTION_MODAL_FIELD_IDS.merchant}
          label="Merchant"
          error={merchantError}
        />
        <Dropdown
          id={TRANSACTION_MODAL_FIELD_IDS.merchant}
          options={merchantOptions}
          selectedOption={selectedMerchantOption}
          value={merchantValue}
          onChange={onMerchantChange}
          hasError={!!merchantError}
          labelledBy={getFieldLabelId(TRANSACTION_MODAL_FIELD_IDS.merchant)}
          placeholder="Select or type to create..."
          searchable
          searchPlaceholder="Search merchants..."
          searchValue={merchantSearch}
          onSearchChange={onMerchantSearchChange}
          onSearchCommit={onMerchantSearchCommit}
          filterOptions={false}
          isLoading={merchantLoading}
          loadingText={merchantLoadingText}
          loadingMinMs={0}
          hideOptionsWhileLoading={merchantHideOptionsWhileLoading}
          autoHighlightFirstOption
          selectHighlightedOnSearchEnter
          hasMore={merchantHasMore}
          onLoadMore={onMerchantLoadMore}
          onCreateNew={readOnly ? undefined : onCreateMerchant}
          createNewLabel={readOnly ? undefined : (query) => query ? `Create merchant "${query}"` : 'Create merchant'}
          disabled={readOnly}
        />
      </div>

      <div>
        <CreateModalFieldLabelRow
          htmlFor={TRANSACTION_MODAL_FIELD_IDS.category}
          label="Category"
          error={categoryError}
          action={showMerchantDefaultCategoryAction && (
            <button
              type="button"
              className="block h-5 min-w-0 max-w-full truncate text-left text-xs font-medium leading-5 disabled:cursor-not-allowed disabled:opacity-60 sm:text-right"
              style={{ color: 'var(--app-accent)' }}
              title={merchantDefaultCategoryActionLabel}
              disabled={merchantDefaultCategoryPending || readOnly}
              onClick={onMakeMerchantDefaultCategory}
            >
              {merchantDefaultCategoryActionLabel}
            </button>
          )}
        />
        <Dropdown
          id={TRANSACTION_MODAL_FIELD_IDS.category}
          options={categoryOptions}
          value={categoryValue}
          onChange={onCategoryChange}
          hasError={!!categoryError}
          labelledBy={getFieldLabelId(TRANSACTION_MODAL_FIELD_IDS.category)}
          placeholder="Select category..."
          searchable
          searchPlaceholder="Search categories..."
          onCreateNew={readOnly ? undefined : onCreateCategory}
          createNewLabel={readOnly ? undefined : (query) => query ? `Create category "${query}"` : 'Create category'}
          disabled={readOnly}
        />
        <TransferCashFlowNotice show={isBalanceAdjustmentCategory} />
      </div>

      <div>
        <CreateModalFieldLabelRow htmlFor={TRANSACTION_MODAL_FIELD_IDS.tags} label="Tags" />
        <Dropdown
          id={TRANSACTION_MODAL_FIELD_IDS.tags}
          options={tagOptions}
          value=""
          onChange={onTagChange}
          labelledBy={getFieldLabelId(TRANSACTION_MODAL_FIELD_IDS.tags)}
          placeholder={tagsDisabled ? 'Select account first' : 'Add tags...'}
          searchable
          searchPlaceholder="Search tags..."
          searchValue={tagSearch}
          onSearchChange={onTagSearchChange}
          onSearchCommit={onTagSearchCommit}
          filterOptions={false}
          isLoading={tagLoading}
          loadingText={tagLoadingText}
          loadingMinMs={0}
          hideOptionsWhileLoading={tagHideOptionsWhileLoading}
          hasMore={tagHasMore}
          onLoadMore={onTagLoadMore}
          onCreateNew={readOnly ? undefined : onCreateTag}
          createNewLabel={readOnly ? undefined : (query) => query ? `Create tag "${query}"` : 'Create tag'}
          disabled={tagsDisabled || readOnly}
        />
        <AnimatePresence initial={false}>
          {selectedTags.length > 0 && (
            <motion.div
              key="selected-tags"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
              style={{ overflow: 'hidden' }}
            >
              <motion.div
                layout
                className="mt-2 flex flex-wrap gap-2"
                transition={{ layout: { duration: 0.22, ease: EASE } }}
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {selectedTags.map((tag) => (
                    <motion.button
                      layout
                      key={tag.id}
                      type="button"
                      onClick={() => {
                        if (!readOnly) onRemoveTag(tag.id)
                      }}
                      disabled={readOnly}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-100 enabled:hover:bg-[var(--app-accent-soft)] disabled:cursor-not-allowed"
                      style={{
                        background: 'var(--app-surface-soft)',
                        color: 'var(--app-text-muted)',
                        border: '1px solid var(--app-border)',
                        opacity: readOnly ? 0.65 : 1,
                      }}
                      initial={{ opacity: 0, scale: 0.96, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: -4 }}
                      transition={{ duration: 0.18, ease: EASE }}
                      aria-label={`Remove ${tag.name}`}
                    >
                      <TagIcon size={13} aria-hidden className="shrink-0" />
                      <span className="min-w-0 truncate">{tag.name}</span>
                      {!readOnly && <X size={13} aria-hidden className="shrink-0" />}
                    </motion.button>
                  ))}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CreateModalSectionFrame>
  )
}
