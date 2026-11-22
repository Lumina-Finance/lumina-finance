import type { Currency } from '@/api/currency'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import type { RuleFieldErrors, RuleFieldKey } from '@/pages/settings/components/import-rules-section/types'

/** What every condition row in the editor shares, whether it sits in the top list or in a group */
export type ConditionRowsShared = {
  errors: RuleFieldErrors
  currencies: Currency[]
  currencyOptions: DropdownOption[]
  accountOptions: DropdownOption[]
  onChange: (key: string, field: 'attribute' | 'operator' | 'value' | 'currency', value: string, label?: string) => void
  onRemove: (key: string) => void
  onTouch: (field: RuleFieldKey) => void
}
