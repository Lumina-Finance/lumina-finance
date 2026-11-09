import { useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, ChevronRight, CircleHelp, CornerDownRight } from 'lucide-react'
import { Link } from 'react-router'
import type { BankConnection, ConnectionBankAccount } from '@/api/bank-sync'
import MarqueeText from '@/components/display/MarqueeText'
import { SyncStatusDot } from '@/components/display/SyncStatusDot'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { CONTENT_EASE_CURVE } from '@/utils/widthEase'
import {
  describeLinkingHeld,
  describeMismatch,
  describeOverLimit,
  groupInstitutions,
  matchesInstitutionSearch,
  matchesSearch,
  type AccountNameLookup,
} from '@/pages/settings/components/bank-connections-section/utils'
import { providerSiteName } from '@/utils/bankSync'

// On phones the bank account spans the row, with the arrow and the account under it. From tablets up
// the three sit side by side
const MAPPING_ROW_CLASS =
  'grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 py-2.5 min-[750px]:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] min-[750px]:gap-3'
const MAPPING_SOURCE_CLASS = 'col-span-2 min-w-0 text-sm min-[750px]:col-span-1'
const TILE_CLASS = 'flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg px-3 text-sm'

// Shown in place of an account whose name hasn't loaded yet
const ACCOUNT_FALLBACK_NAME = 'Account'

/**
 * Points from the bank account to its account: turning in from under the bank account on phones, and
 * across between the two from tablets up
 */
function MappingArrow({ muted = false }: { muted?: boolean }) {
  const style = { color: muted ? 'var(--app-border-strong)' : 'var(--app-text-subtle)' }
  return (
    <>
      <CornerDownRight size={16} aria-hidden className="min-[750px]:hidden" style={style} />
      <ArrowRight size={16} aria-hidden className="hidden min-[750px]:block" style={style} />
    </>
  )
}

/**
 * The account a bank account keeps up to date, as a tile that opens it
 */
function LinkedAccountTile({ accountId, name }: { accountId: string; name: string }) {
  return (
    <Link
      to={`/accounts/${accountId}`}
      className={`${TILE_CLASS} font-medium transition-colors hover:bg-[var(--app-accent-soft)]`}
      style={{ background: 'var(--app-surface-soft)', color: 'var(--app-text)' }}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ChevronRight size={15} aria-hidden className="shrink-0" style={{ color: 'var(--app-text-subtle)' }} />
    </Link>
  )
}

type BankAccountRowProps = {
  bankAccount: ConnectionBankAccount

  /**
   * Set when its institution would go over the limit. The server then offers no account for it, so the
   * row keeps its disabled dropdown, rather than saying no account could take it
   */
  overLimit: boolean

  /** Why linking is held. It fades the dropdown and gives it this reason. Undefined when it can be used */
  heldReason: string | undefined

  /** Set once the link flow has linked it, until its account settles in */
  linking: boolean
  accountNameFor: AccountNameLookup
  onLink: (bankAccount: ConnectionBankAccount, accountId: string) => void
}

/**
 * One bank account the connection returns, mapped to the account it is linked to. One credential
 * reaches every bank account on the connection, so the row has no health of its own and says only
 * where it goes, or offers the accounts the server says could take it in a dropdown. Choosing one
 * opens the link flow at its start step
 */
