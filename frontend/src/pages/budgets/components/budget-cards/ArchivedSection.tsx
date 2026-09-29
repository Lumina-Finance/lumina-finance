import { useRef, useState } from 'react'
import { EyeOff } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { BudgetUtilization } from '@/api/budgets'
import { CollapsibleSection, CollapsibleSectionCount } from '@/components/collapsible-section/Section'
import BudgetCard from '@/pages/budgets/components/budget-card/Card'
import { EASE } from '@/pages/budgets/constants'
import type { BudgetCardViewModel } from '@/pages/budgets/types'

const ARCHIVED_BUDGETS_SCROLL_OFFSET_PX = 24

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
 * Renders archived budgets behind a collapsible section and scrolls the grid into view once it finishes expanding
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
  const sectionRef = useRef<HTMLElement>(null)
  const prefersReducedMotion = useReducedMotion()

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
      <CollapsibleSection
        icon={EyeOff}
        label="Archived budgets"
        summary={<CollapsibleSectionCount count={budgetCards.length} />}
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
        onExpandComplete={() => {
          if (sectionRef.current) scrollArchivedBudgetsIntoView(sectionRef.current, prefersReducedMotion)
        }}
      >
        <div className="app-budget-grid pt-1">
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
      </CollapsibleSection>
    </motion.section>
  )
}
