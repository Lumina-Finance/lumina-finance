import type { ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import Dropdown from '@/components/dropdown/Dropdown'
import { FieldError } from '@/components/forms/FieldError'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { HintButton } from '@/components/tooltips/HintButton'
import { ConditionRow } from '@/pages/settings/components/import-rules-section/modal/ConditionRow'
import type { ConditionRowsShared } from '@/pages/settings/components/import-rules-section/modal/types'
import { MATCH_OPTIONS } from '@/pages/settings/components/import-rules-section/constants'
import { SortableItem } from '@/pages/settings/components/import-rules-section/sortable/SortableItem'
import { SortableList } from '@/pages/settings/components/import-rules-section/sortable/SortableList'
import type { GroupForm } from '@/pages/settings/components/import-rules-section/types'
import {
  getConditionFieldKey,
  getCurrencyFieldKey,
  getGroupControlId,
  getGroupFieldKey,
  isRuleMatch,
} from '@/pages/settings/components/import-rules-section/utils/form'

type GroupBlockProps = {
  group: GroupForm

  /** The group's place among the rule's items, counted from one, to name it for a screen reader */
  number: number
  grip: ReactNode
  shared: ConditionRowsShared

  /** Why a condition can't be added, once the rule holds as many as it may */
  addDisabledReason: string | null
  onMatch: (value: GroupForm['match']) => void
  onRemove: () => void
  onAdd: () => void
  onMoveCondition: (from: number, to: number) => void
}

/**
 * A group of conditions behind a thin rail, with its own All or Any, its own conditions and its own
 * way to add one. Its conditions move within it, and moving one into or out of a group is a removal
 * and an addition
 */
export function GroupBlock({
  group,
  number,
  grip,
  shared,
  addDisabledReason,
  onMatch,
  onRemove,
  onAdd,
  onMoveCondition,
}: GroupBlockProps) {
  const name = `Group ${number}`
  const matchId = `import-rule-group-${group.key}-match`
  const error = shared.errors[getGroupFieldKey(group.key)]
  const errorId = error ? `import-rule-group-${group.key}-error` : undefined
  const entries = group.conditions.map((condition, index) => ({
    id: condition.key,
    label: `${name} condition ${index + 1}`,
  }))

  return (
    <div className="border-l-2 pl-3" style={{ borderColor: 'var(--app-border-strong)' }}>
      <div className="flex items-center gap-1.5">
        {grip}
        <span id={`${matchId}-label`} className="sr-only">{`${name} matches`}</span>
        <div className="w-24 shrink-0">
          <Dropdown
            id={matchId}
            options={MATCH_OPTIONS}
            value={group.match}
            onChange={(value) => {
              if (isRuleMatch(value)) onMatch(value)
            }}
            labelledBy={`${matchId}-label ${matchId}`}
            matchFieldWidth
          />
        </div>
        <span className="min-w-0 flex-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
          of these match
        </span>
        <HintButton
          type="button"
          className="app-icon-button shrink-0"
          aria-label={`Remove ${name.toLowerCase()}`}
          hint="Remove group"
          onClick={onRemove}
        >
          <X size={18} aria-hidden />
        </HintButton>
      </div>
      <FieldError message={error} id={errorId} className="mt-1" />

      <div className="mt-3 space-y-3">
        <SortableList entries={entries} onMove={onMoveCondition}>
          <ul className="space-y-3">
            {group.conditions.map((condition, index) => (
              <SortableItem
                key={condition.key}
                id={condition.key}
                gripLabel={`Move ${name.toLowerCase()} condition ${index + 1}`}
                disabledReason={group.conditions.length < 2 ? 'Please add another condition to reorder' : null}
                surface="dialogue"
              >
                {(grip) => (
                  <ConditionRow
                    condition={condition}
                    inGroup
                    name={`${name} condition ${index + 1}`}
                    error={shared.errors[getConditionFieldKey(condition.key)]}
                    currencyError={shared.errors[getCurrencyFieldKey(condition.key)]}
                    currencies={shared.currencies}
                    currencyOptions={shared.currencyOptions}
                    accountOptions={shared.accountOptions}
                    grip={grip}
                    onChange={(field, value, label) => shared.onChange(condition.key, field, value, label)}
                    onRemove={() => shared.onRemove(condition.key)}
                    onTouch={() => shared.onTouch(getConditionFieldKey(condition.key))}
                  />
                )}
              </SortableItem>
            ))}
          </ul>
        </SortableList>
        <DisabledReasonButton
          id={getGroupControlId(group.key)}
          type="button"
          // Starts where the grips' dots do, not at the edge of the grip button around them
          className="app-secondary-button ml-3 flex items-center gap-1"
          disabledReason={addDisabledReason}
          onClick={onAdd}
        >
          <Plus size={15} aria-hidden />
          Add condition
        </DisabledReasonButton>
      </div>
    </div>
  )
}
