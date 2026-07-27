import { useMemo, useState } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import {
  useRunwaySettings,
  useUpdateRunwaySettings,
  type RunwayThresholds,
} from '@/api/user'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import {
  DEFAULT_RUNWAY_THRESHOLDS,
  normalizeRunwayThresholds,
} from '@/utils/runway'

type UseRunwaySettingsFormParams = {
  accounts: AccountsOverview[] | undefined
  accountsLoading: boolean
}

/**
 * Compares normalized runway thresholds by their persisted month values
 */
function runwayThresholdsEqual(a: RunwayThresholds, b: RunwayThresholds) {
  return a.riskyBelowMonths === b.riskyBelowMonths && a.healthyAtMonths === b.healthyAtMonths
}

/**
 * Filters accounts that can contribute real liquid runway
 */
function getSelectableRunwayAccounts(accounts: AccountsOverview[] | undefined) {
  return (accounts ?? []).filter(
    (account) => account.closed_at === null && !account.is_archived && account.account_kind === 'asset',
  )
}

/**
 * Owns runway account selection, threshold drafts, mutation feedback, and save/discard actions
 */
export function useRunwaySettingsForm({
  accounts,
  accountsLoading,
}: UseRunwaySettingsFormParams) {
  const { data: runwaySettings, isLoading: runwaySettingsLoading } = useRunwaySettings()
  const updateRunway = useUpdateRunwaySettings()
  const runwaySaveFeedback = useActionFeedback()
  const [runwayDraft, setRunwayDraft] = useState<Set<string> | null>(null)
  const runwayServerSet = useMemo(() => new Set(runwaySettings?.accountIds ?? []), [runwaySettings?.accountIds])
  const archivedRunwayServerSet = useMemo(
    () => new Set(runwaySettings?.archivedAccountIds ?? []),
    [runwaySettings?.archivedAccountIds],
  )
  const runwaySelection = runwayDraft ?? runwayServerSet
  const selectableAccounts = useMemo(
    () => getSelectableRunwayAccounts(accounts),
    [accounts],
  )
  const archivedRunwayAccounts = useMemo(
    () => (accounts ?? []).filter((account) => archivedRunwayServerSet.has(account.id)),
    [accounts, archivedRunwayServerSet],
  )
  const isRunwayDirty = useMemo(() => {
    if (!runwayDraft) return false
    if (runwayDraft.size !== runwayServerSet.size) return true
    for (const id of runwayDraft) if (!runwayServerSet.has(id)) return true
    return false
  }, [runwayDraft, runwayServerSet])
  const runwayServerThresholds = useMemo(
    () => normalizeRunwayThresholds(runwaySettings?.thresholds ?? DEFAULT_RUNWAY_THRESHOLDS),
    [runwaySettings?.thresholds],
  )
  const [runwayThresholdDraft, setRunwayThresholdDraft] = useState<RunwayThresholds | null>(null)
  const runwayThresholdValues = runwayThresholdDraft ?? runwayServerThresholds
  const isRunwayThresholdDirty = runwayThresholdDraft !== null
  const isRunwayPaneDirty = isRunwayDirty || isRunwayThresholdDirty
  const isRunwayPending = runwaySaveFeedback.isPending || updateRunway.isPending
  const canSaveRunway = runwaySettings !== undefined && isRunwayPaneDirty && !isRunwayPending
  const runwaySaveError = updateRunway.isError
    ? ((updateRunway.error as Error)?.message ?? 'Failed to save runway settings.')
    : null

  /**
   * Toggles a runway account against the current server selection or existing draft
   */
  function toggleRunwayAccount(id: string) {
    setRunwayDraft((currentDraft) => {
      const nextDraft = new Set(currentDraft ?? runwayServerSet)
      if (nextDraft.has(id)) nextDraft.delete(id)
      else nextDraft.add(id)
      return nextDraft
    })
  }

  /**
   * Stores threshold edits only while they differ from the normalized server values
   */
  function setRunwayThreshold(field: keyof RunwayThresholds, value: number) {
    setRunwayThresholdDraft((currentDraft) => {
      const nextDraft = normalizeRunwayThresholds({
        ...(currentDraft ?? runwayServerThresholds),
        [field]: value,
      })
      return runwayThresholdsEqual(nextDraft, runwayServerThresholds) ? null : nextDraft
    })
  }

  /**
   * Persists the selected runway accounts and threshold values
   */
  async function handleSaveRunway() {
    if (!canSaveRunway) return

    try {
      await runwaySaveFeedback.run(async () => {
        await updateRunway.mutateAsync({
          accountIds: Array.from(runwaySelection),
          thresholds: runwayThresholdValues,
        })
        setRunwayDraft(null)
        setRunwayThresholdDraft(null)
      })
    } catch {
      // Mutation errors surface through the pane-level save error text
    }
  }

  /**
   * Discards local runway selection and threshold drafts
   */
  function handleDiscardRunway() {
    setRunwayDraft(null)
    setRunwayThresholdDraft(null)
  }

  return {
    runwayLoading: accountsLoading || runwaySettingsLoading,
    selectableAccounts,
    archivedRunwayAccounts,
    runwaySelection,
    runwayThresholdValues,
    setRunwayThreshold,
    toggleRunwayAccount,
    isRunwayPaneDirty,
    isRunwayPending,
    canSaveRunway,
    runwaySaveError,
    runwaySaveStatus: runwaySaveFeedback.status,
    handleSaveRunway,
    handleDiscardRunway,
  }
}
