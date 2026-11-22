import { useMemo, type RefObject, type UIEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Currency } from '@/api/currency'
import type { ImportRule } from '@/api/import-rules'
import LoadFailure from '@/components/errors/LoadFailure'
import ScrollableListMoreButton from '@/components/list-controls/MoreButton'
import {
  RULE_ACTIONS_SLOT_CLASS_NAME,
  RULE_COLUMNS_CLASS_NAME,
  RULE_GRIP_SLOT_CLASS_NAME,
  RULE_LIST_HEIGHT_TRANSITION,
} from '@/pages/settings/components/import-rules-section/constants'
import { RuleRow } from '@/pages/settings/components/import-rules-section/list/Row'
import { SortableItem } from '@/pages/settings/components/import-rules-section/sortable/SortableItem'
import { SortableList } from '@/pages/settings/components/import-rules-section/sortable/SortableList'
import { getMenuMoves } from '@/pages/settings/components/import-rules-section/utils/moves'
import { useMeasuredHeight } from '@/pages/settings/components/shared/hooks/useMeasuredHeight'

/** Shown on every grip and move while the server has not yet answered the last one */
export const SAVING_ORDER_REASON = 'Saving the new order'

/** Shown on every grip and move while a search is on, since the rules it hides sit between the ones shown */
export const SEARCH_ORDER_REASON = 'Please clear the search to move rules'

type ImportRulesListProps = {
  /** The text the shown rules were searched for, or an empty string when every rule is shown */
  activeSearch: string
  rules: ImportRule[]
  currencies: Currency[]
  hasMoreRules: boolean
  listError: unknown
  listFailed: boolean
  showFetchingMoreRules: boolean
  showInitialRuleLoading: boolean
  showRuleListEnd: boolean
  showRuleListMoreIndicator: boolean
  shouldScrollRules: boolean
  ruleListRef: RefObject<HTMLDivElement | null>
  confirmingDeleteRuleId: string | null
  deletingRuleId: string | null

  /** Whether a move is on its way to the server. Every other move waits until it is answered */
  isMoving: boolean
  onDeleteCancel: () => void
  onDeleteConfirm: (rule: ImportRule) => void | Promise<void>
  onDeleteRequest: (rule: ImportRule) => void
  onEdit: (rule: ImportRule) => void

  /** Moves a rule to a position counted from zero */
  onMove: (rule: ImportRule, position: number) => void

  /** A rule dragged from one shown place to another, both counted from zero among the shown rules */
  onDrop: (from: number, to: number) => void
  onListMoreClick: () => void
  onListScroll: (event: UIEvent<HTMLDivElement>) => void
}

/**
 * The import rules in the order they are checked, each a row that can be dragged by its grip
 *
 * The list animates its own height so rows arriving, leaving or the empty text swapping in never jump
 * the card around it. A failed load takes the place of the empty text when no rows are held, and sits
 * above the rows when some are
 */
