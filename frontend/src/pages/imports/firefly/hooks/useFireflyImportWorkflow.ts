import { useMemo, useState, type ChangeEvent } from 'react'
import { useAccounts } from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useCurrencies } from '@/api/currency'
import {
  useImportFireflyBudgets,
  useImportFireflyTransactions,
  type FireflyTransactionImportResponse,
} from '@/api/fireflyImports'
import { useInstitutions } from '@/api/institutions'
import { waitForMilliseconds } from '@/utils/timing'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '../../constants'
import type {
  ImportCategoryKind,
  ImportFileDraft,
  ImportOverlayPhase,
  ImportProgressStep,
} from '../../types'
import {
  buildImportAccountOptions,
  buildImportCategoryMatchOptions,
  buildImportCurrencyOptions,
  buildImportInstitutionOptions,
  getErrorMessage,
  groupPreviewRowsByDate,
  inferAccountMappings,
  removeRecordKey,
  removeSetValue,
} from '../../utils'
import {
  FIREFLY_BALANCE_ADJUSTMENT_CATEGORY_NAME,
  FIREFLY_CSV_PROCESSING_MIN_MS,
  FIREFLY_IMPORT_OVERLAY_MIN_MS,
  FIREFLY_IMPORT_STAGES,
  FIREFLY_IMPORT_STAGE_CROSS_OFF_MS,
  FIREFLY_IMPORT_STAGE_MIN_MS,
  FIREFLY_SAMPLE_PREVIEW_LIMIT,
  FIREFLY_TRANSFER_CATEGORY_NAME,
} from '../constants'
import type {
  FireflyBudgetDraft,
  FireflyBudgetImportStatus,
  FireflyFileKind,
  FireflyImportStageState,
} from '../types'
import {
  buildFireflyAccountPrefills,
  buildFireflyBudgetDrafts,
  buildFireflyBudgetImportBudgets,
  buildFireflyCategoryKinds,
  buildFireflyImportPayload,
  buildFireflyPreviewRows,
  enrichFireflySkippedRows,
  forecastFireflyImport,
  formatFireflyImportSummary,
  getFireflyFileHeaders,
  getFireflyFileRows,
  getFireflyImportedCategories,
  getFireflyTrackedAccountNames,
  inferFireflyCategoryMappings,
  readFireflyCsvFile,
  type FireflyAccountCreateDetails,
} from '../utils'

