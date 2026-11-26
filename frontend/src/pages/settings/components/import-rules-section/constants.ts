import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'
import { CONTENT_EASE_CURVE } from '@/utils/widthEase'
import type { ConditionAttribute } from '@/pages/settings/components/import-rules-section/types'

/** Rules shown before "Show more", as many as the merchants and tags lists show */
export const RULE_LIST_VISIBLE_ROWS = 10
export const RULE_LIST_PAGE_SIZE = RULE_LIST_VISIBLE_ROWS

/**
 * The columns of a rule's row from 750px, shared by the row and the heading line over the rows so each heading
 * sits over its column: the rule's name, the sentence of its conditions and what it sets
 */
export const RULE_COLUMNS_CLASS_NAME = 'grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,3fr)] gap-x-4'

/** The grip's slot and the Actions slot, as wide in the heading line as in the rows, so the columns between line up */
export const RULE_GRIP_SLOT_CLASS_NAME = 'w-8 shrink-0'
export const RULE_ACTIONS_SLOT_CLASS_NAME = 'shrink-0 min-[750px]:w-24'

/** The pause before typed text is searched for, as the merchants and tags lists have it */
export const RULE_SEARCH_DEBOUNCE_MS = 300
export const RULE_LIST_HEIGHT_TRANSITION = { duration: 0.24, ease: CONTENT_EASE_CURVE }
export const DELETE_SPINNER_MS = LOADING_ANIMATION_MIN_MS

/** The server's refusal of a name another rule has. Any other 409 isn't about the name, and a backend test pins this sentence */
export const NAME_TAKEN_MESSAGE = 'An import rule with this name already exists'

/** The limits the server enforces, so the editor says no before it sends a rule the server would refuse */
export const MAX_RULE_NAME_LENGTH = 100
export const MAX_RULE_TEXT_LENGTH = 200
export const MAX_RULE_TAGS = 32

/** Picker pages and the pause before a typed search is sent, as the bulk edit panel has them */
export const REFERENCE_PAGE_SIZE = 20
export const REFERENCE_SEARCH_DEBOUNCE_MS = 250

export const CONDITION_ATTRIBUTE_OPTIONS: DropdownOption[] = [
  { value: 'description', label: 'Description' },
  { value: 'note', label: 'Note' },
  { value: 'amount', label: 'Amount' },
  { value: 'direction', label: 'Direction' },
  { value: 'account', label: 'Account' },
]

const TEXT_OPERATOR_OPTIONS: DropdownOption[] = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'is', label: 'is' },
  { value: 'is_not', label: "isn't" },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
]

export const CONDITION_OPERATOR_OPTIONS: Record<ConditionAttribute, DropdownOption[]> = {
  description: TEXT_OPERATOR_OPTIONS,
  note: TEXT_OPERATOR_OPTIONS,
  amount: [
    { value: 'is', label: 'is' },
    { value: 'at_least', label: 'is at least' },
    { value: 'at_most', label: 'is at most' },
  ],
  direction: [{ value: 'is', label: 'is' }],
  account: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: "isn't" },
  ],
}

/** The operator a condition starts with when its attribute is chosen */
export const DEFAULT_OPERATOR: Record<ConditionAttribute, string> = {
  description: 'contains',
  note: 'contains',
  amount: 'at_least',
  direction: 'is',
  account: 'is',
}

export const DIRECTION_OPTIONS: DropdownOption[] = [
  { value: 'in', label: 'Money in' },
  { value: 'out', label: 'Money out' },
]

export const MATCH_OPTIONS: DropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'any', label: 'Any' },
]

export const RULE_MODAL_IDS = {
  name: 'import-rule-name',
  conditionsAdd: 'import-rule-add-condition',
  match: 'import-rule-match',
  merchant: 'import-rule-merchant',
  category: 'import-rule-category',
  tags: 'import-rule-tags',
} as const

export const RULE_ERROR_IDS = {
  name: 'import-rule-name-error',
  conditions: 'import-rule-conditions-error',
  actions: 'import-rule-actions-error',
} as const
