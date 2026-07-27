import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getFilterOptionStyle } from '@/components/filters/optionAppearance'
import { joinClassNames } from '@/utils/classNames'

// Stable empty set so a caller with no disabled facets never allocates one each render
const NO_DISABLED_FACET_IDS = new Set<string>()

export type FacetSelectOption = {
  id: string
  label: string
  icon: LucideIcon
}

type FacetSelectDropdownProps<Facet extends FacetSelectOption> = {
  facets: Facet[]
  activeFacetId: Facet['id']
  countFacet: (facet: Facet) => number
  // Facet ids the caller has scoped away, greyed out and inert in the menu
  disabledFacetIds?: Set<string>
  onSelect: (facetId: Facet['id']) => void
}

/**
 * Renders the facet picker as a dropdown for a mobile full-screen filter panel, where the facet tab
 * grid is too cramped. The menu keeps the per-facet active-filter counts so the user can still tell
 * which facets carry filters without opening each one, and greys out any facet the caller marks
 * disabled. Shared by the account and transaction filter panels, which pass their own facet list and
 * counting function
 */
export function FacetSelectDropdown<Facet extends FacetSelectOption>({
  facets,
  activeFacetId,
  countFacet,
  disabledFacetIds = NO_DISABLED_FACET_IDS,
  onSelect,
}: FacetSelectDropdownProps<Facet>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeFacet = facets.find((facet) => facet.id === activeFacetId) ?? facets[0]
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
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-[60vh] overflow-auto rounded-xl"
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
            {facets.map((facet) => {
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
