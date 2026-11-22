import { useMemo, useState, type FormEvent } from 'react'
import { ListOrdered, Plus } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useAccounts } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useCreateImportRule, useImportRuleBudget, useUpdateImportRule, type ImportRule } from '@/api/import-rules'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import CreateModalSectionHeadingRow from '@/components/create-modal/SectionHeadingRow'
import Dropdown from '@/components/dropdown/Dropdown'
import LoadFailure from '@/components/errors/LoadFailure'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useAuth } from '@/hooks/useAuth'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { ConditionRow } from '@/pages/settings/components/import-rules-section/modal/ConditionRow'
import { GroupBlock } from '@/pages/settings/components/import-rules-section/modal/GroupBlock'
import { ThenSection } from '@/pages/settings/components/import-rules-section/modal/ThenSection'
import type { ConditionRowsShared } from '@/pages/settings/components/import-rules-section/modal/types'
import {
  MATCH_OPTIONS,
  NAME_TAKEN_MESSAGE,
  RULE_ERROR_IDS,
  RULE_MODAL_IDS,
} from '@/pages/settings/components/import-rules-section/constants'
import { SortableItem } from '@/pages/settings/components/import-rules-section/sortable/SortableItem'
import { SortableList } from '@/pages/settings/components/import-rules-section/sortable/SortableList'
import type { RuleFieldErrors, RuleFormAction } from '@/pages/settings/components/import-rules-section/types'
import { getAddConditionReason } from '@/pages/settings/components/import-rules-section/utils/budget'
import {
  buildInitialRuleForm,
  buildRulePayload,
  buildRuleUpdatePayload,
  countConditions,
  getClearedErrorKeys,
  getConditionFieldKey,
  getCurrencyFieldKey,
  getNextRuleForm,
  getRuleControlIds,
  hasAmountCondition,
  getRuleFieldOrder,
  getRuleServerErrors,
  isRuleMatch,
  validateRuleForm,
} from '@/pages/settings/components/import-rules-section/utils/form'
import { getSaveFailureMessage } from '@/utils/createFailure'
import { buildCurrencyOptions } from '@/components/transactions/transaction-modal/utils/options'

type RuleModalProps = {
  open: boolean

  /** The rule being edited, or null for a new one. The editor holds a copy and drops it on close */
  rule: ImportRule | null
  onClose: () => void
  onExitComplete: () => void
}

/**
 * The editor for one import rule, creating a new one at the bottom of the list or changing a saved one
 *
 * It holds every change until the save button and drops them on Cancel or close, since the form lives
 * only while the dialogue does. A refusal from the server lands on the field it names, a condition's on
 * its own row, and only what it couldn't place shows beside the buttons
 */
