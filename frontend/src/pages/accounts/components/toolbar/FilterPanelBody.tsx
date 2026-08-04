import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { MultiSelectChecklist } from '@/components/filters/MultiSelectChecklist'
import { FacetSelectDropdown } from '@/components/list-controls/FacetSelectDropdown'
import { FILTER_GLASS_SPRING } from '@/components/list-controls/toolbarStyles'
import { joinClassNames } from '@/utils/classNames'
import {
  FILTER_FACETS,
  type AccountFilterDraft,
  type FacetConfig,
  type FacetId,
  type FacetSelections,
} from '@/pages/accounts/components/toolbar/useAccountFilterDraft'

// The three account facets sit in a single segmented row on desktop, half the width of the six
// transaction facets, so the tabs are laid out three across
const FACET_GRID_COLUMNS = 'repeat(3, minmax(0, 1fr))'

/**
 * Renders the shared filter panel body: the facet tabs, the active facet checklist, the removable
 * active-filter chips, and the apply and clear actions, driven by the shared draft
 */
export function FilterPanelBody({
  draft,
  showFooter = true,
  mobile = false,
  fillHeight = false,
}: {
  draft: AccountFilterDraft
  showFooter?: boolean
  // Swaps the cramped facet tab grid for a dropdown, only used by the mobile full-screen sheet
  mobile?: boolean
  // Lets the facet checklist grow to fill its container with the list scrolling internally, used by
  // the mobile sheet and the desktop panel once the panel opens to a fixed height
  fillHeight?: boolean
}) {
  const [activeFacetId, setActiveFacetId] = useState<FacetId>(FILTER_FACETS[0].id)
  // Scopes the sliding-thumb layout animation to this instance
  const segId = useId()
  const shouldReduceMotion = useReducedMotion()
  const transition = shouldReduceMotion ? { duration: 0 } : FILTER_GLASS_SPRING
  const activeFacet = FILTER_FACETS.find((facet) => facet.id === activeFacetId) ?? FILTER_FACETS[0]

  // The desktop panel keeps the position springs so the summary divider and the blocks below it
  // glide when the checklist resizes. The mobile sheet runs inside a scroll area where those springs
  // fight the flex sizing, so they are turned off there
  const blockLayout = mobile ? false : 'position'

  return (
    <div className={joinClassNames('contents', fillHeight && '!flex min-h-0 flex-1 flex-col')}>
      {mobile ? (
        <FacetSelectDropdown
          facets={FILTER_FACETS}
          activeFacetId={activeFacetId}
          countFacet={draft.countFacet}
          onSelect={setActiveFacetId}
        />
      ) : (
        <motion.div
          layout={blockLayout}
          transition={transition}
          className="app-range-seg"
          style={{ gridTemplateColumns: FACET_GRID_COLUMNS }}
          role="tablist"
          aria-label="Filter facets"
        >
          {FILTER_FACETS.map((facet) => {
            const FacetIcon = facet.icon
            const facetCount = draft.countFacet(facet)
            const isActive = facet.id === activeFacetId
            return (
              <motion.button
                key={facet.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
                className={joinClassNames('app-range-seg-option', isActive && 'app-range-seg-option-active')}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                onClick={() => setActiveFacetId(facet.id)}
              >
                {isActive && <motion.span layoutId={`${segId}-facet`} className="app-range-seg-thumb" transition={transition} />}
                <span className="app-range-seg-label" style={{ display: 'inline-flex' }}>
                  <FacetIcon size={16} aria-hidden />
                </span>
                <span className="app-range-seg-label" style={{ fontSize: '0.625rem' }}>
                  {facet.label}
                </span>
                {facetCount > 0 && (
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
            <FacetChecklist
              facet={activeFacet}
              options={draft.getFacetOptions(activeFacet.id)}
              selectedValues={draft.selections[activeFacet.id]}
              fillHeight={fillHeight}
              onToggle={(value) => draft.toggleSelection(activeFacet.id, value)}
            />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <motion.div layout={blockLayout} transition={transition}>
        <ActiveFilterSummary
          selections={draft.selections}
          getFacetOptions={draft.getFacetOptions}
          onRemoveSelection={draft.toggleSelection}
        />
      </motion.div>

      <motion.div layout={blockLayout} transition={transition}>
        <p className="mt-2 px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          Accounts must match every filter you apply
        </p>
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
          <button type="button" className="app-glass-button-primary" onClick={draft.applyFilters}>
            Apply filters
          </button>
        </motion.div>
      )}
    </div>
  )
}

type FacetChecklistProps = {
  facet: FacetConfig
  options: OptionItem[]
  selectedValues: string[]
  fillHeight: boolean
  onToggle: (value: string) => void
}

/**
 * Renders the checklist for the active facet, showing an empty note when the account list offers no
 * values for it
 */
function FacetChecklist({ facet, options, selectedValues, fillHeight, onToggle }: FacetChecklistProps) {
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
  selections: FacetSelections
  getFacetOptions: (facetId: FacetId) => OptionItem[]
  onRemoveSelection: (facetId: FacetId, value: string) => void
}

/**
 * Renders the removable chips for every live selection across all facets, so the full filter state
 * stays visible while only one facet checklist shows at a time
 */
function ActiveFilterSummary({ selections, getFacetOptions, onRemoveSelection }: ActiveFilterSummaryProps) {
  const chips = (Object.entries(selections) as [FacetId, string[]][]).flatMap(([facetId, values]) =>
    values.map((value) => {
      const label = getFacetOptions(facetId).find((option) => option.value === value)?.label ?? value
      return { key: `${facetId}:${value}`, label, onRemove: () => onRemoveSelection(facetId, value) }
    }),
  )

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
