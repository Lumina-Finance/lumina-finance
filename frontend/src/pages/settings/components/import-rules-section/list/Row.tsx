import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Trash2, X } from 'lucide-react'
import type { Currency } from '@/api/currency'
import type { ImportRule } from '@/api/import-rules'
import MarqueeText from '@/components/display/MarqueeText'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { OverflowMenu } from '@/components/passkeys/OverflowMenu'
import { HintButton } from '@/components/tooltips/HintButton'
import {
  RULE_ACTIONS_SLOT_CLASS_NAME,
  RULE_COLUMNS_CLASS_NAME,
  RULE_GRIP_SLOT_CLASS_NAME,
} from '@/pages/settings/components/import-rules-section/constants'
import type { MenuMove } from '@/pages/settings/components/import-rules-section/utils/moves'
import { getRuleSets, getRuleSummary } from '@/pages/settings/components/import-rules-section/utils/summary'

type RuleRowProps = {
  rule: ImportRule
  currencies: Currency[]

  /** The grip that picks the row up, drawn by the sortable item around the row */
  grip: ReactNode

  /** Leaves off the rule under the row, for the last one shown */
  isLast: boolean
  moveUp: MenuMove
  moveDown: MenuMove

  /** Why every move is held, while one is saving or a search is shown, or null */
  movingReason: string | null
  confirmingDelete: boolean
  deleting: boolean
  onEdit: (rule: ImportRule) => void
  onMoveUp: (rule: ImportRule) => void
  onMoveDown: (rule: ImportRule) => void
  onDeleteRequest: (rule: ImportRule) => void
  onDeleteCancel: () => void
  onDeleteConfirm: (rule: ImportRule) => void | Promise<void>
}

/**
 * One kind a rule sets, such as the merchant or the tags. The kind is muted and the value is the body colour at
 * medium weight. From 750px each kind has a line of its own that ends in an ellipsis, and below that the kinds run on
 * in one wrapping line, told apart by the comma after each. The kind is for the eye alone, since a screen reader hears
 * the words in front of each value
 */
function SetsGroup({ kind, isLast, children }: { kind: string; isLast: boolean; children: ReactNode }) {
  return (
    <>
      <span className="inline min-[750px]:block min-[750px]:truncate">
        <span aria-hidden className="text-[var(--app-text-muted)] min-[750px]:capitalize">
          {kind}
        </span>{' '}
        <span className="font-medium">{children}</span>
      </span>
      {!isLast && (
        <span aria-hidden className="min-[750px]:hidden">
          {', '}
        </span>
      )}
    </>
  )
}

/**
 * One rule in the list: its grip, then its name, its conditions as one sentence and what it sets, then its menu
 *
 * From 750px the name, the sentence and what the rule sets are three columns under the headings the list draws. Below
 * that the sentence and what the rule sets are lines under the name, each led by a label
 *
 * The name, the sentence and what the rule sets are one button that opens the editor, so a screen reader hears the
 * name, the sentence and the results together. Deleting asks in place, swapping the menu for Cancel and Confirm as the
 * merchants list does
 */
