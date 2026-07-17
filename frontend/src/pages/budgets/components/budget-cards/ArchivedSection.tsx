import { useEffect, useRef, useState } from 'react'
import { ChevronDown, EyeOff } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { BudgetUtilization } from '@/api/budgets'
import BudgetCard from '@/pages/budgets/components/budget-card/Card'
import { EASE } from '@/pages/budgets/constants'
import type { BudgetCardViewModel } from '@/pages/budgets/types'

const ARCHIVED_BUDGETS_SCROLL_OFFSET_PX = 24
const ARCHIVED_BUDGETS_TRANSITION_SECONDS = 0.24

// Matches the mt-6 spacing the section used before its appearance became animated
const ARCHIVED_SECTION_MARGIN_TOP_PX = 24
const ARCHIVED_SECTION_APPEAR_SECONDS = 0.28

/**
 * Scrolls the archived section near the top of the viewport while the page bottom clamps the target
 */
function scrollArchivedBudgetsIntoView(section: HTMLElement, prefersReducedMotion: boolean | null) {
  const sectionTop = section.getBoundingClientRect().top + window.scrollY
  const maxScrollTop = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0)
  const targetTop = Math.min(Math.max(sectionTop - ARCHIVED_BUDGETS_SCROLL_OFFSET_PX, 0), maxScrollTop)

  window.scrollTo({
    top: targetTop,
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
  })
}

type BudgetArchivedSectionProps = {
  budgetCards: BudgetCardViewModel[]
  latestUtilizationByBudgetId: Map<string, BudgetUtilization>
  onOpenBudget: (budget: BudgetCardViewModel) => void
}

/**
 * Renders archived budgets behind a collapsible section and scrolls the expanded grid into view
 *
 * The caller mounts this inside AnimatePresence, so its own appearance easing plays when the first budget
 * is archived and its exit easing plays when the last budget is unarchived
 */
export default function BudgetArchivedSection({
  budgetCards,
  latestUtilizationByBudgetId,
  onOpenBudget,
}: BudgetArchivedSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [cardsMounted, setCardsMounted] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (!expanded) return

    const animationFrameId = window.requestAnimationFrame(() => {
      const section = sectionRef.current
      if (!section) return

      scrollArchivedBudgetsIntoView(section, prefersReducedMotion)
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [expanded, prefersReducedMotion])

  /**
   * Toggles archived cards while keeping closing cards mounted until their height animation finishes
   */
  function toggleExpanded() {
    if (expanded) {
      setExpanded(false)
      return
    }

    setCardsMounted(true)
    setExpanded(true)
  }

  /**
   * Removes collapsed cards after their closing height animation finishes
   */
  function handleCollapseComplete() {
    if (expanded) return

    setCardsMounted(false)
  }

  return (
    <motion.section
      ref={sectionRef}
      className="overflow-hidden"
      initial={{ height: 0, opacity: 0, marginTop: 0 }}
      animate={{ height: 'auto', opacity: 1, marginTop: ARCHIVED_SECTION_MARGIN_TOP_PX }}
      exit={{ height: 0, opacity: 0, marginTop: 0 }}
      transition={{
        duration: prefersReducedMotion ? 0 : ARCHIVED_SECTION_APPEAR_SECONDS,
        ease: EASE,
      }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:text-[var(--app-text)]"
        style={{
          borderTop: '1px solid var(--app-border)',
          color: 'var(--app-text-muted)',
        }}
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        <EyeOff size={16} aria-hidden />
        <span className="font-medium">Archived budgets</span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ background: 'var(--app-accent-soft)' }}
        >
          {budgetCards.length}
        </span>
        <ChevronDown
          size={16}
          className={`ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      <motion.div
        className="grid overflow-hidden"
        initial={false}
        animate={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
        }}
        transition={{
          duration: prefersReducedMotion ? 0 : ARCHIVED_BUDGETS_TRANSITION_SECONDS,
          ease: EASE,
        }}
        aria-hidden={!expanded}
        inert={!expanded}
        onAnimationComplete={handleCollapseComplete}
      >
        {cardsMounted && (
          <div className="min-h-0 overflow-hidden pt-1">
            <div className="app-budget-grid">
              {budgetCards.map((budgetCard) => {
                const { baseBudget, latestPeriod, categoryNames } = budgetCard

                return (
                  <BudgetCard
                    key={baseBudget.id}
                    baseBudget={baseBudget}
                    latestPeriod={latestPeriod}
                    categoryNames={categoryNames}
                    utilization={latestPeriod ? latestUtilizationByBudgetId.get(latestPeriod.id) : undefined}
                    isArchived
                    onOpen={() => onOpenBudget(budgetCard)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </motion.div>
    </motion.section>
  )
}
