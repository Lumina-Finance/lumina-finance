import type { Currency } from '@/api/currency'
import type { ImportRuleMatch } from '@/api/import-rules'
import type { ChosenTagOption } from '@/components/transactions/bulk-edit/selection'

export type ConditionAttribute = 'description' | 'note' | 'amount' | 'direction' | 'account'

/**
 * One condition as the editor holds it
 *
 * Every condition carries every field, so changing its attribute never has to rebuild the row. The
 * fields its attribute doesn't use stay at their blank values and never reach the payload
 */
export type ConditionForm = {
  kind: 'condition'

  /** Tells a row apart from the others while it is edited, moved and given its error */
  key: string
  attribute: ConditionAttribute
  operator: string

  /** The text to match, the amount as decimal text, `in` or `out`, or an account's id */
  value: string

  /** The amount's currency, held for every condition so the choice survives a change of attribute */
  currency: string

  /** What a saved account condition names, for its field to show while the account list holds no such row */
  accountName: string | null

  /** A saved account condition whose account is gone. Such a condition never matches */
  accountDeleted: boolean

  /**
   * A saved amount in minor units, held while its currency's decimal places aren't known yet. The amount
   * field stays locked and empty until they are, since a guess would show or save the wrong figure
   */
  savedMinorUnits: number | null
}

/** Conditions held together behind their own All or Any. A group holds no group */
export type GroupForm = {
  kind: 'group'
  key: string
  match: ImportRuleMatch
  conditions: ConditionForm[]
}

export type RuleItemForm = ConditionForm | GroupForm

/** A merchant, held with the name it was picked under, since closing the picker drops the page that held it */
export type PickedReference = {
  value: string
  label: string
}

export type RuleForm = {
  name: string
  match: ImportRuleMatch
  items: RuleItemForm[]
  merchant: PickedReference | null
  categoryId: string
  tags: ChosenTagOption[]
}

/**
 * Where a problem is shown: the name, the list of conditions as a whole, one condition or group by
 * its key, an amount condition's currency, or the three actions together
 */
export type RuleFieldKey =
  'name' | 'conditions' | 'actions' | `condition:${string}` | `currency:${string}` | `group:${string}`

export type RuleFieldErrors = Partial<Record<RuleFieldKey, string>>

export type RuleFormAction =
  | { type: 'name'; value: string }
  | { type: 'match'; value: ImportRuleMatch }
  | { type: 'addCondition'; groupKey: string | null; currency: string }
  | { type: 'addGroup'; currency: string }
  | { type: 'remove'; key: string }
  | {
      type: 'condition'
      key: string
      field: 'attribute' | 'operator' | 'value' | 'currency'
      value: string

      /** The account's name, sent with an account pick so the field can name it */
      label?: string
    }
  | { type: 'groupMatch'; key: string; value: ImportRuleMatch }

  /** The currencies arrived, so a saved amount waiting for its decimal places can be written */
  | { type: 'currencies'; currencies: Currency[] }

  /** Moves one item of the top list, or one condition of a group, to a place in its own list */
  | { type: 'move'; groupKey: string | null; from: number; to: number }
  | { type: 'merchant'; value: PickedReference | null }
  | { type: 'category'; value: string }
  | { type: 'tags'; value: ChosenTagOption[] }
