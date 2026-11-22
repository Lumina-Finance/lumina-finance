import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Currency } from '@/api/currency'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { FieldError } from '@/components/forms/FieldError'
import { HintButton } from '@/components/tooltips/HintButton'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import {
  CONDITION_ATTRIBUTE_OPTIONS,
  CONDITION_OPERATOR_OPTIONS,
  DIRECTION_OPTIONS,
} from '@/pages/settings/components/import-rules-section/constants'
import type { ConditionForm } from '@/pages/settings/components/import-rules-section/types'
import {
  getConditionBaseId,
  getConditionControlId,
  getConditionCurrencyId,
} from '@/pages/settings/components/import-rules-section/utils/form'
import { formatCurrencySymbol, getSymbolInputStyle } from '@/utils/formatCurrency'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent, getMoneyPlaceholder } from '@/utils/moneyInput'

/**
 * The largest amount, in minor units, the field tidies to its decimal places as it loses focus. A number holds
 * no more exactly, so a larger amount is left as typed and sent as text, for the server to take or refuse on
 * the row, where tidying it would change it without a word
 */
const LARGEST_SETTLED_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * Where a row's layout changes, by the width of the row's own box
 *
 * A row inside a group sits 0.875rem further in than one in the top list (the group's 2px rule and 0.75rem of
 * padding), so its box is that much narrower. Its widths are that much smaller, so every row, in a group or not,
 * changes layout at the same width of the editor. The strings are written out whole for the stylesheet to find
 */
const ROW_LAYOUTS = {
  top: {
    fields:
      '@min-[24rem]/condition:grid-cols-[10rem_minmax(0,1fr)] @min-[39rem]/condition:grid-cols-[10rem_12rem_minmax(0,1fr)]',
    value: '@min-[24rem]/condition:col-span-2 @min-[39rem]/condition:col-span-1',
    amount: '@min-[18rem]/condition:grid-cols-[minmax(0,1fr)_6.5rem]',
  },
  group: {
    fields:
      '@min-[23.125rem]/condition:grid-cols-[10rem_minmax(0,1fr)] @min-[38.125rem]/condition:grid-cols-[10rem_12rem_minmax(0,1fr)]',
    value: '@min-[23.125rem]/condition:col-span-2 @min-[38.125rem]/condition:col-span-1',
    amount: '@min-[17.125rem]/condition:grid-cols-[minmax(0,1fr)_6.5rem]',
  },
} as const

type ConditionRowProps = {
  condition: ConditionForm

  /** Whether the row sits inside a group, since that sets where its layout changes */
  inGroup: boolean

  /** Names the row for a screen reader, such as "Condition 2" or "Group 1 condition 2" */
  name: string
  error?: string

  /** A refusal of the amount's currency, shown on the currency dropdown rather than on the amount */
  currencyError?: string
  currencies: Currency[]
  currencyOptions: DropdownOption[]
  accountOptions: DropdownOption[]

  /** The grip that moves the row, placed at its start */
  grip: ReactNode
  onChange: (field: 'attribute' | 'operator' | 'value' | 'currency', value: string, label?: string) => void
  onRemove: () => void

  /** Marks the row's value as left, so a problem with it shows */
  onTouch: () => void
}

function HiddenLabel({ id, children }: { id: string; children: string }) {
  return (
    <span id={id} className="sr-only">
      {children}
    </span>
  )
}

/**
 * The amount's field, apart from the row so the money input's hook only runs where there is an amount
 */
function AmountField({
  condition,
  layoutClassName,
  name,
  currencies,
  currencyOptions,
  hasError,
  hasCurrencyError,
  errorId,
  onChange,
  onTouch,
}: Pick<ConditionRowProps, 'condition' | 'name' | 'currencies' | 'currencyOptions' | 'onChange' | 'onTouch'> & {
  layoutClassName: string
  hasError: boolean
  hasCurrencyError: boolean
  errorId: string | undefined
}) {
  // A saved amount waits for its currency's own decimal places, so the field is locked until they are
  // known: an amount read at a guessed number of them would be a hundred times off for some currencies.
  // A condition with no saved amount to write has nothing to wait for, so its field stays open
  const isLocked = condition.savedMinorUnits !== null
  const exponent = findCurrencyExponent(currencies, condition.currency) ?? DEFAULT_MINOR_UNIT_EXPONENT
  const symbol = condition.currency ? formatCurrencySymbol(condition.currency) : ''
  const moneyInput = useMoneyInput({
    value: condition.value,
    exponent,
    onChange: (value) => onChange('value', value),
    onBlur: onTouch,
    settleCeiling: LARGEST_SETTLED_MINOR_UNITS,
  })
  const currencyId = getConditionCurrencyId(condition.key)
  const currencyLabelId = `${currencyId}-label`

  return (
    // The pair shares a line while the row has the room for both, and stacks on a phone, one item to a line
    <div className={`grid gap-2 ${layoutClassName}`}>
      <div className="relative">
        {symbol && (
          <span className="app-input-prefix pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" aria-hidden>
            {symbol}
          </span>
        )}
        <input
          id={getConditionControlId(condition.key)}
          className={`app-input ${symbol ? 'pl-8' : ''} ${hasError ? 'app-input-error' : ''}`}
          style={getSymbolInputStyle(symbol)}
          aria-label={`${name} amount`}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={errorId}
          placeholder={getMoneyPlaceholder(exponent)}
          disabled={isLocked}
          aria-busy={isLocked || undefined}
          {...moneyInput}
        />
      </div>
      <HiddenLabel id={currencyLabelId}>{`${name} currency`}</HiddenLabel>
      <Dropdown
        id={currencyId}
        options={currencyOptions}
        value={condition.currency}
        onChange={(value) => onChange('currency', value)}
        hasError={hasCurrencyError}
        describedBy={hasCurrencyError ? errorId : undefined}
        labelledBy={`${currencyLabelId} ${currencyId}`}
        placeholder="Currency"
        searchable
        searchPlaceholder="Search currencies…"
        matchFieldWidth
        clampToPanel
      />
    </div>
  )
}