export default function ImportRulesList({
  activeSearch,
  rules,
  currencies,
  hasMoreRules,
  listError,
  listFailed,
  showFetchingMoreRules,
  showInitialRuleLoading,
  showRuleListEnd,
  showRuleListMoreIndicator,
  shouldScrollRules,
  ruleListRef,
  confirmingDeleteRuleId,
  deletingRuleId,
  isMoving,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onMove,
  onDrop,
  onListMoreClick,
  onListScroll,
}: ImportRulesListProps) {
  const shouldReduceMotion = useReducedMotion()
  const { ref: contentRef, height: contentHeight } = useMeasuredHeight<HTMLDivElement>()
  const entries = useMemo(() => rules.map((rule) => ({ id: rule.id, label: rule.name })), [rules])
  const searching = activeSearch.trim() !== ''
  // The search's reason leads, since a move can't be saved either way while rules are hidden between the shown ones
  const movingReason = searching ? SEARCH_ORDER_REASON : isMoving ? SAVING_ORDER_REASON : null

  const rows =
    rules.length === 0 && !showInitialRuleLoading ? (
      listFailed ? null : (
        <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
          {searching
            ? 'No import rules match your search.'
            : 'No import rules yet. Create one to sort imported transactions on their own.'}
        </p>
      )
    ) : (
      <div className="relative">
        <div
          ref={ruleListRef}
          // Positioned so the absolute screen-reader-only text in each row is clipped with its row. Otherwise that
          // text sits below the scroll area and gives the clipping box around the list a scroll of its own. A focus
          // or a scroll into view can then move that box and leave a blank band. The list takes no scroll anchoring:
          // the end message below the rows comes and goes with the scroll position, and the browser shifting the
          // content to keep a row in place each time made a list stopped short of its end scroll for ever
          className={
            shouldScrollRules
              ? 'relative max-h-[35rem] min-w-0 overflow-x-hidden overflow-y-auto pr-2 [overflow-anchor:none]'
              : 'min-w-0'
          }
          onScroll={shouldScrollRules ? onListScroll : undefined}
        >
          {/* The headings are for the eye. Each row says its own parts to a screen reader, and a heading line away from
              the rows would only repeat them. Sticky with the merchants list's, so the rows scroll under it */}
          <div
            aria-hidden
            className={`app-label hidden items-center py-3 pl-2 pr-3 min-[750px]:flex ${shouldScrollRules ? 'sticky top-0 z-10' : ''}`}
            style={{ background: 'var(--app-surface-soft)', borderBottom: '1px solid var(--app-border)' }}
          >
            <span className={RULE_GRIP_SLOT_CLASS_NAME} />
            <span className={`grid min-w-0 flex-1 px-3 ${RULE_COLUMNS_CLASS_NAME}`}>
              <span>Rule</span>
              <span>When</span>
              <span>Sets</span>
            </span>
            <span className={`text-right ${RULE_ACTIONS_SLOT_CLASS_NAME}`}>Actions</span>
          </div>
          <SortableList entries={entries} onMove={onDrop}>
            <ul aria-label="Import rules">
              {rules.map((rule, index) => {
                const moves = getMenuMoves(rules, rule.id, hasMoreRules)
                return (
                  <SortableItem
                    key={rule.id}
                    id={rule.id}
                    gripLabel={`Move ${rule.name}`}
                    disabledReason={movingReason}
                    surface="card"
                  >
                    {(grip) => (
                      <RuleRow
                        rule={rule}
                        currencies={currencies}
                        grip={grip}
                        isLast={!showRuleListEnd && !hasMoreRules && index === rules.length - 1}
                        moveUp={moves.up}
                        moveDown={moves.down}
                        movingReason={movingReason}
                        confirmingDelete={confirmingDeleteRuleId === rule.id}
                        deleting={deletingRuleId === rule.id}
                        onEdit={onEdit}
                        onMoveUp={(item) => moves.up.position !== null && onMove(item, moves.up.position)}
                        onMoveDown={(item) => moves.down.position !== null && onMove(item, moves.down.position)}
                        onDeleteRequest={onDeleteRequest}
                        onDeleteCancel={onDeleteCancel}
                        onDeleteConfirm={onDeleteConfirm}
                      />
                    )}
                  </SortableItem>
                )
              })}
            </ul>
          </SortableList>
          {showRuleListEnd && !showFetchingMoreRules && !showInitialRuleLoading && (
            <p className="py-4 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              You've reached the end.
            </p>
          )}
          {showFetchingMoreRules && rules.length > 0 && (
            <p className="py-4 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              Fetching more
            </p>
          )}
        </div>
        <ScrollableListMoreButton
          show={showRuleListMoreIndicator}
          onClick={onListMoreClick}
          ariaLabel={hasMoreRules ? 'Show more import rules' : 'Scroll import rules down'}
        />
      </div>
    )

  return (
    <motion.div
      animate={contentHeight === null || shouldReduceMotion ? undefined : { height: contentHeight }}
      initial={false}
      transition={RULE_LIST_HEIGHT_TRANSITION}
      style={shouldReduceMotion ? undefined : { overflow: 'hidden' }}
    >
      <div ref={contentRef}>
        {listFailed && <LoadFailure error={listError} subject="Import rules" />}
        {rows}
      </div>
    </motion.div>
  )
}
