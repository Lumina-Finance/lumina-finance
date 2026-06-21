import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Calendar, Check, ChevronDown, X } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { MultiSelectChecklist } from '@/components/filters/MultiSelectChecklist'
import { getFilterOptionStyle } from '@/components/filters/optionAppearance'
import { joinClassNames } from '@/utils/classNames'
import { formatMoneyInputLive, sanitizeMoneyInput } from '@/utils/moneyInput'
import { ReferenceFacet } from '@/pages/transactions/components/toolbar/ReferenceFacet'
import {
  FILTER_FACETS,
  FILTER_GLASS_SPRING,
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
        <MobileFacetSelect
          activeFacetId={activeFacetId}
          countFacet={draft.countFacet}
          disabledFacetIds={disabledFacetIds}
          onSelect={setActiveFacetId}
        />
      ) : (
        <motion.div
          layout={blockLayout}
          transition={transition}
          className="app-range-seg app-filter-facet-grid"
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
              currencyOptions={draft.getFacetOptions('currency')}
              currencyValue={draft.currencyLocked ? draft.amountCurrency : draft.selections.currency[0] ?? ''}
              currencyLocked={draft.currencyLocked}
              dateRange={draft.dateRange}
              fillHeight={fillHeight}
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
        <p className="mt-2 px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          Transactions must match every filter you apply
        </p>
      </motion.div>

      {showFooter && (
        <motion.div layout={blockLayout} transition={transition} className="mt-3 flex items-center justify-between">
          <button
            type="button"
            className="text-xs"
            style={{ color: 'var(--app-text-muted)' }}
            disabled={draft.activeFacetCount === 0}
            onClick={draft.clearAll}
          >
            Clear all
          </button>
          <button type="button" className="app-glass-button-primary" onClick={draft.applyFilters}>
            Apply filters
          </button>
        </motion.div>
      )}
    </div>
  )
}

type MobileFacetSelectProps = {
  activeFacetId: string
  countFacet: (facet: FacetConfig) => number
  disabledFacetIds: Set<string>
  onSelect: (facetId: string) => void
}

/**
 * Renders the facet picker as a dropdown for the mobile full-screen panel, where the facet tab grid
 * is too cramped. The menu keeps the per-facet active-filter counts so the user can still tell which
 * facets carry filters without opening each one, and greys out any facet that is disabled
 */
