import { useId, useState, type Dispatch, type SetStateAction } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import DateField from '@/components/date-field/DateField'
import type { OptionItem } from '@/components/filters/OptionList'
import { MultiSelectChecklist } from '@/components/filters/MultiSelectChecklist'
import { FacetSelectDropdown } from '@/components/list-controls/FacetSelectDropdown'
import { FILTER_GLASS_SPRING } from '@/components/list-controls/toolbarStyles'
import { joinClassNames } from '@/utils/classNames'
import { getMoneyPlaceholder } from '@/utils/moneyInput'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { ReferenceFacet } from '@/pages/transactions/components/toolbar/ReferenceFacet'
import {
  FILTER_FACETS,
  type AmountDraft,
  type FacetConfig,
  type MultiSelections,
  type TransactionFilterDraft,
} from '@/pages/transactions/components/toolbar/useTransactionFilterDraft'

// Stable empty set so the common, account-enabled case never rebuilds a set on each render
const NO_DISABLED_FACETS = new Set<string>()

// The account facet is disabled on an account's own transaction list, where the scope is fixed
const ACCOUNT_DISABLED_FACETS = new Set(['accounts'])

/**
 * Renders the shared filter panel body: the facet tabs, the active facet editor, the removable
 * active-filter chips, and the apply and clear actions, driven by the shared draft
 */
