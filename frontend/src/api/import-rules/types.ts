export type ImportRuleMatch = 'all' | 'any'

export type TextConditionAttribute = 'description' | 'note'
export type TextConditionOperator = 'contains' | 'not_contains' | 'is' | 'is_not' | 'starts_with' | 'ends_with'
export type AmountConditionOperator = 'is' | 'at_least' | 'at_most'
export type AccountConditionOperator = 'is' | 'is_not'
export type DirectionConditionValue = 'in' | 'out'

/** The bank's description, or a note, compared with text the user typed */
export type TextCondition = {
  kind: 'condition'
  attribute: TextConditionAttribute
  operator: TextConditionOperator
  value: string
}

/** Whether money came in or went out */
export type DirectionCondition = {
  kind: 'condition'
  attribute: 'direction'
  operator: 'is'
  value: DirectionConditionValue
}

/** Whether the transaction is in one account, named by its id */
export type AccountCondition = {
  kind: 'condition'
  attribute: 'account'
  operator: AccountConditionOperator
  value: string
}

/** An account condition as the server returns it, saying whether the account still exists */
export type AccountConditionResponse = AccountCondition & {
  account_state: 'exists' | 'deleted'
  account_name: string | null
}

/** An amount condition as sent: the figure is decimal text, as the user typed it */
export type AmountConditionRequest = {
  kind: 'condition'
  attribute: 'amount'
  operator: AmountConditionOperator
  value: string
  currency: string
}

/** An amount condition as returned: the figure is integer minor units of its currency */
export type AmountConditionResponse = {
  kind: 'condition'
  attribute: 'amount'
  operator: AmountConditionOperator
  value: number
  currency: string
}

export type ImportRuleConditionRequest = TextCondition | DirectionCondition | AccountCondition | AmountConditionRequest

export type ImportRuleCondition =
  TextCondition | DirectionCondition | AccountConditionResponse | AmountConditionResponse

/** Conditions held together behind one All or Any. A group holds no group */
export type ImportRuleGroupRequest = {
  kind: 'group'
  match: ImportRuleMatch
  conditions: ImportRuleConditionRequest[]
}

export type ImportRuleGroup = {
  kind: 'group'
  match: ImportRuleMatch
  conditions: ImportRuleCondition[]
}

export type ImportRuleItemRequest = ImportRuleConditionRequest | ImportRuleGroupRequest
export type ImportRuleItem = ImportRuleCondition | ImportRuleGroup

/** A merchant, category or tag a rule sets, with the name a row shows */
export type ImportRuleReference = {
  id: string
  name: string
}

export type ImportRule = {
  id: string
  name: string

  /** Where the rule is checked, counted from zero */
  position: number
  match: ImportRuleMatch
  conditions: ImportRuleItem[]
  merchant: ImportRuleReference | null
  category: ImportRuleReference | null
  tags: ImportRuleReference[]
  created_at: string
  updated_at: string
}

/** The conditions all of the user's rules may hold together, and how many they hold now */
export type ImportRuleBudget = {
  limit: number
  used: number
}

export type CreateImportRulePayload = {
  name: string
  match: ImportRuleMatch
  conditions: ImportRuleItemRequest[]
  merchant_id?: string | null
  category_id?: string | null
  tag_ids: string[]
}

/** Only the fields to change. A null merchant or category clears it */
export type UpdateImportRulePayload = {
  name?: string
  match?: ImportRuleMatch
  conditions?: ImportRuleItemRequest[]
  merchant_id?: string | null
  category_id?: string | null
  tag_ids?: string[]
}

export type UpdateImportRuleRequest = {
  ruleId: string
  payload: UpdateImportRulePayload
}

/** Where a rule should go, counted from zero in the order the rules are checked */
export type MoveImportRuleRequest = {
  ruleId: string
  position: number
}

/**
 * One file row as the import page holds it, for the rules to be asked what they give it
 *
 * It is the row the save would send. Amounts are text in the row's currency, as the file gives them
 */
export type ImportRuleMatchRow = {
  /** The merchant column of a file, or the payee of an OFX or QIF one */
  description: string | null

  /** The notes column of a file, or the memo of an OFX or QIF one */
  note: string | null

  /** The cell's own digits, read in the row's currency as the save reads them */
  amount: string
  currency: string

  /** Null for an account the import is still to create */
  account_id: string | null
  is_transfer: boolean

  /** The tags the file gives the row, so a tag a rule adds that the file gives too counts for no rule */
  tag_names: string[]
}

/** A merchant, category or tag the rules give a row, with the rule that gave it */
export type ImportRuleGivenValue = {
  id: string
  name: string
  rule: ImportRuleReference
}

/** What the rules give one row, empty for a row they leave alone */
export type ImportRuleRowMatch = {
  merchant: ImportRuleGivenValue | null
  category: ImportRuleGivenValue | null

  /** Only the tags the file does not already give the row */
  tags: ImportRuleGivenValue[]

  /** How many tags the row ends with, the file's and the rules', so a row past 32 can be named before the save refuses it */
  tag_count: number
}

/** How many rows a rule gave a value the row ends with */
export type ImportRuleRowCount = {
  rule: ImportRuleReference
  row_count: number
}

/** What the rules give each row in the order sent, and each rule that gave something, first checked first */
export type ImportRuleMatchesResponse = {
  rows: ImportRuleRowMatch[]
  rules: ImportRuleRowCount[]

  /** Changes whenever the rules the answer came from changed */
  rules_version: string
}