export function useFireflyImportWorkflow() {
  const [transactionsFile, setTransactionsFile] = useState<ImportFileDraft | null>(null)
  const [budgetsFile, setBudgetsFile] = useState<ImportFileDraft | null>(null)
  const [processingFileKind, setProcessingFileKind] = useState<FireflyFileKind | null>(null)
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const [accountCreateTypes, setAccountCreateTypes] = useState<Record<string, string>>({})
  const [accountCreateCurrencies, setAccountCreateCurrencies] = useState<Record<string, string>>({})
  const [accountCreateInstitutions, setAccountCreateInstitutions] = useState<Record<string, string>>({})
  const [selectedAccountRows, setSelectedAccountRows] = useState<Set<string>>(() => new Set())
  const [batchAccountType, setBatchAccountType] = useState('')
  const [batchAccountCurrency, setBatchAccountCurrency] = useState('')
  const [batchAccountInstitution, setBatchAccountInstitution] = useState('')
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({})
  const [categoryCreateKinds, setCategoryCreateKinds] = useState<Record<string, ImportCategoryKind>>({})
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<FireflyTransactionImportResponse | null>(null)
  const [importOverlayPhase, setImportOverlayPhase] = useState<ImportOverlayPhase>('idle')
  const [importStageState, setImportStageState] = useState<FireflyImportStageState | null>(null)
  const [selectedBudgetNames, setSelectedBudgetNames] = useState<Set<string> | null>(null)
  const [budgetImportStatuses, setBudgetImportStatuses] = useState<Record<string, FireflyBudgetImportStatus>>({})
  const [budgetImportErrors, setBudgetImportErrors] = useState<Record<string, string>>({})
  const [budgetStageError, setBudgetStageError] = useState<string | null>(null)
  const [budgetsImportedCount, setBudgetsImportedCount] = useState(0)
  const [isImportingBudgets, setIsImportingBudgets] = useState(false)
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts()
  const { data: currencies = [], isLoading: currenciesLoading } = useCurrencies()
  const { data: institutions = [], isLoading: institutionsLoading } = useInstitutions()
  const { data: categories, isLoading: categoriesLoading } = useCategories()
  const importFireflyTransactions = useImportFireflyTransactions()
  const importFireflyBudgets = useImportFireflyBudgets()

  const selectableAccounts = useMemo(
    () => accounts.filter((account) => !account.is_archived),
    [accounts],
  )

  const accountOptions = useMemo(
    () => buildImportAccountOptions(selectableAccounts),
    [selectableAccounts],
  )

  const currencyOptions = useMemo(
    () => buildImportCurrencyOptions(currencies),
    [currencies],
  )

  const institutionOptions = useMemo(
    () => buildImportInstitutionOptions(institutions),
    [institutions],
  )

  const categoryMatchOptions = useMemo(
    () => buildImportCategoryMatchOptions(categories),
    [categories],
  )

  const accountById = useMemo(
    () => new Map(selectableAccounts.map((account) => [account.id, account])),
    [selectableAccounts],
  )

  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  )

  const institutionById = useMemo(
    () => new Map(institutions.map((institution) => [institution.id, institution])),
    [institutions],
  )

  // The commit assigns these seeded system categories to transfer legs and
  // balance rows, so the preview reads them from the user's category list
  const transferCategory = useMemo(
    () => (categories ?? []).find((category) => category.is_system && category.name === FIREFLY_TRANSFER_CATEGORY_NAME),
    [categories],
  )

  const balanceAdjustmentCategory = useMemo(
    () => (categories ?? []).find((category) => category.is_system && category.name === FIREFLY_BALANCE_ADJUSTMENT_CATEGORY_NAME),
    [categories],
  )

  const fireflyRows = useMemo(
    () => getFireflyFileRows(transactionsFile),
    [transactionsFile],
  )

  // The skipped-row tables show every export column, so both the preview and
  // results steps read the same uploaded header order
  const fireflyHeaders = useMemo(
    () => getFireflyFileHeaders(transactionsFile),
    [transactionsFile],
  )

  const trackedAccountNames = useMemo(
    () => getFireflyTrackedAccountNames(fireflyRows),
    [fireflyRows],
  )

  const accountPrefills = useMemo(
    () => buildFireflyAccountPrefills(fireflyRows, trackedAccountNames),
    [fireflyRows, trackedAccountNames],
  )

  const accountMappingSources = useMemo(
    () => trackedAccountNames.map((name) => ({ id: name, label: name, matchText: name })),
    [trackedAccountNames],
  )

  // Names without an explicit choice fall back to the best existing-account
  // match and default to create-new so every tracked account stays mapped
  const resolvedAccountMappings = useMemo(
    () => {
      const inferred = inferAccountMappings(accountMappingSources, accountMappings, selectableAccounts)
      for (const name of trackedAccountNames) {
        if (!inferred[name]) inferred[name] = CREATE_ACCOUNT_VALUE
      }
      return inferred
    },
    [accountMappingSources, accountMappings, selectableAccounts, trackedAccountNames],
  )

  const autoFilledAccountSources = useMemo(
    () => new Set(
      trackedAccountNames.filter((name) => (
        !accountMappings[name] && resolvedAccountMappings[name] !== CREATE_ACCOUNT_VALUE
      )),
    ),
    [accountMappings, resolvedAccountMappings, trackedAccountNames],
  )

  const resolvedAccountCreateDetails = useMemo(
    () => {
      const details: Record<string, FireflyAccountCreateDetails> = {}
      for (const name of trackedAccountNames) {
        details[name] = {
          accountType: accountCreateTypes[name] ?? accountPrefills[name]?.accountType ?? '',
          currency: accountCreateCurrencies[name] ?? accountPrefills[name]?.currency ?? '',
          institutionId: accountCreateInstitutions[name] ?? '',
        }
      }
      return details
    },
    [accountCreateCurrencies, accountCreateInstitutions, accountCreateTypes, accountPrefills, trackedAccountNames],
  )

  const importedCategories = useMemo(
    () => getFireflyImportedCategories(fireflyRows),
    [fireflyRows],
  )

  const inferredCategoryKinds = useMemo(
    () => buildFireflyCategoryKinds(fireflyRows),
    [fireflyRows],
  )

  const resolvedCategoryMappings = useMemo(
    () => inferFireflyCategoryMappings(importedCategories, categoryMappings, categories ?? [], inferredCategoryKinds),
    [categories, categoryMappings, importedCategories, inferredCategoryKinds],
  )

  const autoFilledCategories = useMemo(
    () => new Set(
      importedCategories.filter((source) => (
        !categoryMappings[source] && resolvedCategoryMappings[source] !== CREATE_CATEGORY_VALUE
      )),
    ),
    [categoryMappings, importedCategories, resolvedCategoryMappings],
  )

  // Category creates always carry a kind because unresolved sources default to
  // the majority journal-type kind, with expense as the final fallback
  const resolvedCategoryKinds = useMemo(
    () => {
      const kinds: Record<string, ImportCategoryKind> = {}
      for (const source of importedCategories) {
        kinds[source] = categoryCreateKinds[source] ?? inferredCategoryKinds[source] ?? 'expense'
      }
      return kinds
    },
    [categoryCreateKinds, importedCategories, inferredCategoryKinds],
  )

  const previewRows = useMemo(
    () => buildFireflyPreviewRows({
      rows: fireflyRows,
      limit: FIREFLY_SAMPLE_PREVIEW_LIMIT,
      accountById,
      accountMappings: resolvedAccountMappings,
      accountCreateDetails: resolvedAccountCreateDetails,
      institutionById,
      categoryById,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
      transferCategory,
      balanceAdjustmentCategory,
    }),
    [
      accountById,
      balanceAdjustmentCategory,
      categoryById,
      fireflyRows,
      institutionById,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
      resolvedCategoryKinds,
      resolvedCategoryMappings,
      transferCategory,
    ],
  )

  const previewGroups = useMemo(
    () => groupPreviewRowsByDate(previewRows),
    [previewRows],
  )

  // A full pass over the export predicts the commit outcome, so the stats
  // and the skipped-row list always come from the same resolution and the
  // transaction estimate never counts rows the commit would skip
  const importForecast = useMemo(
    () => forecastFireflyImport(fireflyRows, {
      accountById,
      accountMappings: resolvedAccountMappings,
      accountCreateDetails: resolvedAccountCreateDetails,
      institutionById,
      categoryById,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
      transferCategory,
      balanceAdjustmentCategory,
    }),
    [
      accountById,
      balanceAdjustmentCategory,
      categoryById,
      fireflyRows,
      institutionById,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
      resolvedCategoryKinds,
      resolvedCategoryMappings,
      transferCategory,
    ],
  )
  const importEstimate = importForecast
  const predictedSkippedRows = importForecast.skippedRows

  // Rows the payload builder drops never reach the backend, so the commit
  // response cannot report them and the results have to fold them back in
  // for the skipped totals to match what the preview promised
  const droppedBeforeUploadRows = useMemo(
    () => predictedSkippedRows.filter((row) => row.droppedBeforeUpload),
    [predictedSkippedRows],
  )

  const resultSkippedRows = useMemo(
    () => {
      if (!importResult) return []
      const reported = enrichFireflySkippedRows(importResult.skipped, fireflyRows)
      return [...droppedBeforeUploadRows, ...reported].sort(
        (first, second) => (first.rowNumber ?? Number.MAX_SAFE_INTEGER) - (second.rowNumber ?? Number.MAX_SAFE_INTEGER),
      )
    },
    [droppedBeforeUploadRows, fireflyRows, importResult],
  )

  const resultSkippedCount = importResult
    ? importResult.rows_skipped + droppedBeforeUploadRows.length
    : 0

  const newAccountCount = useMemo(
    () => trackedAccountNames.filter((name) => resolvedAccountMappings[name] === CREATE_ACCOUNT_VALUE).length,
    [resolvedAccountMappings, trackedAccountNames],
  )

  const newCategoryCount = useMemo(
    () => importedCategories.filter((source) => resolvedCategoryMappings[source] === CREATE_CATEGORY_VALUE).length,
    [importedCategories, resolvedCategoryMappings],
  )

  const importBuild = useMemo(
    () => buildFireflyImportPayload({
      transactionsFile,
      rows: fireflyRows,
      trackedAccountNames,
      accountMappings: resolvedAccountMappings,
      accountCreateDetails: resolvedAccountCreateDetails,
      importedCategories,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
    }),
    [
      fireflyRows,
      importedCategories,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
      resolvedCategoryKinds,
      resolvedCategoryMappings,
      trackedAccountNames,
      transactionsFile,
    ],
  )

  // Drafts derive from the staged files alone so the budget preview can be
  // reviewed before the commit, which then resolves their category IDs
  const budgetDrafts = useMemo(
    () => buildFireflyBudgetDrafts({ budgetsFile, transactionRows: fireflyRows }),
    [budgetsFile, fireflyRows],
  )

  const importableBudgetNames = useMemo(
    () => budgetDrafts.filter((draft) => !draft.disabledReason).map((draft) => draft.name),
    [budgetDrafts],
  )

  // Importable budgets start checked until the user makes an explicit selection
  const resolvedSelectedBudgets = useMemo(
    () => selectedBudgetNames ?? new Set(importableBudgetNames),
    [importableBudgetNames, selectedBudgetNames],
  )

  const pendingBudgetDrafts = useMemo(
    () => budgetDrafts.filter((draft) => (
      !draft.disabledReason
      && resolvedSelectedBudgets.has(draft.name)
      && budgetImportStatuses[draft.name] !== 'imported'
    )),
    [budgetDrafts, budgetImportStatuses, resolvedSelectedBudgets],
  )

  // The stage list only appears when the commit has a budget stage to run, so a
  // transactions-only commit keeps the plain overlay
  const importOverlaySteps = useMemo<ImportProgressStep[] | undefined>(
    () => {
      if (!importStageState) return undefined

      // A stage that has handed over leaves the list, so the overlay carries the
      // stage holding it on top and the ones still waiting underneath. The stage
      // on top turns done the moment its work lands and stays there struck off
      // until the next one takes over
      const { isFinished, stage } = importStageState
      const currentIndex = FIREFLY_IMPORT_STAGES.findIndex((entry) => entry.id === stage)
      return FIREFLY_IMPORT_STAGES.slice(currentIndex).map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        status: index > 0 ? 'queued' : isFinished ? 'done' : 'active',
      }))
    },
    [importStageState],
  )

  const importSummary = importResult ? formatFireflyImportSummary(importResult, budgetsImportedCount) : ''

  // A budget failure leaves the committed transactions in place, so only the
  // budget stage reports it and the overlay shows whichever stage failed
  const importOverlayError = importError ?? budgetStageError
  const importOverlayOpen = importOverlayPhase !== 'idle'
  const canCommitImport = Boolean(importBuild.payload)
    && !importOverlayOpen
    && !importFireflyTransactions.isPending
    && !importResult

  const resetMappingState = () => {
    setAccountMappings({})
    setAccountCreateTypes({})
    setAccountCreateCurrencies({})
    setAccountCreateInstitutions({})
    setSelectedAccountRows(new Set())
    setBatchAccountType('')
    setBatchAccountCurrency('')
    setBatchAccountInstitution('')
    setCategoryMappings({})
    setCategoryCreateKinds({})
  }

  const resetCommitState = () => {
    setImportError(null)
    setImportResult(null)
    setImportOverlayPhase('idle')
    setImportStageState(null)
    importFireflyTransactions.reset()
  }

  const resetBudgetPanelState = () => {
    setSelectedBudgetNames(null)
    setBudgetImportStatuses({})
    setBudgetImportErrors({})
    setBudgetStageError(null)
    setBudgetsImportedCount(0)
  }

  const assignFireflyFile = (kind: FireflyFileKind, draft: ImportFileDraft | null) => {
    if (kind === 'transactions') {
      setTransactionsFile(draft)

      // A different transactions export changes every derived mapping and
      // invalidates any committed result, so downstream staging starts over
      resetMappingState()
      resetCommitState()
      resetBudgetPanelState()
      return
    }

    setBudgetsFile(draft)
    resetBudgetPanelState()
  }

  const handleFireflyFileChange = async (kind: FireflyFileKind, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const selected = event.target.files?.[0]
    if (!selected) return

    setProcessingFileKind(kind)

    try {
      const [draft] = await Promise.all([
        readFireflyCsvFile(selected, kind),
        waitForMilliseconds(FIREFLY_CSV_PROCESSING_MIN_MS),
      ])
      assignFireflyFile(kind, draft)
    } finally {
      setProcessingFileKind(null)
      input.value = ''
    }
  }

  const removeFireflyFile = (kind: FireflyFileKind) => {
    assignFireflyFile(kind, null)
  }

  const updateFireflyAccountMapping = (sourceAccount: string, accountId: string) => {
    setAccountMappings((current) => ({ ...current, [sourceAccount]: accountId }))
    if (accountId !== CREATE_ACCOUNT_VALUE) {
      setAccountCreateTypes((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateCurrencies((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateInstitutions((current) => removeRecordKey(current, sourceAccount))
      setSelectedAccountRows((current) => removeSetValue(current, sourceAccount))
    }
  }

  /**
   * Imports the given budget drafts in one atomic call and records the outcome
   * on every row the call covered
   *
   * Returns the backend detail when the batch failed, so the caller can fail
   * the stage it is running, and null when every budget was created
   */
  const importBudgetDrafts = async (
    drafts: FireflyBudgetDraft[],
    categorySourceIds: Record<string, string>,
  ): Promise<string | null> => {
    setIsImportingBudgets(true)

    try {
      // One request creates every selected budget with its full limit schedule,
      // and the stage minimum overlaps the request rather than following it
      const [response] = await Promise.all([
        importFireflyBudgets.mutateAsync({ budgets: buildFireflyBudgetImportBudgets(drafts, categorySourceIds) }),
        waitForMilliseconds(FIREFLY_IMPORT_STAGE_MIN_MS),
      ])

      setBudgetsImportedCount((current) => current + response.budgets_created)
      setBudgetStageError(null)
      setBudgetImportStatuses((current) => {
        const next = { ...current }
        for (const draft of drafts) next[draft.name] = 'imported'
        return next
      })
      setBudgetImportErrors((current) => {
        const next = { ...current }
        for (const draft of drafts) delete next[draft.name]
        return next
      })
      return null
    } catch (error) {
      // The batch is atomic, so nothing was imported and every row stays
      // retryable, with the backend detail landing on the budget it names
      const detail = getErrorMessage(error)
      const failedDraft = drafts.find((draft) => detail.startsWith(draft.name))

      setBudgetStageError(detail)
      setBudgetImportStatuses((current) => {
        const next = { ...current }
        for (const draft of drafts) next[draft.name] = 'error'
        return next
      })
      setBudgetImportErrors((current) => {
        const next = { ...current }
        for (const draft of drafts) {
          next[draft.name] = failedDraft && draft.name !== failedDraft.name
            ? 'Not imported because another budget in the batch failed.'
            : detail
        }
        return next
      })
      return detail
    } finally {
      setIsImportingBudgets(false)
    }
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || importOverlayOpen || importFireflyTransactions.isPending) return

    // The run imports the budgets selected when it started, so the drafts are
    // captured here rather than read again between the two stages
    const budgetDraftsToImport = pendingBudgetDrafts

    setImportError(null)
    setImportResult(null)
    setBudgetStageError(null)
    setImportStageState(budgetDraftsToImport.length > 0 ? { stage: 'transactions', isFinished: false } : null)
    setImportOverlayPhase('importing')
    const minimumOverlay = waitForMilliseconds(FIREFLY_IMPORT_OVERLAY_MIN_MS)

    let result: FireflyTransactionImportResponse
    try {
      const [imported] = await Promise.all([
        importFireflyTransactions.mutateAsync(payload),
        waitForMilliseconds(FIREFLY_IMPORT_STAGE_MIN_MS),
      ])
      result = imported
      setImportResult(result)
    } catch (error) {
      await minimumOverlay
      setImportError(getErrorMessage(error))
      setImportOverlayPhase('error')
      return
    }

    // The transactions are committed from here on, so a budget failure fails
    // only the budget stage and the retry never re-imports them
    if (budgetDraftsToImport.length > 0) {
      // The transactions stage is struck off and held before the budget stage
      // takes over, so the handover is read rather than flashed past
      setImportStageState({ stage: 'transactions', isFinished: true })
      await waitForMilliseconds(FIREFLY_IMPORT_STAGE_CROSS_OFF_MS)
      setImportStageState({ stage: 'budgets', isFinished: false })

      const budgetError = await importBudgetDrafts(budgetDraftsToImport, result.category_source_ids)
      if (budgetError) {
        await minimumOverlay
        setImportOverlayPhase('error')
        return
      }

      // The last stage is struck off while the overlay is still importing, so
      // it lands as visibly as the ones that handed over to a stage below
      setImportStageState({ stage: 'budgets', isFinished: true })
      await waitForMilliseconds(FIREFLY_IMPORT_STAGE_CROSS_OFF_MS)
    }

    await minimumOverlay
    setImportOverlayPhase('success')
  }

  const closeImportOverlay = () => {
    if (importOverlayPhase !== 'success' && importOverlayPhase !== 'error') return
    setImportOverlayPhase('idle')
  }

  const toggleBudgetSelection = (name: string) => {
    const next = new Set(resolvedSelectedBudgets)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    setSelectedBudgetNames(next)
  }

  /**
   * Replays the budget stage after it failed on an otherwise successful commit
   *
   * The transactions stay committed, so this reuses the category IDs that
   * commit reported instead of importing anything again
   */
  const handleRetryBudgetImport = async () => {
    if (isImportingBudgets || !importResult || pendingBudgetDrafts.length === 0) return

    await importBudgetDrafts(pendingBudgetDrafts, importResult.category_source_ids)
  }

  const resetFireflyWorkflow = () => {
    setTransactionsFile(null)
    setBudgetsFile(null)
    setProcessingFileKind(null)
    resetMappingState()
    resetCommitState()
    resetBudgetPanelState()
    setIsImportingBudgets(false)
  }

  return {
    transactionsFile,
    budgetsFile,
    processingFileKind,
    fireflyRows,
    fireflyHeaders,
    trackedAccountNames,
    accountPrefills,
    accountMappings: resolvedAccountMappings,
    autoFilledAccountSources,
    accountCreateDetails: resolvedAccountCreateDetails,
    selectedAccountRows,
    batchAccountType,
    batchAccountCurrency,
    batchAccountInstitution,
    importedCategories,
    resolvedCategoryMappings,
    autoFilledCategories,
    resolvedCategoryKinds,
    importEstimate,
    previewRows,
    previewGroups,
    predictedSkippedRows,
    resultSkippedRows,
    resultSkippedCount,
    newAccountCount,
    newCategoryCount,
    importBuild,
    importError,
    importOverlayError,
    importResult,
    importOverlayPhase,
    importOverlayOpen,
    importOverlaySteps,
    importSummary,
    canCommitImport,
    budgetDrafts,
    selectedBudgetNames: resolvedSelectedBudgets,
    budgetImportStatuses,
    budgetImportErrors,
    budgetStageError,
    isImportingBudgets,
    accountsLoading,
    currenciesLoading,
    institutionsLoading,
    categoriesLoading,
    accountOptions,
    currencyOptions,
    institutionOptions,
    categoryMatchOptions,
    accountById,
    categoryById,
    setAccountCreateTypes,
    setAccountCreateCurrencies,
    setAccountCreateInstitutions,
    setSelectedAccountRows,
    setBatchAccountType,
    setBatchAccountCurrency,
    setBatchAccountInstitution,
    setCategoryMappings,
    setCategoryCreateKinds,
    handleFireflyFileChange,
    removeFireflyFile,
    updateFireflyAccountMapping,
    handleCommitImport,
    closeImportOverlay,
    toggleBudgetSelection,
    handleRetryBudgetImport,
    resetFireflyWorkflow,
  }
}

export type FireflyImportWorkflow = ReturnType<typeof useFireflyImportWorkflow>