export default function RuleModal({ open, rule, onClose, onExitComplete }: RuleModalProps) {
  const { user } = useAuth()
  const { data: currencies = [], error: currenciesError, isError: currenciesFailed } = useCurrencies()
  const { data: accounts = [] } = useAccounts()
  const { data: budget } = useImportRuleBudget()
  const createRule = useCreateImportRule()
  const updateRule = useUpdateImportRule()
  const isPending = createRule.isPending || updateRule.isPending
  // The editor opens on a protected page, where the signed-in user is always there
  const baseCurrency = user!.base_currency

  const [draft, setDraft] = useState(() => buildInitialRuleForm(rule, currencies, baseCurrency))
  const [serverErrors, setServerErrors] = useState<RuleFieldErrors>({})
  const [submitError, setSubmitError] = useState('')

  // A saved amount opened before the currencies arrived is written once its decimal places are known
  const form = useMemo(() => getNextRuleForm(draft, { type: 'currencies', currencies }), [draft, currencies])

  const problems: RuleFieldErrors = { ...serverErrors, ...validateRuleForm(form) }
  const refusal = useRefusedSubmit(problems, getRuleFieldOrder(form), getRuleControlIds(form))
  const errors = refusal.errors

  /**
   * Shows what the server refused the way a refused press shows its problems, and brings the first
   * field it named into view
   */
  const showServerErrors = (placed: RuleFieldErrors) => {
    setServerErrors(placed)
    if (Object.keys(placed).length === 0) return
    refusal.markRefused()
    const first = getRuleFieldOrder(form).find((key) => placed[key])
    const controlId = first && getRuleControlIds(form)[first]
    if (controlId) window.requestAnimationFrame(() => document.getElementById(controlId)?.focus())
  }

  const dispatch = (action: RuleFormAction) => {
    setDraft((current) => getNextRuleForm(getNextRuleForm(current, { type: 'currencies', currencies }), action))
    setSubmitError('')
    const cleared = getClearedErrorKeys(action)
    setServerErrors((current) => {
      if (!cleared.some((key) => current[key] !== undefined)) return current
      const next = { ...current }
      for (const key of cleared) delete next[key]
      return next
    })
  }

  const currencyOptions = useMemo(() => buildCurrencyOptions(currencies, ''), [currencies])
  const accountOptions = useMemo(
    () =>
      accounts
        .filter((account) => !account.is_archived && account.group_id === null)
        .map((account) => ({ value: account.id, label: account.name, badge: account.currency })),
    [accounts],
  )

  const addDisabledReason = getAddConditionReason(budget, rule, countConditions(form.items))

  const shared: ConditionRowsShared = {
    errors,
    currencies,
    currencyOptions,
    accountOptions,
    onChange: (key, field, value, label) => dispatch({ type: 'condition', key, field, value, label }),
    onRemove: (key) => dispatch({ type: 'remove', key }),
    onTouch: (field) => refusal.touch(field),
  }

  // Conditions and groups are numbered apart, from one, as a person would count them
  let conditionNumber = 0
  let groupNumber = 0
  const itemNumbers = form.items.map((item) => (item.kind === 'group' ? ++groupNumber : ++conditionNumber))
  const itemNames = form.items.map((item, index) =>
    item.kind === 'group' ? `Group ${itemNumbers[index]}` : `Condition ${itemNumbers[index]}`,
  )
  const itemEntries = form.items.map((item, index) => ({ id: item.key, label: itemNames[index] }))

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!refusal.guard()) return

    const handleError = (error: unknown) => {
      if (error instanceof ApiError && error.fieldErrors) {
        const { errors: placed, unplaced } = getRuleServerErrors(error.fieldErrors, form)
        showServerErrors(placed)
        setSubmitError(unplaced.length > 0 ? error.message : '')
        return
      }
      if (error instanceof ApiError && error.status === 409) {
        if (error.message === NAME_TAKEN_MESSAGE) {
          showServerErrors({ name: error.message })
          setSubmitError('')
        } else {
          // The rules changed under the save, such as a merchant deleted at the same moment, so no field is to blame
          setSubmitError(`${error.message}. Please check what the rule sets and try again.`)
        }
        return
      }
      setSubmitError(getSaveFailureMessage(error))
    }

    if (rule) {
      const payload = buildRuleUpdatePayload(form, rule, currencies)
      if (Object.keys(payload).length === 0) {
        onClose()
        return
      }
      updateRule.mutate({ ruleId: rule.id, payload }, { onSuccess: onClose, onError: handleError })
      return
    }

    createRule.mutate(buildRulePayload(form), { onSuccess: onClose, onError: handleError })
  }

  const matchLabelId = `${RULE_MODAL_IDS.match}-label`

  return (
    <ModalTitledPanel
      open={open}
      titleId="import-rule-title"
      title={rule ? 'Edit rule' : 'Create rule'}
      eyebrow={rule ? 'Import rule' : 'New import rule'}
      RailIcon={ListOrdered}
      railLabel="Import rule"
      widthClassName="max-w-4xl"
      onClose={onClose}
      onExitComplete={onExitComplete}
      onSubmit={handleSubmit}
      closeDisabled={isPending}
      footer={
        <ModalFormFooter
          submitLabel={rule ? 'Save' : 'Create rule'}
          submitDisabled={isPending}
          submitBlockedReason={refusal.blockedReason}
          submitWidthClassName="w-full sm:w-40"
          error={submitError}
          onCancel={onClose}
        />
      }
    >
      {/* Wrapping a message so its last line never holds a word alone */}
      <div className="space-y-5 [&_[role=alert]]:text-pretty">
        <CreateModalSectionFrame step="01">
          <div className="min-w-0 space-y-3">
            <CreateModalSectionHeadingRow label="Name" error={errors.name} errorId={RULE_ERROR_IDS.name} />
            <input
              id={RULE_MODAL_IDS.name}
              type="text"
              className={`app-input ${errors.name ? 'app-input-error' : ''}`}
              aria-label="Rule name"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? RULE_ERROR_IDS.name : undefined}
              placeholder="e.g. Groceries"
              value={form.name}
              onChange={(event) => dispatch({ type: 'name', value: event.target.value })}
              onBlur={() => refusal.touch('name')}
            />
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="02">
          <div className="min-w-0 space-y-3">
            <CreateModalSectionHeadingRow label="When" error={errors.conditions} errorId={RULE_ERROR_IDS.conditions} />

            <div className="flex items-center gap-2">
              <span id={matchLabelId} className="sr-only">
                The rule matches
              </span>
              <div className="w-24 shrink-0">
                <Dropdown
                  id={RULE_MODAL_IDS.match}
                  options={MATCH_OPTIONS}
                  value={form.match}
                  onChange={(value) => {
                    if (isRuleMatch(value)) dispatch({ type: 'match', value })
                  }}
                  labelledBy={`${matchLabelId} ${RULE_MODAL_IDS.match}`}
                  matchFieldWidth
                />
              </div>
              <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                of these match
              </span>
            </div>

            <SortableList
              entries={itemEntries}
              onMove={(from, to) => dispatch({ type: 'move', groupKey: null, from, to })}
            >
              <ul className="space-y-3">
                {form.items.map((item, index) => (
                  <SortableItem
                    key={item.key}
                    id={item.key}
                    gripLabel={`Move ${itemNames[index].toLowerCase()}`}
                    disabledReason={form.items.length < 2 ? 'Please add another condition to reorder' : null}
                    surface="dialogue"
                  >
                    {(grip) =>
                      item.kind === 'group' ? (
                        <GroupBlock
                          group={item}
                          number={itemNumbers[index]}
                          grip={grip}
                          shared={shared}
                          addDisabledReason={addDisabledReason}
                          onMatch={(value) => dispatch({ type: 'groupMatch', key: item.key, value })}
                          onRemove={() => dispatch({ type: 'remove', key: item.key })}
                          onAdd={() => dispatch({ type: 'addCondition', groupKey: item.key, currency: baseCurrency })}
                          onMoveCondition={(from, to) => dispatch({ type: 'move', groupKey: item.key, from, to })}
                        />
                      ) : (
                        <ConditionRow
                          condition={item}
                          inGroup={false}
                          name={itemNames[index]}
                          error={errors[getConditionFieldKey(item.key)]}
                          currencyError={errors[getCurrencyFieldKey(item.key)]}
                          currencies={currencies}
                          currencyOptions={currencyOptions}
                          accountOptions={accountOptions}
                          grip={grip}
                          onChange={(field, value, label) => shared.onChange(item.key, field, value, label)}
                          onRemove={() => shared.onRemove(item.key)}
                          onTouch={() => shared.onTouch(getConditionFieldKey(item.key))}
                        />
                      )
                    }
                  </SortableItem>
                ))}
              </ul>
            </SortableList>

            {/* An amount can't be written or chosen a currency for without the list, so the way out is shown with it */}
            {currenciesFailed && hasAmountCondition(form.items) && (
              <LoadFailure className="pt-1" error={currenciesError} subject="Currencies" />
            )}

            <div className="flex flex-wrap gap-2">
              <DisabledReasonButton
                id={RULE_MODAL_IDS.conditionsAdd}
                type="button"
                className="app-secondary-button flex items-center gap-1"
                disabledReason={addDisabledReason}
                onClick={() => dispatch({ type: 'addCondition', groupKey: null, currency: baseCurrency })}
              >
                <Plus size={15} aria-hidden />
                Add condition
              </DisabledReasonButton>
              <DisabledReasonButton
                type="button"
                className="app-secondary-button flex items-center gap-1"
                disabledReason={addDisabledReason}
                onClick={() => dispatch({ type: 'addGroup', currency: baseCurrency })}
              >
                <Plus size={15} aria-hidden />
                Add group
              </DisabledReasonButton>
            </div>
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="03">
          <div className="min-w-0 space-y-3">
            <CreateModalSectionHeadingRow label="Then" error={errors.actions} errorId={RULE_ERROR_IDS.actions} />
            <ThenSection
              merchant={form.merchant}
              categoryId={form.categoryId}
              tags={form.tags}
              hasError={Boolean(errors.actions)}
              errorId={errors.actions ? RULE_ERROR_IDS.actions : undefined}
              onMerchant={(value) => dispatch({ type: 'merchant', value })}
              onCategory={(value) => dispatch({ type: 'category', value })}
              onTags={(value) => dispatch({ type: 'tags', value })}
              onTouch={() => refusal.touch('actions')}
            />
          </div>
        </CreateModalSectionFrame>
      </div>
    </ModalTitledPanel>
  )
}
