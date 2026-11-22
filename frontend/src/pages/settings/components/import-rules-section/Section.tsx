import { useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useCurrencies } from '@/api/currency'
import {
  moveImportRuleInList,
  useDeleteImportRule,
  useImportRuleBudget,
  useMoveImportRule,
  type ImportRule,
} from '@/api/import-rules'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import LoadingRegion from '@/components/loading/Region'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { DELETE_SPINNER_MS } from '@/pages/settings/components/import-rules-section/constants'
import { useHeldFocus } from '@/pages/settings/components/import-rules-section/hooks/useHeldFocus'
import { useImportRulesList } from '@/pages/settings/components/import-rules-section/hooks/useList'
import ImportRulesList from '@/pages/settings/components/import-rules-section/list/List'
import RuleModal from '@/pages/settings/components/import-rules-section/modal/Modal'
import { getCreateRuleReason } from '@/pages/settings/components/import-rules-section/utils/budget'
import { getDropPosition } from '@/pages/settings/components/import-rules-section/utils/moves'
import { SETTINGS_LIST_LOADING_OVERLAY_CLASS } from '@/pages/settings/components/shared/constants'
import SettingsCard from '@/pages/settings/components/Card'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import { waitForMilliseconds } from '@/utils/timing'

/**
 * Settings section for import rules: the rules in the order they are checked, a button to create one,
 * and for each rule an editor, a delete and a way to move it
 *
 * A move shows at once and is put back with the reason if the server refuses it. A delete asks in
 * place, as the merchants list does
 */