function MobileFacetSelect({ activeFacetId, countFacet, disabledFacetIds, onSelect }: MobileFacetSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeFacet = FILTER_FACETS.find((facet) => facet.id === activeFacetId) ?? FILTER_FACETS[0]
  const ActiveIcon = activeFacet.icon
  const activeCount = countFacet(activeFacet)

  // Close the menu on a pointer down outside it, so a tap on the editor below dismisses the menu
  // without also closing the whole modal
  useEffect(() => {
    if (!open) return undefined

    function closeOnOutsidePointer(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="app-input flex w-full items-center justify-between gap-2"
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ActiveIcon size={16} aria-hidden className="shrink-0" />
          <span className="truncate">{activeFacet.label}</span>
          {activeCount > 0 && <FacetCountBadge count={activeCount} />}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className="shrink-0 transition-transform duration-150"
          style={{ transform: open ? 'rotate(180deg)' : 'none', color: 'var(--app-text-subtle)' }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-[60vh] overflow-auto rounded-xl py-1"
            style={{
              background: 'var(--app-input-bg)',
              border: '1px solid var(--app-border-strong)',
              boxShadow: 'var(--app-shadow-soft)',
              backdropFilter: 'blur(16px)',
            }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {FILTER_FACETS.map((facet) => {
              const FacetIcon = facet.icon
              const facetCount = countFacet(facet)
              const isActive = facet.id === activeFacetId
              const isDisabled = disabledFacetIds.has(facet.id)
              return (
                <li
                  key={facet.id}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={isDisabled}
                  className={joinClassNames('flex items-center gap-2 px-4 py-2.5 text-sm transition-colors', isDisabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--app-accent-soft)]')}
                  style={{ ...getFilterOptionStyle(isActive), opacity: isDisabled ? 0.4 : 1 }}
                  onClick={() => {
                    if (isDisabled) return
                    onSelect(facet.id)
                    setOpen(false)
                  }}
                >
                  <FacetIcon size={16} aria-hidden className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{facet.label}</span>
                  {!isDisabled && facetCount > 0 && <FacetCountBadge count={facetCount} />}
                  {isActive && <Check size={15} aria-hidden className="shrink-0" />}
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Renders the small accent pill showing how many filters a facet currently holds
 */
function FacetCountBadge({ count }: { count: number }) {
  return (
    <span
      className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium"
      style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
    >
      {count}
    </span>
  )
}

/**
 * Renders one labelled date field with an overlaid calendar glyph. The iOS picker's Clear button
 * empties the value without firing any input or change event, so the value is also synced on blur
 * when the picker dismisses, which is the one signal that fires after a clear
 */
function DateFacetInput({
  label,
  value,
  onValueChange,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Holds the latest callback so the native listeners stay bound once while still seeing fresh state
  const onValueChangeRef = useRef(onValueChange)

  useEffect(() => {
    onValueChangeRef.current = onValueChange
  })

  useEffect(() => {
    const input = inputRef.current
    if (!input) return undefined

    const syncValue = () => onValueChangeRef.current(input.value)
    input.addEventListener('change', syncValue)
    input.addEventListener('blur', syncValue)
    return () => {
      input.removeEventListener('change', syncValue)
      input.removeEventListener('blur', syncValue)
    }
  }, [])

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
      {label}
      <div className="relative">
        <input
          ref={inputRef}
          type="date"
          className="app-input app-date-input-balanced pr-9"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <Calendar
          size={15}
          aria-hidden
          className="app-date-overlay-icon pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--app-text-subtle)' }}
        />
      </div>
    </label>
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
  // The currency the amount range matches, chosen inside the amount section
  currencyOptions: OptionItem[]
  currencyValue: string
  // True on an account's own list, where the currency is pinned to the account and cannot be changed
  currencyLocked: boolean
  dateRange: { from: string; to: string }
  fillHeight: boolean
  onToggle: (value: string, label?: string) => void
  onCurrencyToggle: (value: string) => void
  onTagMatchChange: (value: 'all' | 'any') => void
  onAmountChange: (value: AmountDraft) => void
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
  currencyOptions,
  currencyValue,
  currencyLocked,
  dateRange,
  fillHeight,
  onToggle,
  onCurrencyToggle,
  onTagMatchChange,
  onAmountChange,
  onDateRangeChange,
}: FacetEditorProps) {
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
                  type="text"
                  inputMode="decimal"
                  className={joinClassNames('app-input', amountSymbol && 'pl-8')}
                  placeholder="0.00"
                  value={formatMoneyInputLive(amount.min)}
                  onChange={(event) => onAmountChange({ ...amount, min: sanitizeMoneyInput(event.target.value) })}
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
                  type="text"
                  inputMode="decimal"
                  className={joinClassNames('app-input', amountSymbol && 'pl-8')}
                  placeholder="Any"
                  value={formatMoneyInputLive(amount.max)}
                  onChange={(event) => onAmountChange({ ...amount, max: sanitizeMoneyInput(event.target.value) })}
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
      <div className="flex items-end gap-2">
        <DateFacetInput
          label="From"
          value={dateRange.from}
          onValueChange={(value) => onDateRangeChange({ ...dateRange, from: value })}
        />
        <span className="pb-2.5 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          to
        </span>
        <DateFacetInput
          label="To"
          value={dateRange.to}
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
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={isActive}
                    className={joinClassNames('app-range-seg-option', isActive && 'app-range-seg-option-active')}
                    style={isActive ? { background: 'var(--app-input-bg)', boxShadow: '0 1px 2px #00000014, inset 0 1px 0 color-mix(in srgb, white 28%, transparent)' } : undefined}
                    onClick={() => onTagMatchChange(mode)}
                  >
                    <span className="app-range-seg-label">{mode === 'all' ? 'All' : 'Any'}</span>
                  </button>
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
    ? [{ key: 'amount', label: `${amountSymbol}${formatMoneyInputLive(amount.min) || '0'}–${formatMoneyInputLive(amount.max) || 'any'}`, onRemove: onClearAmount }]
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
