import { useRef, useState } from 'react'
import { EyeOff } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { CollapsibleSection, CollapsibleSectionCount } from '@/components/collapsible-section/Section'
import AccountRow from '@/pages/accounts/components/Row'

const ARCHIVED_ACCOUNTS_SCROLL_OFFSET_PX = 24

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
 * Renders archived accounts behind a collapsible section and scrolls the list into view once it finishes expanding
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
  const sectionRef = useRef<HTMLElement>(null)
  const prefersReducedMotion = useReducedMotion()

  if (accounts.length === 0) return null

  return (
    <section ref={sectionRef}>
      <CollapsibleSection
        icon={EyeOff}
        label="Archived accounts"
        summary={<CollapsibleSectionCount count={accounts.length} />}
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
        opensInstantly
        onExpandComplete={() => {
          if (sectionRef.current) scrollArchivedAccountsIntoView(sectionRef.current, prefersReducedMotion)
        }}
      >
        <div className="pt-1">
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
      </CollapsibleSection>
    </section>
  )
}