/**
 * One condition of a rule: its attribute, operator and value on a row, with a grip and a remove button
 *
 * The fields carry no visible labels, as the layout asks, so each is named for a screen reader by its
 * row, such as "Condition 2 operator". A problem with the row shows under it and describes its value
 */
export function ConditionRow({
  condition,
  inGroup,
  name,
  error,
  currencyError,
  currencies,
  currencyOptions,
  accountOptions,
  grip,
  onChange,
  onRemove,
  onTouch,
}: ConditionRowProps) {
  const layout = ROW_LAYOUTS[inGroup ? 'group' : 'top']
  const base = getConditionBaseId(condition.key)
  const shownError = error ?? currencyError
  const errorId = shownError ? `${base}-error` : undefined
  const attributeId = `${base}-attribute`
  const operatorId = `${base}-operator`
  const valueId = getConditionControlId(condition.key)
  const accountOption = condition.value
    ? {
        value: condition.value,
        label: condition.accountDeleted ? 'Deleted account' : (condition.accountName ?? 'Account'),
      }
    : undefined

  let valueField: ReactNode
  switch (condition.attribute) {
    case 'description':
    case 'note':
      valueField = (
        <input
          id={valueId}
          type="text"
          className={`app-input ${error ? 'app-input-error' : ''}`}
          aria-label={`${name} value`}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          placeholder="Text to match"
          value={condition.value}
          onChange={(event) => onChange('value', event.target.value)}
          onBlur={onTouch}
        />
      )
      break
    case 'amount':
      valueField = (
        <AmountField
          condition={condition}
          layoutClassName={layout.amount}
          name={name}
          currencies={currencies}
          currencyOptions={currencyOptions}
          hasError={Boolean(error)}
          hasCurrencyError={Boolean(currencyError)}
          errorId={errorId}
          onChange={onChange}
          onTouch={onTouch}
        />
      )
      break
    case 'direction':
      valueField = (
        <>
          <HiddenLabel id={`${valueId}-label`}>{`${name} value`}</HiddenLabel>
          <Dropdown
            id={valueId}
            options={DIRECTION_OPTIONS}
            value={condition.value}
            onChange={(value) => onChange('value', value)}
            labelledBy={`${valueId}-label ${valueId}`}
            matchFieldWidth
          />
        </>
      )
      break
    case 'account':
      valueField = (
        <>
          <HiddenLabel id={`${valueId}-label`}>{`${name} value`}</HiddenLabel>
          <Dropdown
            id={valueId}
            options={accountOptions}
            value={condition.value}
            selectedOption={accountOption}
            onChange={(value) => {
              onChange('value', value, accountOptions.find((option) => option.value === value)?.label)
              onTouch()
            }}
            hasError={Boolean(error)}
            describedBy={errorId}
            labelledBy={`${valueId}-label ${valueId}`}
            placeholder="Select account…"
            searchable
            searchPlaceholder="Search accounts…"
            matchFieldWidth
          />
        </>
      )
      break
  }

  return (
    <div>
      <div className="flex items-start gap-1.5">
        <div className="flex h-10 items-center">{grip}</div>
        {/* The row's own width decides its layout, and a group's rows change at widths that much larger, so
            every row changes together: one line of three fields from 39rem, which leaves the value 16rem, the
            amount and its currency side by side. Below that the value takes a line under the attribute and
            operator, and on a phone each field has its own line */}
        <div className="@container/condition min-w-0 flex-1">
          <div className={`grid gap-2 ${layout.fields}`}>
            <div>
              <HiddenLabel id={`${attributeId}-label`}>{`${name} attribute`}</HiddenLabel>
              <Dropdown
                id={attributeId}
                options={CONDITION_ATTRIBUTE_OPTIONS}
                value={condition.attribute}
                onChange={(value) => onChange('attribute', value)}
                labelledBy={`${attributeId}-label ${attributeId}`}
                matchFieldWidth
              />
            </div>
            <div>
              <HiddenLabel id={`${operatorId}-label`}>{`${name} operator`}</HiddenLabel>
              <Dropdown
                id={operatorId}
                options={CONDITION_OPERATOR_OPTIONS[condition.attribute]}
                value={condition.operator}
                onChange={(value) => onChange('operator', value)}
                labelledBy={`${operatorId}-label ${operatorId}`}
                matchFieldWidth
              />
            </div>
            <div className={`min-w-0 ${layout.value}`}>{valueField}</div>
          </div>
          {/* Inside the fields' column, so the message ends where the value field does at every width, never over
              the remove button's column */}
          <FieldError message={shownError} id={errorId} className="mt-1" />
          {condition.accountDeleted && !shownError && condition.attribute === 'account' && (
            <p className="mt-1 text-right text-xs font-medium leading-5" style={{ color: 'var(--app-warning-text)' }}>
              This account was deleted, so the condition never matches
            </p>
          )}
        </div>
        <div className="flex h-10 items-center">
          <HintButton
            type="button"
            className="app-icon-button shrink-0"
            aria-label={`Remove ${name.toLowerCase()}`}
            hint="Remove"
            onClick={onRemove}
          >
            <X size={18} aria-hidden />
          </HintButton>
        </div>
      </div>
    </div>
  )
}