export function FilterPanelBody({
  draft,
  showFooter = true,
  mobile = false,
  fillHeight = false,
  showAccountFilter = true,
}: {
  draft: TransactionFilterDraft
  showFooter?: boolean
  // Swaps the cramped facet tab grid for a dropdown, only used by the mobile full-screen sheet
  mobile?: boolean
  // Lets the facet editor grow to fill its container with the option list scrolling internally,
  // used by the mobile sheet and the desktop panel once the panel opens to a fixed height
  fillHeight?: boolean
  // False on an account's own transaction list, where the account facet is disabled because the
  // account scope is already fixed
  showAccountFilter?: boolean
}) {
  const disabledFacetIds = showAccountFilter ? NO_DISABLED_FACETS : ACCOUNT_DISABLED_FACETS
  const [activeFacetId, setActiveFacetId] = useState(
    () => FILTER_FACETS.find((facet) => !disabledFacetIds.has(facet.id))?.id ?? FILTER_FACETS[0].id,
  )
  // Scopes the sliding-thumb layout animation to this instance
  const segId = useId()
  // Name the crossed-range messages so the amount and date fields can point at them from the facet
  // editor, which renders outside the block holding them
  const amountRangeMessageId = useId()
  const dateRangeMessageId = useId()
  const shouldReduceMotion = useReducedMotion()
  const transition = shouldReduceMotion ? { duration: 0 } : FILTER_GLASS_SPRING
  const activeFacet = FILTER_FACETS.find((facet) => facet.id === activeFacetId) ?? FILTER_FACETS[0]

  // The desktop panel keeps the position springs so the summary divider and the blocks below it
  // glide when the editor resizes. The mobile sheet runs inside a scroll area where those springs
  // fight the flex sizing, so they are turned off there
  const blockLayout = mobile ? false : 'position'

  return (
    <div className={joinClassNames('contents', fillHeight && '!flex min-h-0 flex-1 flex-col')}>
      {mobile ? (
        <FacetSelectDropdown
          facets={FILTER_FACETS}
          activeFacetId={activeFacetId}
          countFacet={draft.countFacet}
          disabledFacetIds={disabledFacetIds}
          onSelect={setActiveFacetId}
        />
      ) : (
        <motion.div
          layout={blockLayout}
          transition={transition}
          className="app-range-seg"
          role="tablist"
          aria-label="Filter facets"
        >
          {FILTER_FACETS.map((facet) => {
            const FacetIcon = facet.icon
            const facetCount = draft.countFacet(facet)
            const isActive = facet.id === activeFacetId
            const isDisabled = disabledFacetIds.has(facet.id)
            return (
              <motion.button
                key={facet.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={isDisabled}
                whileTap={shouldReduceMotion || isDisabled ? undefined : { scale: 0.94 }}
                className={joinClassNames('app-range-seg-option', isActive && 'app-range-seg-option-active')}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: isDisabled ? 0.4 : 1, cursor: isDisabled ? 'not-allowed' : undefined }}
                onClick={() => setActiveFacetId(facet.id)}
              >
                {isActive && <motion.span layoutId={`${segId}-facet`} className="app-range-seg-thumb" transition={transition} />}
                <span className="app-range-seg-label" style={{ display: 'inline-flex' }}>
                  <FacetIcon size={16} aria-hidden />
                </span>
                <span className="app-range-seg-label" style={{ fontSize: '0.625rem' }}>
                  {facet.label}
                </span>
                {!isDisabled && facetCount > 0 && (
                  <span
                    className="absolute flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-medium"
                    style={{ top: 2, right: 2, zIndex: 1, background: 'var(--app-accent)', color: 'var(--app-button-primary-text)' }}
                  >
                    {facetCount}
                  </span>
                )}
              </motion.button>
            )
          })}
        </motion.div>
      )}

      <motion.div
        layout={blockLayout}
        transition={transition}
        className={joinClassNames('mt-3', fillHeight && 'flex min-h-0 flex-1 flex-col')}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeFacet.id}
            className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
          >
            <FacetEditor
              facet={activeFacet}
              options={draft.getFacetOptions(activeFacet.id)}
              selectedValues={draft.selections[activeFacet.id] ?? []}
              referenceLabels={draft.referenceLabels}
              tagMatch={draft.tagMatch}
              amount={draft.amount}
              amountSymbol={draft.amountSymbol}
              amountCurrencyNote={draft.amountCurrencyNote}
              amountExponent={draft.amountExponent}
              hasCrossedAmountBounds={draft.hasCrossedAmountBounds}
              amountRangeMessageId={amountRangeMessageId}
              hasCrossedDateRange={draft.hasCrossedDateRange}
              dateRangeMessageId={dateRangeMessageId}
              currencyOptions={draft.getFacetOptions('currency')}
              currencyValue={draft.currencyLocked ? draft.amountCurrency : draft.selections.currency[0] ?? ''}
              currencyLocked={draft.currencyLocked}
              dateRange={draft.dateRange}
              fillHeight={fillHeight}
              mobile={mobile}
              onToggle={(value, label) => draft.toggleSelection(activeFacet.id, value, label)}
              onCurrencyToggle={(value) => draft.toggleSelection('currency', value)}
              onTagMatchChange={draft.setTagMatch}
              onAmountChange={draft.setAmount}
              onDateRangeChange={draft.setDateRange}
            />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <motion.div layout={blockLayout} transition={transition}>
        <ActiveFilterSummary
          selections={draft.selections}
          referenceLabels={draft.referenceLabels}
          amount={draft.amount}
          amountSymbol={draft.amountSymbol}
          dateRange={draft.dateRange}
          getFacetOptions={draft.getFacetOptions}
          onRemoveSelection={draft.toggleSelection}
          onClearAmount={() => draft.setAmount({ min: '', max: '' })}
          onClearDate={() => draft.setDateRange({ from: '', to: '' })}
        />
      </motion.div>

      <motion.div layout={blockLayout} transition={transition}>
        {/* The crossed-range messages take this line rather than sitting in their own editors, so
            every reason Apply is unavailable stays on screen whichever facet is open */}
        {draft.isApplyBlocked ? (
          <>
            {draft.hasCrossedAmountBounds && (
              <p id={amountRangeMessageId} className="mt-2 px-0.5 text-xs" style={{ color: 'var(--app-negative)' }}>
                Enter a minimum at or below the maximum
              </p>
            )}
            {draft.hasCrossedDateRange && (
              <p id={dateRangeMessageId} className="mt-2 px-0.5 text-xs" style={{ color: 'var(--app-negative)' }}>
                The From date must be on or before the To date
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            Transactions must match every filter you apply
          </p>
        )}
      </motion.div>

      {showFooter && (
        <motion.div layout={blockLayout} transition={transition} className="mt-3 flex items-center justify-between">
          <button
            type="button"
            className="app-secondary-button"
            disabled={draft.activeFacetCount === 0}
            onClick={draft.clearAll}
          >
            Clear all
          </button>
          <button
            type="button"
            className="app-glass-button-primary"
            disabled={draft.isApplyBlocked}
            onClick={draft.applyFilters}
          >
            Apply filters
          </button>
        </motion.div>
      )}
    </div>
  )
}