export default function ImportRulesSettingsSection() {
  const deleteRule = useDeleteImportRule()
  const moveRule = useMoveImportRule()
  const { data: currencies = [] } = useCurrencies()
  const { data: budget } = useImportRuleBudget()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalKey, setModalKey] = useState(0)
  // Held apart from the open flag so the editor keeps its contents while it animates out
  const [modalRule, setModalRule] = useState<ImportRule | null>(null)
  const [confirmingDeleteRuleId, setConfirmingDeleteRuleId] = useState<string | null>(null)
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [locallyDeletedRuleIds, setLocallyDeletedRuleIds] = useState<string[]>([])
  const ruleList = useImportRulesList(locallyDeletedRuleIds)
  const sectionRef = useRef<HTMLElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const { holdRule } = useHeldFocus(sectionRef, createButtonRef)
  // The rows and everything describing how they are laid out are held together, so a list that keeps
  // its rows never loses the scroll cap that holds them
  const snapshot = useMemo(
    () => ({
      hasMore: ruleList.hasMoreRules,
      shouldScroll: ruleList.shouldScrollRules,
      showListEnd: ruleList.showRuleListEnd,
      showListMoreIndicator: ruleList.showRuleListMoreIndicator,
      rules: ruleList.visibleRules,
    }),
    [
      ruleList.hasMoreRules,
      ruleList.shouldScrollRules,
      ruleList.showRuleListEnd,
      ruleList.showRuleListMoreIndicator,
      ruleList.visibleRules,
    ],
  )

  const openEditor = (rule: ImportRule | null) => {
    setListError(null)
    setConfirmingDeleteRuleId(null)
    setModalRule(rule)
    setModalKey((key) => key + 1)
    setIsModalOpen(true)
  }

  const handleMove = (rule: ImportRule, position: number) => {
    setListError(null)
    // The shown rows change in this render, so a dropped row never springs back for a frame while the
    // list waits to notice that the cache changed
    ruleList.setVisibleRules((rules) => moveImportRuleInList(rules, rule.id, position))
    moveRule.mutate(
      { ruleId: rule.id, position },
      {
        onError: (error) =>
          setListError(
            error instanceof Error ? error.message : 'Failed to move rule. The order was put back. Please try again.',
          ),
      },
    )
  }

  const handleDrop = (from: number, to: number) => {
    const rules = ruleList.visibleRules
    if (!rules[from] || !rules[to]) return
    const position = getDropPosition(rules, rules[from].id, rules[to].id)
    if (position !== null) handleMove(rules[from], position)
  }

  const handleDeleteRequest = (rule: ImportRule) => {
    setListError(null)
    setConfirmingDeleteRuleId(rule.id)
  }

  const handleDelete = async (rule: ImportRule) => {
    setListError(null)
    setDeletingRuleId(rule.id)

    const result = await Promise.allSettled([deleteRule.mutateAsync(rule.id), waitForMilliseconds(DELETE_SPINNER_MS)])

    if (result[0].status === 'fulfilled') {
      setLocallyDeletedRuleIds((ids) => (ids.includes(rule.id) ? ids : [...ids, rule.id]))
      ruleList.setVisibleRules((rules) => rules.filter((item) => item.id !== rule.id))
      setConfirmingDeleteRuleId(null)
      // The confirm button is gone with its row, so focus goes to the rule that took the place
      holdRule(rule.id, true)
    } else {
      const error = result[0].reason
      setListError(error instanceof Error ? error.message : 'Failed to delete rule.')
    }

    setDeletingRuleId(null)
  }

  return (
    <section id="import-rules" ref={sectionRef}>
      <SettingsSectionHeader
        title="Import rules"
        description="Set a merchant, category and tags on imported transactions that match. Rules are checked in the order shown."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <GlassSearchField
              value={ruleList.search}
              onValueChange={ruleList.setSearch}
              onSubmit={() => ruleList.setActiveSearch(ruleList.search)}
              placeholder="Search import rules…"
              wrapperClassName="flex-1"
            />
            <DisabledReasonButton
              ref={createButtonRef}
              type="button"
              className="app-primary-button shrink-0"
              disabledReason={getCreateRuleReason(budget)}
              onClick={() => openEditor(null)}
            >
              <Plus size={16} aria-hidden />
              Create rule
            </DisabledReasonButton>
          </div>

          {listError && (
            <p role="alert" className="text-sm" style={{ color: 'var(--app-negative)' }}>
              {listError}
            </p>
          )}

          <LoadingRegion
            loading={ruleList.showInitialRuleLoading}
            label="Loading import rules"
            transitionKey={ruleList.activeSearch}
            snapshot={snapshot}
            overlayClassName={SETTINGS_LIST_LOADING_OVERLAY_CLASS}
            animateLoadingHeight
          >
            {(shown) => (
              <ImportRulesList
                activeSearch={ruleList.activeSearch}
                rules={shown.rules}
                currencies={currencies}
                hasMoreRules={shown.hasMore}
                listError={ruleList.ruleListError}
                listFailed={ruleList.ruleListFailed}
                showFetchingMoreRules={ruleList.showFetchingMoreRules}
                showInitialRuleLoading={ruleList.showInitialRuleLoading}
                showRuleListEnd={shown.showListEnd}
                showRuleListMoreIndicator={shown.showListMoreIndicator}
                shouldScrollRules={shown.shouldScroll}
                ruleListRef={ruleList.ruleListRef}
                confirmingDeleteRuleId={confirmingDeleteRuleId}
                deletingRuleId={deletingRuleId}
                isMoving={moveRule.isPending}
                onDeleteCancel={() => {
                  // The cancel button is gone with the confirmation, so focus returns to the row's menu button
                  if (confirmingDeleteRuleId) holdRule(confirmingDeleteRuleId)
                  setConfirmingDeleteRuleId(null)
                }}
                onDeleteConfirm={handleDelete}
                onDeleteRequest={handleDeleteRequest}
                onEdit={openEditor}
                onMove={(rule, position) => {
                  // A move chosen in the row's menu keeps focus on that menu's button, through the rows being
                  // drawn again and, when the rule leaves the shown rows, on the rule that takes its place
                  holdRule(rule.id)
                  handleMove(rule, position)
                }}
                onDrop={handleDrop}
                onListMoreClick={ruleList.handleRuleListMoreClick}
                onListScroll={ruleList.handleRuleListScroll}
              />
            )}
          </LoadingRegion>
        </div>
      </SettingsCard>

      <RuleModal
        key={modalKey}
        open={isModalOpen}
        rule={modalRule}
        onClose={() => setIsModalOpen(false)}
        onExitComplete={() => setModalRule(null)}
      />
    </section>
  )
}
