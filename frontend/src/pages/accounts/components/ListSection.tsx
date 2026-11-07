import { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { GroupMark } from '@/pages/accounts/components/GroupMark'
import { InstitutionMark } from '@/pages/accounts/components/InstitutionMark'
import AccountRow from '@/pages/accounts/components/Row'
import { TaxAdvantagedTag } from '@/pages/accounts/components/TaxAdvantagedTag'
import { getRegroupTransition } from '@/pages/accounts/components/regroupMotion'
import {
  getAccountRowMeta,
  getGroupDots,
  getGroupPlanNames,
  isGroupOpen,
  type AccountGroup,
  type AccountGrouping,
} from '@/pages/accounts/utils/accountGroups'

const ACCOUNT_ROW_EASE = [0.25, 0.1, 0.25, 1] as const

// How many bank logos the stack under a group's name shows before it counts the rest
const LOGO_STACK_LIMIT = 5

/**
 * Renders one small dot per account in a group, red for an account with a negative balance
 */
function AccountDots({ members, isTopLevel }: { members: AccountsOverview[]; isTopLevel: boolean }) {
  return (
    // Left off a phone, where the header already shows the count beside the total
    <span data-account-dots className="hidden shrink-0 items-center gap-[3px] min-[750px]:flex" aria-hidden>
      {getGroupDots(members).map((dot) => (
        <span
          key={dot.id}
          className={`rounded-full ${isTopLevel ? 'h-2 w-2' : 'h-[7px] w-[7px]'}`}
          style={{ background: dot.isNegative ? 'var(--app-negative)' : 'var(--app-text-subtle)' }}
        />
      ))}
    </span>
  )
}

/**
 * Renders the accounts of a group that are held at one bank or another as a small overlapping stack
 * of logos, with the rest counted
 */
function LogoStack({ members, isTopLevel }: { members: AccountsOverview[]; isTopLevel: boolean }) {
  const institutions = [
    ...new Map(members.flatMap((a) => (a.institution ? [[a.institution.id, a.institution]] : []))).values(),
  ]
  if (institutions.length === 0) return null
  const shown = institutions.slice(0, LOGO_STACK_LIMIT)
  const rest = institutions.length - shown.length

  return (
    <span className="flex shrink-0 items-center">
      <span className="flex -space-x-1.5">
        {shown.map((institution) => (
          <InstitutionMark key={institution.id} institution={institution} size={isTopLevel ? 'stack' : 'small'} />
        ))}
      </span>
      {rest > 0 && (
        <span className={`ml-1 ${isTopLevel ? 'text-[14.5px]' : 'text-sm'}`} style={{ color: 'var(--app-text-muted)' }}>
          +{rest}
        </span>
      )}
    </span>
  )
}

/**
 * Renders one account group as a collapsible row: its mark, name, account count and total, with the
 * accounts listed under it while it is open
 */
export default function AccountListSection({
  group,
  grouping,
  thenBy,
  outerGroupings = [],
  parentKey = '',
  toggledKeys,
  keepExpanded,
  onToggle,
  showLogos,
  displayCurrency,
  taxAdvantagedCategoryById,
  loading = false,
  stickyTop,
}: {
  group: AccountGroup
  grouping: AccountGrouping
  // The grouping of the sub-groups under this group, when the list is grouped two levels deep
  thenBy: AccountGrouping | null
  // The groupings of the levels above this one. Its rows leave them out of their second line
  outerGroupings?: AccountGrouping[]
  // The path of the groups above this one. It keeps a sub-group's open state apart from the same
  // sub-group under another group
  parentKey?: string
  // The groups the user flipped by hand. That choice wins over the default the next switch sets
  toggledKeys: ReadonlySet<string>
  // The default for the top level: open when on, folded when off. Sub-groups always start folded
  keepExpanded: boolean
  onToggle: (key: string) => void
  showLogos: boolean
  displayCurrency: string
  taxAdvantagedCategoryById: Map<string, TaxAdvantagedCategory>
  loading?: boolean
  // Where the list toolbar ends once it sticks. A top-level header given it sticks there while its open
  // group's rows scroll past, as a day's total does on the transactions list
  stickyTop?: number
}) {
  const prefersReducedMotion = useReducedMotion()
  const regroupTransition = getRegroupTransition(prefersReducedMotion)
  const { formatCurrency } = useMoneyFormatters()
  const levels = [...outerGroupings, grouping]
  const key = parentKey ? `${parentKey}/${group.id}` : group.id
  // The default opens the top level only, so a sub-group starts closed under an open group
  const isTopLevel = parentKey === ''
  // The empty list's placeholder always shows its message
  const isOpen = group.members.length === 0 || isGroupOpen({ key, isTopLevel, keepExpanded, toggledKeys })
  const bodyId = `account-group-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const count = group.members.length
  // A bank's header carries the tags its accounts' rows carry, once each, in the order the rows list
  // them. Only a top-level bank gets them, and the rows keep theirs as well
  const planNames = isTopLevel && grouping === 'institution' ? getGroupPlanNames(group, taxAdvantagedCategoryById) : []
  const sectionRef = useRef<HTMLElement>(null)
  const isSticky = isTopLevel && stickyTop !== undefined

  // Closing from a stuck header would leave it above the screen once the rows go. So the page first
  // scrolls back to the group's start, and the stuck header stays where it is on screen
  function handleToggle() {
    if (
      isOpen &&
      isTopLevel &&
      stickyTop !== undefined &&
      (sectionRef.current?.getBoundingClientRect().top ?? 0) < stickyTop
    ) {
      sectionRef.current?.scrollIntoView({ block: 'start' })
    }
    onToggle(key)
  }

  return (
    // Never a scroll anchor, so the browser doesn't move the page to hold a row in place while the group
    // closes. That move would push its header back under the toolbar
    <section ref={sectionRef} style={isSticky ? { scrollMarginTop: stickyTop, overflowAnchor: 'none' } : undefined}>
      {/* The page's colour behind a stuck header hides the rows scrolling under it */}
      <h3
        className={isSticky ? 'sticky z-20' : undefined}
        style={isSticky ? { top: stickyTop, background: 'var(--app-bg)' } : undefined}
      >
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={handleToggle}
          // On a phone the title takes the whole first line beside the chevron, and the total moves to the
          // second line beside the account count, so a long name never gives way to the figure. The right
          // inset matches the rows', so the total ends where their balances do
          className="app-focus-inset relative grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl py-3 pr-2 text-left min-[750px]:flex min-[750px]:pr-0"
        >
          <span className="row-span-2 flex shrink-0">
            <GroupMark group={group} grouping={grouping} showLogos={showLogos} isTopLevel={isTopLevel} />
          </span>
          <span className="contents min-[750px]:block min-[750px]:min-w-0 min-[750px]:flex-1">
            {/* Spans the total's column too, leaving the chevron its room at the end */}
            <span className="col-span-2 col-start-2 row-start-1 flex min-w-0 items-center gap-2 pr-7 min-[750px]:pr-0">
              <span
                className={`block min-w-0 truncate font-serif font-semibold ${
                  isTopLevel
                    ? 'text-xl leading-6 min-[750px]:text-[21px] min-[750px]:leading-7'
                    : 'text-lg leading-6 min-[750px]:text-xl'
                }`}
                title={group.title}
              >
                {group.title}
              </span>
              {planNames.length > 0 && (
                // Left to the rows on a phone, where the title would lose its room beside them
                <span className="hidden min-w-0 shrink-[2] items-center gap-2 overflow-hidden min-[640px]:flex">
                  {planNames.map((name) => (
                    <TaxAdvantagedTag key={name} name={name} />
                  ))}
                </span>
              )}
            </span>
            <span className="col-start-2 row-start-2 mt-0.5 flex min-w-0 items-center gap-2">
              {grouping === 'institution' ? (
                <AccountDots members={group.members} isTopLevel={isTopLevel} />
              ) : (
                // A sub-group under a bank holds only that bank's accounts, and the bank's header above already
                // carries its logo
                showLogos &&
                !outerGroupings.includes('institution') && <LogoStack members={group.members} isTopLevel={isTopLevel} />
              )}
              <span
                className={`shrink-0 ${isTopLevel ? 'text-[14.5px] max-[750px]:text-sm' : 'text-sm'}`}
                style={{ color: 'var(--app-text-muted)' }}
              >
                {count} {count === 1 ? 'account' : 'accounts'}
              </span>
            </span>
          </span>
          <span
            className="font-financial col-start-3 row-start-2 mt-0.5 flex shrink-0 items-center justify-self-end text-base font-semibold min-[750px]:mt-0 min-[750px]:min-h-7 min-[750px]:text-lg"
            style={{ color: loading || group.subtotal >= 0 ? 'var(--app-text)' : 'var(--app-negative)' }}
          >
            {loading ? (
              <span className="app-spinner" aria-label={`Loading ${group.title.toLowerCase()} total`} />
            ) : (
              formatCurrency(group.subtotal, displayCurrency)
            )}
          </span>
          <ChevronDown
            size={18}
            className={`col-start-3 row-start-1 shrink-0 justify-self-end transition-transform ${isOpen ? 'rotate-180' : ''}`}
            style={{ color: 'var(--app-text-subtle)' }}
            aria-hidden
          />
          {/* An open top-level group's guide line starts at its mark's bottom edge. The mark sits at the
              header's middle, so the line starts half the mark below it and runs on into the body */}
          {isTopLevel && isOpen && (
            <span
              aria-hidden
              data-group-guide
              className="absolute bottom-0 left-4 top-[calc(50%+1rem)] w-px -translate-x-1/2 min-[750px]:left-[19px] min-[750px]:top-[calc(50%+19px)]"
              style={{ background: 'var(--app-border)' }}
            />
          )}
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={bodyId}
            key="body"
            // Clipped only while it opens or closes, so a row gliding in from another group is not
            // cut off at the edge of this one
            style={{ overflow: 'hidden' }}
            initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: ACCOUNT_ROW_EASE }}
          >
            {/* Indented to line up with the name beside the mark. The top level draws the mark larger,
                and a phone draws both smaller */}
            <div
              className={`relative pb-3 ${isTopLevel ? 'pl-11 min-[750px]:pl-[3.125rem]' : 'pl-10 min-[750px]:pl-12'}`}
            >
              {/* The top level's guide line, carried on from under its mark down the whole open group */}
              {isTopLevel && (
                <span
                  aria-hidden
                  data-group-guide
                  // Ends with the last row, above the body's bottom padding
                  className="absolute top-0 bottom-3 left-4 w-px -translate-x-1/2 min-[750px]:left-[19px]"
                  style={{ background: 'var(--app-border)' }}
                />
              )}
              {loading && (
                <div className="flex min-h-[4.625rem] items-center justify-center">
                  <div className="app-spinner" aria-label={`Loading ${group.title.toLowerCase()} accounts`} />
                </div>
              )}
              {!loading && group.children.length > 0 && (
                <AnimatePresence initial={false} mode="popLayout">
                  {group.children.map((child) => (
                    <motion.div
                      key={`${thenBy}:${child.id}`}
                      // The divider sits on the wrapper, and the first sub-group's wrapper is the body's
                      // first div, after the guide line's span, so it draws none. A phone spaces them apart
                      // with no line
                      className="border-t first-of-type:border-t-0 max-[750px]:border-t-0"
                      style={{ borderColor: 'var(--app-border)' }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={regroupTransition}
                    >
                      <AccountListSection
                        group={child}
                        grouping={thenBy ?? grouping}
                        thenBy={null}
                        outerGroupings={levels}
                        parentKey={key}
                        toggledKeys={toggledKeys}
                        keepExpanded={keepExpanded}
                        onToggle={onToggle}
                        showLogos={showLogos}
                        displayCurrency={displayCurrency}
                        taxAdvantagedCategoryById={taxAdvantagedCategoryById}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              {!loading && group.children.length === 0 && group.rows.length === 0 && (
                <p className="py-6 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
                  {group.emptyLabel}
                </p>
              )}
              {!loading &&
                group.children.length === 0 &&
                group.rows.map((account) => (
                  // The shared id lets a row glide from its old group to its new one when the grouping
                  // changes
                  <motion.div
                    key={account.id}
                    layout="position"
                    layoutId={`account-row-${account.id}`}
                    // Keeps a modal's scroll lock from sliding the rows, as the list's rows were on main
                    layoutDependency={group.rows}
                    // A sub-group's rows start under its title. A row's own padding would put them 8px
                    // right of it, so the row reaches back over that padding and its hover fill with it.
                    // A hairline between rows marks where each account starts, none above the first. A phone
                    // leaves it out and lets the space between rows do that
                    className={`border-t first-of-type:border-t-0 max-[750px]:border-t-0 ${isTopLevel ? '' : '-ml-2'}`}
                    style={{ borderColor: 'var(--app-border)' }}
                    transition={regroupTransition}
                  >
                    <AccountRow
                      account={account}
                      accent={account.account_kind === 'asset' ? 'positive' : 'negative'}
                      showCreditLimit={account.account_kind === 'revolving'}
                      taxAdvantagedCategoryById={taxAdvantagedCategoryById}
                      displayCurrency={displayCurrency}
                      isBare
                      // A bank's own header already carries its logo, so its rows leave it out
                      showBankLogo={showLogos && !levels.includes('institution')}
                      meta={getAccountRowMeta(account, levels)}
                    />
                  </motion.div>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