/**
 * Renders one labelled date filter field backed by the shared segmented date control
 */
function DateFacetInput({
  label,
  value,
  error,
  describedById,
  onValueChange,
}: {
  label: string
  value: string
  // True while the two dates exclude each other, which marks both fields rather than blaming one
  error: boolean
  // Names the message explaining the crossed range, which the panel renders outside this field
  describedById: string
  onValueChange: (value: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
      {label}
      <DateField
        ariaLabel={label}
        value={value}
        error={error}
        describedById={describedById}
        onChange={onValueChange}
      />
    </div>
  )
}

type FacetEditorProps = {
  facet: FacetConfig
  options: OptionItem[]
  selectedValues: string[]
  referenceLabels: Record<string, string>
  tagMatch: 'all' | 'any'
  amount: AmountDraft
  amountSymbol: string
  amountCurrencyNote: string
  // Decimal places of the currency the amount range matches, for parsing and normalizing input
  amountExponent: number
  // True while the minimum sits above the maximum once both are rounded to the currency's minor
  // units, which no transaction can satisfy
  hasCrossedAmountBounds: boolean
  // Names the message explaining the crossed bounds, which the panel renders outside this editor
  amountRangeMessageId: string
  // True while the from date sits after the to date, leaving a range no transaction can satisfy
  hasCrossedDateRange: boolean
  // Names the message explaining the crossed range, which the panel renders outside this editor
  dateRangeMessageId: string
  // The currency the amount range matches, chosen inside the amount section
  currencyOptions: OptionItem[]
  currencyValue: string
  // True on an account's own list, where the currency is pinned to the account and cannot be changed
  currencyLocked: boolean
  dateRange: { from: string; to: string }
  fillHeight: boolean
  // True in the mobile sheet, where the date range stacks into two rows rather than sharing one
  mobile: boolean
  onToggle: (value: string, label?: string) => void
  onCurrencyToggle: (value: string) => void
  onTagMatchChange: (value: 'all' | 'any') => void
  // Takes an updater rather than a value, so two bounds settling in the same commit cannot
  // overwrite each other when the currency changes under them
  onAmountChange: Dispatch<SetStateAction<AmountDraft>>
  onDateRangeChange: (value: { from: string; to: string }) => void
}

/**
 * Renders the editor for the active facet: a searchable list for multi-select facets, a server
 * search for merchants and tags, and labelled inputs for the amount and date ranges
 */
function FacetEditor({
  facet,
  options,
  selectedValues,
  referenceLabels,
  tagMatch,
  amount,
  amountSymbol,
  amountCurrencyNote,
  amountExponent,
  hasCrossedAmountBounds,
  amountRangeMessageId,
  hasCrossedDateRange,
  dateRangeMessageId,
  currencyOptions,
  currencyValue,
  currencyLocked,
  dateRange,
  fillHeight,
  mobile,
  onToggle,
  onCurrencyToggle,
  onTagMatchChange,
  onAmountChange,
  onDateRangeChange,
}: FacetEditorProps) {
  const shouldReduceMotion = useReducedMotion()
  const tagMatchThumbId = useId()
  // Called on every render regardless of facet kind so the rules of hooks hold, since the amount
  // instance is the only one ever mounted with facet.kind === 'amount'
  const minAmountInput = useMoneyInput({
    value: amount.min,
    exponent: amountExponent,
    onChange: (value) => onAmountChange((current) => ({ ...current, min: value })),
  })
  const maxAmountInput = useMoneyInput({
    value: amount.max,
    exponent: amountExponent,
    onChange: (value) => onAmountChange((current) => ({ ...current, max: value })),
  })

  if (facet.kind === 'amount') {
    return (
      <div className="flex flex-col gap-3">
        {(currencyLocked || currencyOptions.length > 0) && (
          <div className="flex flex-col gap-1.5">
            <span className="px-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Currency
            </span>
            <div className="flex flex-wrap gap-1.5">
              {currencyLocked ? (
                <span
                  aria-disabled
                  className="rounded-full border px-3 py-1 text-sm"
                  style={{ background: 'var(--app-accent-soft)', borderColor: 'transparent', color: 'var(--app-accent)', fontWeight: 500, opacity: 0.55, cursor: 'not-allowed' }}
                >
                  {currencyValue}
                </span>
              ) : (
                currencyOptions.map((option) => {
                  const isSelected = option.value === currencyValue
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      className="rounded-full border px-3 py-1 text-sm transition-colors hover:bg-[var(--app-accent-soft)]"
                      style={
                        isSelected
                          ? { background: 'var(--app-accent-soft)', borderColor: 'transparent', color: 'var(--app-accent)', fontWeight: 500 }
                          : { borderColor: 'var(--app-input-border)', color: 'var(--app-text)' }
                      }
                      onClick={() => onCurrencyToggle(option.value)}
                    >
                      {option.label}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="px-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
            Amount
          </span>
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Min
              <div className="relative">
                {amountSymbol && (
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    {amountSymbol}
                  </span>
                )}
                <input
                  className={joinClassNames('app-input', amountSymbol && 'pl-8', hasCrossedAmountBounds && 'app-input-error')}
                  placeholder={getMoneyPlaceholder(amountExponent)}
                  aria-invalid={hasCrossedAmountBounds}
                  aria-describedby={hasCrossedAmountBounds ? amountRangeMessageId : undefined}
                  {...minAmountInput}
                />
              </div>
            </label>
            <span className="pb-2.5 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              to
            </span>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Max
              <div className="relative">
                {amountSymbol && (
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    {amountSymbol}
                  </span>
                )}
                <input
                  className={joinClassNames('app-input', amountSymbol && 'pl-8', hasCrossedAmountBounds && 'app-input-error')}
                  placeholder="Any"
                  aria-invalid={hasCrossedAmountBounds}
                  aria-describedby={hasCrossedAmountBounds ? amountRangeMessageId : undefined}
                  {...maxAmountInput}
                />
              </div>
            </label>
          </div>
          <p className="px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            {amountCurrencyNote}
          </p>
        </div>
      </div>
    )
  }

  if (facet.kind === 'date') {
    return (
      <div className={joinClassNames('flex gap-2', mobile ? 'flex-col' : 'items-end')}>
        <DateFacetInput
          label="From"
          value={dateRange.from}
          error={hasCrossedDateRange}
          describedById={dateRangeMessageId}
          onValueChange={(value) => onDateRangeChange({ ...dateRange, from: value })}
        />
        {/* Each field carries its own From or To label, so the joining word only reads as one while
            the two sit side by side */}
        {!mobile && (
          <span className="pb-2.5 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
            to
          </span>
        )}
        <DateFacetInput
          label="To"
          value={dateRange.to}
          error={hasCrossedDateRange}
          describedById={dateRangeMessageId}
          onValueChange={(value) => onDateRangeChange({ ...dateRange, to: value })}
        />
      </div>
    )
  }

  if (facet.id === 'merchants' || facet.id === 'tags') {
    return (
      <div className={joinClassNames('flex flex-col gap-2', fillHeight && 'min-h-0 flex-1')}>
        {facet.id === 'tags' && (
          <div>
            <div className="app-range-seg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {(['all', 'any'] as const).map((mode) => {
                const isActive = tagMatch === mode
                return (
                  <motion.button
                    key={mode}
                    type="button"
                    aria-pressed={isActive}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
                    className={joinClassNames('app-range-seg-option', isActive && 'app-range-seg-option-active')}
                    onClick={() => onTagMatchChange(mode)}
                  >
                    {isActive && (
                      <motion.span
                        layoutId={`${tagMatchThumbId}-thumb`}
                        className="app-range-seg-thumb"
                        transition={shouldReduceMotion ? { duration: 0 } : FILTER_GLASS_SPRING}
                      />
                    )}
                    <span className="app-range-seg-label">{mode === 'all' ? 'All' : 'Any'}</span>
                  </motion.button>
                )
              })}
            </div>
            <p className="mt-1 px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
              {tagMatch === 'all' ? 'Match transactions with all selected tags' : 'Match transactions with any selected tag'}
            </p>
          </div>
        )}
        <ReferenceFacet
          kind={facet.id}
          selectedValues={selectedValues}
          selectedLabels={referenceLabels}
          searchPlaceholder={`Search ${facet.label.toLowerCase()}`}
          fillHeight={fillHeight}
          onToggle={onToggle}
        />
      </div>
    )
  }

  if (options.length === 0) {
    return (
      <p className="py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
        No {facet.label.toLowerCase()} available
      </p>
    )
  }

  return (
    <MultiSelectChecklist
      key={facet.id}
      options={options}
      selectedValues={selectedValues}
      searchPlaceholder={`Search ${facet.label.toLowerCase()}`}
      fillHeight={fillHeight}
      onToggle={onToggle}
    />
  )
}

type ActiveFilterSummaryProps = {
  selections: MultiSelections
  referenceLabels: Record<string, string>
  amount: AmountDraft
  amountSymbol: string
  dateRange: { from: string; to: string }
  getFacetOptions: (facetId: string) => OptionItem[]
  onRemoveSelection: (facetId: string, value: string) => void
  onClearAmount: () => void
  onClearDate: () => void
}

/**
 * Renders a filter bound for the summary chip, which is read-only text and so follows the reader's
 * own number convention rather than the plain format the amount fields hold
 */
function formatFilterAmount(value: string): string {
  if (!value.trim()) return ''

  // The bound already carries the decimals its currency uses, so the chip keeps exactly those
  // rather than letting the formatter trim a trailing zero
  const decimals = value.split('.')[1]?.length ?? 0

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value))
}

/**
 * Renders the removable chips for every live selection across all facets, so the full filter state
 * stays visible while only one facet editor shows at a time
 */
function ActiveFilterSummary({
  selections,
  referenceLabels,
  amount,
  amountSymbol,
  dateRange,
  getFacetOptions,
  onRemoveSelection,
  onClearAmount,
  onClearDate,
}: ActiveFilterSummaryProps) {
  const multiChips = Object.entries(selections).flatMap(([facetId, values]) =>
    values.map((value) => {
      // Client-list facets resolve via their options, server-searched ones via the label cache
      const label = getFacetOptions(facetId).find((option) => option.value === value)?.label ?? referenceLabels[value] ?? value
      return { key: `${facetId}:${value}`, label, onRemove: () => onRemoveSelection(facetId, value) }
    }),
  )

  const amountChip = amount.min || amount.max
    ? [{ key: 'amount', label: `${amountSymbol}${formatFilterAmount(amount.min) || '0'}–${formatFilterAmount(amount.max) || 'any'}`, onRemove: onClearAmount }]
    : []

  const dateChip = dateRange.from || dateRange.to
    ? [{ key: 'date', label: `${dateRange.from || '…'} → ${dateRange.to || '…'}`, onRemove: onClearDate }]
    : []

  const chips = [...multiChips, ...amountChip, ...dateChip]

  return (
    <div
      className="mt-3 flex min-h-[1.5rem] flex-wrap items-center gap-1.5 border-t px-0.5 pt-2.5"
      style={{ borderColor: 'var(--app-input-border)' }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {chips.length === 0 ? (
          <motion.span
            key="empty"
            layout
            className="text-xs"
            style={{ color: 'var(--app-text-subtle)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FILTER_GLASS_SPRING}
          >
            No filters applied
          </motion.span>
        ) : (
          chips.map((chip) => (
            <motion.span
              key={chip.key}
              layout
              className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[11px]"
              style={{ background: 'color-mix(in srgb, var(--app-accent) 14%, transparent)', color: 'var(--app-accent)' }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={FILTER_GLASS_SPRING}
            >
              {chip.label}
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                className="flex opacity-70 hover:opacity-100"
                onClick={chip.onRemove}
              >
                <X size={13} aria-hidden />
              </button>
            </motion.span>
          ))
        )}
      </AnimatePresence>
    </div>
  )
}