function BankAccountRow({ bankAccount, overLimit, heldReason, linking, accountNameFor, onLink }: BankAccountRowProps) {
  const prefersReducedMotion = useReducedMotion()
  const nameId = useId()
  const linkedId = bankAccount.linked_account_id
  const targets: DropdownOption[] = bankAccount.eligible_account_ids.map((accountId) => ({
    value: accountId,
    label: accountNameFor(accountId) ?? ACCOUNT_FALLBACK_NAME,
  }))
  const slot = linkedId && !linking ? 'linked' : linking ? 'linking' : 'choose'

  return (
    <div className={MAPPING_ROW_CLASS}>
      <span className={MAPPING_SOURCE_CLASS}>
        <span
          id={nameId}
          className="block truncate"
          style={{ color: bankAccount.custom_currency ? 'var(--app-text-muted)' : 'var(--app-text)' }}
        >
          {bankAccount.name}
        </span>
        <span className="block truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {bankAccount.custom_currency ? 'Custom currency' : bankAccount.currency}
        </span>
      </span>
      {bankAccount.custom_currency && !linkedId ? (
        <>
          <span aria-hidden />
          <span className="px-3 text-xs" style={{ color: 'var(--app-text-muted)' }}>
            Can&apos;t be linked
          </span>
        </>
      ) : (
        <>
          <MappingArrow muted={!linkedId} />
          {/* The slot's content changes in place: the dropdown gives way to a linking tile, then the
              linked account settles in on a spring, each fading through the other */}
          <span className="grid min-w-0">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={slot}
                className="block min-w-0"
                style={{ gridArea: '1 / 1' }}
                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                transition={
                  prefersReducedMotion ? { duration: 0.12 } : { type: 'spring', visualDuration: 0.3, bounce: 0.15 }
                }
              >
                {slot === 'linked' && linkedId ? (
                  <LinkedAccountTile accountId={linkedId} name={accountNameFor(linkedId) ?? ACCOUNT_FALLBACK_NAME} />
                ) : slot === 'linking' ? (
                  <span
                    className={`${TILE_CLASS} border`}
                    style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-muted)' }}
                    role="status"
                  >
                    <span className="app-spinner h-4 w-4 shrink-0" aria-hidden />
                    Linking…
                  </span>
                ) : targets.length === 0 && !overLimit ? (
                  // Plain text rather than an empty, disabled dropdown. Its faded text would be unreadable
                  <span
                    className={`${TILE_CLASS} border`}
                    style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-muted)' }}
                  >
                    No account can take it
                  </span>
                ) : (
                  <Dropdown
                    options={targets}
                    value=""
                    placeholder="Link an account"
                    size="field"
                    labelledBy={nameId}
                    disabled={heldReason !== undefined}
                    disabledReason={heldReason}
                    onChange={(accountId) => onLink(bankAccount, accountId)}
                  />
                )}
              </motion.span>
            </AnimatePresence>
          </span>
        </>
      )}
    </div>
  )
}

/**
 * A stopped state as its red dot and label, in the institution rows' small print
 */
function ProblemLine({ children }: { children: ReactNode }) {
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--app-negative)' }}>
      <SyncStatusDot tone="stopped" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

type InstitutionEntry = {
  key: string
  name: string

  /** What the user has to do here, in red under the name. It also puts the row under Needs attention */
  problem?: string

  /**
   * Why linking is as it is when that is not a problem, said after the count as in "2 of 2 linked ·
   * Linking resumes after you reconnect". The line sits under the name on phones, since it can't fit beside it there
   */
  countNote?: string

  /** A note that is not a problem, shown above the bank accounts, such as the institution limit */
  note?: string

  /** Explains the name behind a question mark beside it, for a group whose name alone doesn't say enough */
  hint?: string
  hintLabel?: string
  linked: number
  total: number

  /** What the row opens to, such as its bank accounts */
  body: ReactNode
}

/**
 * One institution, or several folded together, as a row between hairlines that opens to what it holds,
 * indented under its name with nothing boxed around it. The row says how many are linked and what to do
 * about any problem, so a long list reads at a glance while closed. A name too long for the row is cut
 * short before the count, and scrolls in place while the row is hovered or focused
 */