export function RuleRow({
  rule,
  currencies,
  grip,
  isLast,
  moveUp,
  moveDown,
  movingReason,
  confirmingDelete,
  deleting,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: RuleRowProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const sets = getRuleSets(rule)
  const summary = getRuleSummary(rule, currencies)

  // The menu that asked for the delete is gone by now, so focus moves to the answer it needs
  useEffect(() => {
    if (confirmingDelete) cancelRef.current?.focus()
  }, [confirmingDelete])

  // A refused delete leaves the row asking, with its buttons live again. Focus was lost when they were held off
  // for the request, so it goes back to the button that was pressed
  const wasDeleting = useRef(false)
  useEffect(() => {
    if (wasDeleting.current && !deleting && confirmingDelete) confirmRef.current?.focus()
    wasDeleting.current = deleting
  }, [confirmingDelete, deleting])

  return (
    <div
      data-rule-id={rule.id}
      className="flex items-start py-1.5 pl-2 pr-3"
      // The last row keeps the rule's room, drawn clear, so every row is as tall as the others
      style={{ borderBottom: `1px solid ${isLast ? 'transparent' : 'var(--app-border)'}` }}
    >
      <div className={`pt-2 ${RULE_GRIP_SLOT_CLASS_NAME}`}>{grip}</div>
      {/* The padding is the button's own, so its focus ring, drawn inside its edge, keeps clear of the text. The
          hover fill is the one a card gives its rows, since the plain one matches the card's own shade. A press takes
          the accent tint, which neither a hover nor the ring brings. From 750px the button is the three columns, on
          the first line of text of each */}
      <button
        type="button"
        className={`app-marquee-trigger app-focus-inset min-w-0 flex-1 rounded-lg px-3 py-2 text-left transition-control hover:bg-[color:var(--app-hover-fill)] active:bg-[color:var(--app-accent-soft)] min-[750px]:grid min-[750px]:items-baseline ${RULE_COLUMNS_CLASS_NAME}`}
        disabled={deleting}
        onClick={() => onEdit(rule)}
      >
        <span className="block truncate font-medium">{rule.name}</span>
        <span className="sr-only">. </span>
        <span className="grid grid-cols-[2.75rem_minmax(0,1fr)] text-sm min-[750px]:block">
          <span aria-hidden className="text-[var(--app-text-muted)] min-[750px]:hidden">
            When
          </span>
          {/* Below 750px the sentence wraps on up to two lines and ends in an ellipsis only when it needs more, and it
              never moves. From 750px a sentence too long for its line rests still and ends in an ellipsis, and slides
              in place only while a pointer is over this button or the button holds keyboard focus, so a list of long
              sentences never moves on its own. Each width draws its own copy and the other is not drawn at all, so
              a screen reader hears the sentence once */}
          <span className="line-clamp-2 break-words min-[750px]:hidden">{summary}</span>
          <MarqueeText className="max-[749px]:hidden min-[750px]:text-[var(--app-text-muted)]">{summary}</MarqueeText>
        </span>
        <span className="mt-0.5 grid grid-cols-[2.75rem_minmax(0,1fr)] text-sm leading-5 min-[750px]:mt-0 min-[750px]:block">
          <span aria-hidden className="text-[var(--app-text-muted)] min-[750px]:hidden">
            Sets
          </span>
          <span className="min-w-0">
            {sets.map((group, index) => (
              <SetsGroup key={group.kind} kind={group.kind} isLast={index === sets.length - 1}>
                {group.values.map((value, position) => (
                  <Fragment key={value.id}>
                    {position > 0 && ', '}
                    <span className="sr-only">{group.spoken} </span>
                    {value.name}
                  </Fragment>
                ))}
                {group.hiddenCount > 0 && (
                  <>
                    {' '}
                    <span className="sr-only">Adds </span>+{group.hiddenCount}
                    <span className="sr-only"> more {group.hiddenCount === 1 ? 'tag' : 'tags'}</span>
                  </>
                )}
              </SetsGroup>
            ))}
          </span>
        </span>
      </button>
      <div className={`flex gap-1.5 pt-1.5 min-[750px]:justify-end ${RULE_ACTIONS_SLOT_CLASS_NAME}`}>
        {confirmingDelete ? (
          <>
            <HintButton
              ref={cancelRef}
              className="app-icon-button"
              disabled={deleting}
              onClick={onDeleteCancel}
              aria-label={`Cancel deleting ${rule.name}`}
              hint="Cancel"
            >
              <X size={16} aria-hidden />
            </HintButton>
            <HintButton
              ref={confirmRef}
              className="app-icon-button"
              disabled={deleting}
              onClick={() => onDeleteConfirm(rule)}
              aria-label={`Confirm delete ${rule.name}`}
              hint="Confirm delete"
            >
              <PendingLabel pending={deleting} name="Deleting">
                <Check size={16} aria-hidden />
              </PendingLabel>
            </HintButton>
          </>
        ) : (
          <OverflowMenu
            label={`Actions for ${rule.name}`}
            triggerRef={menuTriggerRef}
            fillPressedItem
            triggerClassName="app-icon-button shrink-0 aria-expanded:border-[var(--app-border)] aria-expanded:bg-[var(--app-hover-fill)] aria-expanded:text-[var(--app-text)]"
            items={[
              { label: 'Edit', icon: <Pencil size={16} aria-hidden />, onSelect: () => onEdit(rule) },
              {
                label: 'Move up',
                icon: <ArrowUp size={16} aria-hidden />,
                disabledReason: movingReason ?? moveUp.reason,
                onSelect: () => onMoveUp(rule),
              },
              {
                label: 'Move down',
                icon: <ArrowDown size={16} aria-hidden />,
                disabledReason: movingReason ?? moveDown.reason,
                onSelect: () => onMoveDown(rule),
              },
              {
                label: 'Delete',
                icon: <Trash2 size={16} aria-hidden />,
                danger: true,
                onSelect: () => onDeleteRequest(rule),
              },
            ]}
          />
        )}
      </div>
    </div>
  )
}
