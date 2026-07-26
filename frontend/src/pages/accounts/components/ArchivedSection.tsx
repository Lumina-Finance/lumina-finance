import { useEffect, useRef, useState } from 'react'
import { ChevronDown, EyeOff } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import AccountRow from '@/pages/accounts/components/Row'

const ARCHIVED_ACCOUNTS_EASE = [0.25, 0.1, 0.25, 1] as const
const ARCHIVED_ACCOUNTS_SCROLL_OFFSET_PX = 24
const ARCHIVED_ACCOUNTS_TRANSITION_SECONDS = 0.24

/**
 * Scrolls the archived section near the top of the viewport while allowing the page bottom to clamp the target
 */
function scrollArchivedAccountsIntoView(section: HTMLElement, prefersReducedMotion: boolean | null) {
  const sectionTop = section.getBoundingClientRect().top + window.scrollY
  const maxScrollTop = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0)
  const targetTop = Math.min(Math.max(sectionTop - ARCHIVED_ACCOUNTS_SCROLL_OFFSET_PX, 0), maxScrollTop)

  window.scrollTo({
    top: targetTop,
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
  })
}

/**
 * Renders archived accounts behind a collapsible section and scrolls the expanded list into view
 */
export default function ArchivedAccountsSection({
  accounts,
  taxAdvantagedCategoryById,
  displayCurrency,
}: {
  accounts: AccountsOverview[]
  taxAdvantagedCategoryById: Map<string, TaxAdvantagedCategory>
  displayCurrency: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [rowsMounted, setRowsMounted] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (!expanded) return

    const animationFrameId = window.requestAnimationFrame(() => {
      const section = sectionRef.current
      if (!section) return

      scrollArchivedAccountsIntoView(section, prefersReducedMotion)
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [expanded, prefersReducedMotion])

  /**
   * Toggles archived rows while keeping closing rows mounted until their height animation finishes
   */
  function toggleExpanded() {
    if (expanded) {
      setExpanded(false)
      return
    }

    setRowsMounted(true)
    setExpanded(true)
  }

  /**
   * Removes collapsed rows after their closing height animation finishes
   */
  function handleListAnimationComplete() {
    if (expanded) return

    setRowsMounted(false)
  }

  if (accounts.length === 0) return null

  return (
    <section ref={sectionRef}>
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
        <span className="font-medium">Archived accounts</span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ background: 'var(--app-accent-soft)' }}
        >
          {accounts.length}
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
          duration: prefersReducedMotion || expanded ? 0 : ARCHIVED_ACCOUNTS_TRANSITION_SECONDS,
          ease: ARCHIVED_ACCOUNTS_EASE,
        }}
        aria-hidden={!expanded}
        inert={!expanded}
        onAnimationComplete={handleListAnimationComplete}
      >
        {rowsMounted && (
          <div className="min-h-0 overflow-hidden pt-1">
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                accent={account.account_kind === 'asset' ? 'positive' : 'negative'}
                showCreditLimit={account.account_kind === 'revolving'}
                taxAdvantagedCategoryById={taxAdvantagedCategoryById}
                displayCurrency={displayCurrency}
                isArchived
              />
            ))}
          </div>
        )}
      </motion.div>
    </section>
  )
}