export function InstitutionRow({
  entry,
  defaultOpen,
  prefersReducedMotion,
}: {
  entry: InstitutionEntry
  defaultOpen: boolean
  prefersReducedMotion: boolean | null
}) {
  // Follows the default until the row is toggled, so an institution whose problem shows up after the
  // modal opens still starts open
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? defaultOpen
  const bodyId = useId()
  const counted = `${entry.linked} of ${entry.total} linked${entry.countNote ? ` · ${entry.countNote}` : ''}`

  return (
    <section aria-label={entry.name}>
      {/* The toggle stretches an overlay across the whole row, so the pointer can open it anywhere while
          keyboards and screen readers meet one button. The hint sits above that overlay. The row reaches
          past its edge by the room its padding keeps for the overlay's focus ring, as the bank accounts
          below do, so the count ends on the edge they end on, clear of the ring */}
      <div className="group/row relative -mr-1 flex items-start px-1">
        <button
          type="button"
          className="app-marquee-trigger flex min-w-0 items-center gap-2.5 py-3.5 text-left after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:shadow-[inset_0_0_0_2px_var(--app-focus-ring)]"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setToggled(!open)}
        >
          <ChevronRight
            size={15}
            aria-hidden
            className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
            style={{ color: 'var(--app-text-subtle)' }}
          />
          <span className="min-w-0 flex-1">
            <MarqueeText className="font-semibold text-[var(--app-text)] transition-colors group-hover/row:text-[var(--app-accent)]">
              {entry.name}
            </MarqueeText>
            {entry.problem && <ProblemLine>{entry.problem}</ProblemLine>}
            {entry.countNote && (
              <span className="mt-0.5 block text-xs sm:hidden" style={{ color: 'var(--app-text-muted)' }}>
                {counted}
              </span>
            )}
          </span>
        </button>
        {entry.hint && (
          <span className="relative z-10 ml-1.5 mt-[1.0625rem] flex shrink-0">
            <IconTooltip
              label={entry.hintLabel ?? 'What this means'}
              icon={CircleHelp}
              size={13}
              widthClassName="w-max max-w-52"
              avoidsLoneWord
              picksSideOnPress
            >
              <span className="font-normal normal-case">{entry.hint}</span>
            </IconTooltip>
          </span>
        )}
        {/* Keeps its width, so a long name gives way to the count rather than running into it */}
        <span className={`${entry.countNote ? 'hidden sm:flex' : 'flex'} ml-auto shrink-0 self-stretch py-3.5 pl-3`}>
          <span className="shrink-0 text-xs leading-6" style={{ color: 'var(--app-text-muted)' }}>
            {counted}
          </span>
        </span>
      </div>
      <AnimatePresence initial={false}>
        {/* Clips beyond the row's edge by the room its padding keeps for a focus ring, so the bank
            accounts end on the row's edge, as the hairlines between rows do, with a ring drawn whole */}
        {open && (
          <motion.div
            id={bodyId}
            className="-mr-1 overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: CONTENT_EASE_CURVE }}
          >
            <div className="pb-3 pl-7 pr-1">
              {entry.note && (
                <p className="pb-1 text-xs" style={{ color: 'var(--app-warning-text)' }}>
                  {entry.note}
                </p>
              )}
              {entry.body}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function GroupLabel({ tone, children }: { tone?: 'negative'; children: ReactNode }) {
  return (
    <h4
      className={`pb-2 text-xs uppercase ${tone === 'negative' ? 'font-semibold' : 'font-medium'}`}
      style={{ color: tone === 'negative' ? 'var(--app-negative)' : 'var(--app-text-muted)' }}
    >
      {children}
    </h4>
  )
}

type InstitutionListProps = {
  connection: BankConnection
  institutionLimit: number | null
  institutionsInUse: string[]

  /** Narrows the list to institutions whose name, or one of whose bank accounts' names, contains it */
  query: string
  accountNameFor: AccountNameLookup

  /** True while bank sync isn't set up. That holds every dropdown with the reason */
  linkingPaused: boolean

  /** The bank account just linked through the flow, shown as linking until its account settles in */
  linkingExternalId: string | null
  onLink: (bankAccount: ConnectionBankAccount, accountId: string) => void
  prefersReducedMotion: boolean | null
}

/**
 * Every institution a connection returns, each opening to its bank accounts mapped to the account each
 * is linked to. Institutions that need something from the user come first and start open, the rest
 * start closed, and links waiting to choose their bank account again come first of all as Mismatch
 * detected
 *
 * Nothing can be linked through a rejected connection, nor at an institution the user hasn't linked yet
 * once the institution limit is used up, nor anywhere while bank sync isn't set up
 */
export function InstitutionList({
  connection,
  institutionLimit,
  institutionsInUse,
  query,
  accountNameFor,
  linkingPaused,
  linkingExternalId,
  onLink,
  prefersReducedMotion,
}: InstitutionListProps) {
  const groups = groupInstitutions(connection, { institutionLimit, institutionsInUse }).filter((group) =>
    matchesInstitutionSearch(group, query),
  )

  const entries: InstitutionEntry[] = groups.map((group) => ({
    key: `institution:${group.name}`,
    name: group.name,
    problem: group.signInNeeded ? `Sign in again in ${providerSiteName(connection)}` : undefined,
    note: group.overLimit && institutionLimit !== null ? describeOverLimit(institutionLimit) : undefined,
    linked: group.linked,
    total: group.bankAccounts.length,
    body: (
      <ul>
        {group.bankAccounts.map((bankAccount) => (
          <li key={bankAccount.external_id}>
            <BankAccountRow
              bankAccount={bankAccount}
              overLimit={group.overLimit}
              heldReason={describeLinkingHeld({ linkingPaused, connection, group, institutionLimit })}
              linking={linkingExternalId === bankAccount.external_id}
              accountNameFor={accountNameFor}
              onLink={onLink}
            />
          </li>
        ))}
      </ul>
    ),
  }))

  // First, since nothing on these syncs until each account gets its bank account back
  const chooseAgain = connection.choose_again_links
  const mismatchMatches = matchesSearch(
    ['Mismatch detected', ...chooseAgain.map((link) => link.external_account_name)],
    query,
  )
  if (chooseAgain.length > 0 && mismatchMatches) {
    entries.unshift({
      key: 'mismatch',
      name: 'Mismatch detected',
      problem: 'Choose bank account',
      hintLabel: 'Why this happened',
      hint: describeMismatch(connection, accountNameFor),
      linked: chooseAgain.length,
      total: chooseAgain.length,
      body: (
        <ul>
          {chooseAgain.map((link) => (
            <li key={link.account_id}>
              <div className={MAPPING_ROW_CLASS}>
                <span className={MAPPING_SOURCE_CLASS}>
                  <span className="block truncate" style={{ color: 'var(--app-text-muted)' }}>
                    Was {link.external_account_name}
                  </span>
                  <ProblemLine>Choose bank account</ProblemLine>
                </span>
                <MappingArrow />
                <LinkedAccountTile
                  accountId={link.account_id}
                  name={accountNameFor(link.account_id) ?? ACCOUNT_FALLBACK_NAME}
                />
              </div>
            </li>
          ))}
        </ul>
      ),
    })
  }

  const attention = entries.filter((entry) => entry.problem)
  const rest = entries.filter((entry) => !entry.problem)
  // Labels only help when they separate two kinds, so a list of one kind goes without
  const labelled = attention.length > 0 && rest.length > 0
  const isSearching = query.trim() !== ''
  const onlyOne = entries.length === 1 && !isSearching

  const renderGroup = (group: InstitutionEntry[]) => (
    <div className="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">
      {group.map((entry) => (
        <InstitutionRow
          key={entry.key}
          entry={entry}
          defaultOpen={Boolean(entry.problem) || onlyOne}
          prefersReducedMotion={prefersReducedMotion}
        />
      ))}
    </div>
  )

  // A claim or reconnect whose listing failed lists the bank accounts in the background, and the
  // connections read is polled meanwhile, so they arrive here by themselves
  if (connection.accounts.length === 0 && chooseAgain.length === 0) {
    return connection.discovery_pending ? (
      <p className="py-6 text-center text-sm" role="status" style={{ color: 'var(--app-text-muted)' }}>
        Listing the bank accounts…
      </p>
    ) : (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {providerSiteName(connection)} returned no bank accounts for this connection.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {entries.length === 0 && isSearching && (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
          No institutions match &ldquo;{query.trim()}&rdquo;.
        </p>
      )}
      {attention.length > 0 && (
        <div>
          {labelled && <GroupLabel tone="negative">Needs attention</GroupLabel>}
          {renderGroup(attention)}
        </div>
      )}
      {rest.length > 0 && (
        <div>
          {labelled && <GroupLabel>All good</GroupLabel>}
          {renderGroup(rest)}
        </div>
      )}
    </div>
  )
}
