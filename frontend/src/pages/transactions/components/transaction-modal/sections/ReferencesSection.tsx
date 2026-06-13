import { AnimatePresence, motion } from 'motion/react'
import { Tag as TagIcon, X } from 'lucide-react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { EASE } from '@/pages/transactions/components/transaction-modal/constants'
import TransactionModalFieldLabelRow from '@/pages/transactions/components/transaction-modal/controls/FieldLabelRow'
import TransactionModalSectionFrame from '@/pages/transactions/components/transaction-modal/controls/SectionFrame'
import { formatCurrency } from '@/utils/formatCurrency'

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
  onAccountChange: (value: string) => void
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
 * Renders account, merchant, category, and tag reference controls for the transaction form
 */
export default function TransactionReferencesSection({
  accountOptions,
  selectedArchivedAccountOption,
  accountValue,
  accountError,
  accountPlaceholder,
  runningBalance,
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
  onAccountChange,
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
  return (
    <TransactionModalSectionFrame number="02" title="Source/Destination">
      <div>
        <TransactionModalFieldLabelRow label="Account" error={accountError} />
        <Dropdown
          options={accountOptions}
          selectedOption={selectedArchivedAccountOption}
          value={accountValue}
          onChange={onAccountChange}
          className={`app-input ${accountError ? 'app-input-error' : ''}`}
          placeholder={accountPlaceholder}
          searchable
          searchPlaceholder="Search accounts..."
        />
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
                <span
                  className="font-financial text-sm font-semibold"
                  style={{ color: 'var(--app-text)' }}
                >
                  {formatCurrency(runningBalance.amount, runningBalance.currency)}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div>
        <TransactionModalFieldLabelRow label="Merchant" error={merchantError} />
        <Dropdown
          options={merchantOptions}
          selectedOption={selectedMerchantOption}
          value={merchantValue}
          onChange={onMerchantChange}
          className={`app-input ${merchantError ? 'app-input-error' : ''}`}
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
          onCreateNew={onCreateMerchant}
          createNewLabel={(query) => query ? `Create merchant "${query}"` : 'Create merchant'}
        />
      </div>

      <div>
        <TransactionModalFieldLabelRow
          label="Category"
          error={categoryError}
          action={showMerchantDefaultCategoryAction && (
            <button
              type="button"
              className="block h-5 min-w-0 max-w-full truncate text-left text-xs font-medium leading-5 disabled:cursor-not-allowed disabled:opacity-60 sm:text-right"
              style={{ color: 'var(--app-accent)' }}
              title={merchantDefaultCategoryActionLabel}
              disabled={merchantDefaultCategoryPending}
              onClick={onMakeMerchantDefaultCategory}
            >
              {merchantDefaultCategoryActionLabel}
            </button>
          )}
        />
        <Dropdown
          options={categoryOptions}
          value={categoryValue}
          onChange={onCategoryChange}
          className={`app-input ${categoryError ? 'app-input-error' : ''}`}
          placeholder="Select category..."
          searchable
          searchPlaceholder="Search categories..."
          onCreateNew={onCreateCategory}
          createNewLabel={(query) => query ? `Create category "${query}"` : 'Create category'}
        />
      </div>

      <div>
        <TransactionModalFieldLabelRow label="Tags" />
        <Dropdown
          options={tagOptions}
          value=""
          onChange={onTagChange}
          className="app-input"
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
          onCreateNew={onCreateTag}
          createNewLabel={(query) => query ? `Create tag "${query}"` : 'Create tag'}
          disabled={tagsDisabled}
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
                      onClick={() => onRemoveTag(tag.id)}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-100 hover:bg-[var(--app-accent-soft)]"
                      style={{
                        background: 'var(--app-surface-soft)',
                        color: 'var(--app-text-muted)',
                        border: '1px solid var(--app-border)',
                      }}
                      initial={{ opacity: 0, scale: 0.96, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: -4 }}
                      transition={{ duration: 0.18, ease: EASE }}
                      aria-label={`Remove ${tag.name}`}
                    >
                      <TagIcon size={13} aria-hidden className="shrink-0" />
                      <span className="min-w-0 truncate">{tag.name}</span>
                      <X size={13} aria-hidden className="shrink-0" />
                    </motion.button>
                  ))}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TransactionModalSectionFrame>
  )
}
