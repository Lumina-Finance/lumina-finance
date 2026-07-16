import { useState } from 'react'
import { ArrowRight, ChevronDown, Info } from 'lucide-react'
import { IMPORT_INSET_STYLE } from '../../constants'

/**
 * One concept that arrives intact but in a new shape, phrased as the user knows
 * it in Firefly III and what it becomes in Lumina
 */
interface ConceptMapping {
  firefly: string
  lumina: string
}

const CONVERTED_MAPPINGS: ConceptMapping[] = [
  {
    firefly: 'One transfer',
    lumina: 'Two entries, one per account, so your transaction count ends up higher than your row count',
  },
  {
    firefly: 'Expense and revenue accounts, like shops and employers',
    lumina: 'Merchants',
  },
  {
    firefly: 'A loan payment recorded as a withdrawal',
    lumina: 'A transfer between your account and the loan',
  },
  {
    firefly: 'A split transaction group',
    lumina: 'Separate entries that are no longer linked',
  },
  {
    firefly: 'Journal description, always required',
    lumina: 'Notes, which are optional here',
  },
  {
    firefly: 'Budget limit periods, whatever their length',
    lumina: 'One budget period each, with the original dates and amounts, continuing on the cadence of the latest period, or as a one-off when no cadence fits',
  },
]

/**
 * The one difference whose figures will not tie back to Firefly III, which is
 * worth finding before the numbers are compared rather than after
 */
const DEVIATION_TEXT = "Firefly III sets a budget on each transaction. This app's budgets track whole "
  + 'categories, so anything you left out of a budget there still counts against it here, and the amount '
  + 'left can read lower than Firefly III shows.'

/**
 * Everything the import leaves behind, listed without saying which might arrive
 * later, since nothing here is committed to and a hint otherwise would be read
 * as a promise. The first entries are whole features and the rest are rare
 * data shapes, which are skipped and reported when an export carries them
 */
const LEFT_BEHIND = [
  'Archived budgets',
  'Budgets repeating on period lengths Lumina Finance has no cadence for',
  'Budgets whose limits mix more than one currency',
  'Transactions with more decimal places than their currency allows',
  'Transactions carrying a tag too long for this app',
  'Bills and recurring transactions',
  'Piggy banks and reconciliation flags',
  'Account interest and card details',
  'Rules and attachments',
]

/**
 * Static concept mapping shown at the top of the Firefly III flow so users
 * know which of their data changes shape on the way in, since the two apps
 * model transactions differently
 *
 * The three groups are ordered by what it costs to not know: the one thing
 * whose totals will not match leads, then data that arrives in a new shape,
 * then what stays behind
 */
export function FireflyExpectationsCard() {
  return (
    <div className="rounded-lg px-4 py-3" style={IMPORT_INSET_STYLE}>
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"
          style={{ color: 'var(--app-accent)' }}
          aria-hidden
        >
          <Info size={16} strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold leading-5" style={{ color: 'var(--app-text)' }}>
            What To Expect
          </p>
          <p className="mt-1 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
            Firefly III records every journal against two accounts. Lumina Finance records one entry per account, so
            some of your data changes shape on the way in.
          </p>

          {/* The rails share the text column beside the icon so they line up
              with the wording they explain */}
          <ConceptGroup
            title="Figures will differ"
            railColour="var(--app-negative)"
            titleColour="var(--app-negative)"
            tinted
          >
            <p className="text-sm leading-5" style={{ color: 'var(--app-text)' }}>
              {DEVIATION_TEXT}
            </p>
          </ConceptGroup>

          <CollapsedConceptGroup title="Changes shape" toggleLabel="changes shape" railColour="var(--app-accent)">
            <ul className="mt-1.5 flex flex-col gap-1.5 text-sm leading-5" style={{ color: 'var(--app-text)' }}>
              {CONVERTED_MAPPINGS.map((mapping) => (
                <li key={mapping.firefly}>
                  {mapping.firefly}
                  <span className="sr-only"> becomes </span>
                  <ArrowRight
                    size={13}
                    className="mx-1.5 inline align-[-0.1em]"
                    style={{ color: 'var(--app-text-subtle)' }}
                    aria-hidden
                  />
                  {mapping.lumina}
                </li>
              ))}
            </ul>
          </CollapsedConceptGroup>

          <ConceptGroup title="Left behind" railColour="var(--app-text-subtle)">
            <ul
              className="flex list-disc flex-col gap-1 pl-4 text-sm leading-5"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {LEFT_BEHIND.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </ConceptGroup>
        </div>
      </div>
    </div>
  )
}

/**
 * Renders one group of differences behind a coloured rail, collapsed to its
 * title until asked for
 *
 * The rail and title match the always-open groups so the toggle reads as one
 * of them, which keeps the card scannable while everything stays reachable
 */
function CollapsedConceptGroup({
  title,
  toggleLabel,
  railColour,
  children,
}: {
  title: string

  /** Names what expands and collapses for the toggle's accessible label */
  toggleLabel: string
  railColour: string
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-3 border-l-2 pl-3" style={{ borderColor: railColour }}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${toggleLabel}` : `Expand ${toggleLabel}`}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'var(--app-accent)' }}
        >
          {title}
        </span>
        <ChevronDown
          size={15}
          className="shrink-0 transition-transform duration-150"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--app-text-muted)' }}
          aria-hidden
        />
      </button>
      {expanded && children}
    </div>
  )
}

/**
 * Renders one group of differences behind a coloured rail
 *
 * The rail is a single-sided border, so the block stays square rather than
 * rounding away from it
 */
function ConceptGroup({
  title,
  railColour,
  titleColour = 'var(--app-accent)',
  tinted = false,
  children,
}: {
  title: string
  railColour: string

  /** Defaults to the accent, since only the deviation group speaks in its own colour */
  titleColour?: string

  /** Tints the block so the group reads as the one to stop at */
  tinted?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`mt-3 border-l-2 pl-3 ${tinted ? 'py-2 pr-2.5' : ''}`}
      style={{
        borderColor: railColour,
        background: tinted ? 'color-mix(in srgb, var(--app-negative) 7%, transparent)' : undefined,
      }}
    >
      <p
        className="mb-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: titleColour }}
      >
        {title}
      </p>
      {children}
    </div>
  )
}
