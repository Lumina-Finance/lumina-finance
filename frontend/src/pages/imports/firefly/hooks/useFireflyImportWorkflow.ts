import { useEffect, useMemo, useState } from 'react'
import {
  useCommitStagedFireflyImport,
  useImportFirefly,
  type FireflyImportRunBudgets,
} from '@/api/firefly-imports'
import { getJsonByteSize } from '@/api/shared/importBatchSize'
import { discardStagedRun } from '@/api/transaction-imports'
import { waitForMilliseconds } from '@/utils/timing'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME } from '@/utils/transfers'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { useImportAccountCreateState, useImportReferenceData } from '@/pages/imports/hooks'
import type {
  ImportCategoryKind,
  ImportFileDraft,
  ImportProgressStep,
} from '@/pages/imports/types'
import {
  dropVanishedAccountMappings,
  dropVanishedCategoryMappings,
  getImportUploadBlockReason,
  getSupportedCurrencyCodes,
  groupPreviewRowsByDate,
  isAutoFilledAccountSource,
  processImportFileIntake,
  type ImportFileAcquisition,
} from '@/pages/imports/utils'
import {
  FIREFLY_CSV_PROCESSING_MIN_MS,
  FIREFLY_IMPORT_NOTHING_SAVED_NOTE,
  FIREFLY_IMPORT_SAVE_AGAIN_NOTE,
  FIREFLY_IMPORT_STAGES,
  FIREFLY_MAX_BUDGETS,
  FIREFLY_MAX_BUDGETS_REQUEST_BYTES,
  FIREFLY_SAMPLE_PREVIEW_LIMIT,
  FIREFLY_TRANSFER_CATEGORY_NAME,
} from '@/pages/imports/firefly/constants'
import type { FireflyFileKind } from '@/pages/imports/firefly/types'
import {
  buildFireflyAccountPrefills,
  buildFireflyBudgetCountingNotes,
  buildFireflyBudgetDrafts,
  buildFireflyCategoryKinds,
  buildFireflyImportPayload,
  buildFireflyPreviewRows,
  buildFireflyRunBudgets,
  canStartFireflyImport,
  countFireflyCreatedSources,
  createFireflyImportRunController,
  FIREFLY_IMPORT_RUN_IDLE,
  forecastFireflyImport,
  formatFireflyImportSummary,
  getFireflyFileHeaders,
  getFireflyFileRows,
  getFireflyImportedCategories,
  getFireflyAccountSources,
  getFireflyImportError,
  inferFireflyCategoryMappings,
  readFireflyCsvFile,
  resolveFireflyAccountMappings,
  type FireflyAccountCreateDetails,
  type FireflyRowResolutionOptions,
} from '@/pages/imports/firefly/utils'

// This flow reads its account sources from the staged export rather than from a column the user
// picks, and staging a different export resets everything, so its answers are never carried onto a
// set of sources they were not given for and one fixed scope holds for every source
const getFireflyAccountSourceScope = () => 'firefly'

/**
 * Drives the whole Firefly III import flow: reading the transactions and budgets exports, resolving
 * their accounts and categories against the user's existing ones, building the import, and running
 * it as one run that uploads everything and then writes all of it at once
 *
 * Uploading a new transactions export resets every derived mapping and any prior result, since a
 * different export invalidates all of it. An import that fails writes nothing, and one whose save
 * failed for a reason trying again could clear keeps its upload, so a retry only saves again
 */
export function useFireflyImportWorkflow() {
  const [transactionsFile, setTransactionsFile] = useState<ImportFileDraft | null>(null)
  const [budgetsFile, setBudgetsFile] = useState<ImportFileDraft | null>(null)
  const [processingFileKind, setProcessingFileKind] = useState<FireflyFileKind | null>(null)
  const [fileIntakeErrors, setFileIntakeErrors] = useState<Record<FireflyFileKind, string | null>>({
    transactions: null,
    budgets: null,
  })
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const {
    accountCreateTypes,
    accountCreateCurrencies,
    accountCreateInstitutions,
    selectedAccountRows,
    batchAccountType,
    batchAccountCurrency,
    batchAccountInstitution,
    setAccountCreateTypes,
    setAccountCreateCurrencies,
    setAccountCreateInstitutions,
    setSelectedAccountRows,
    setBatchAccountType,
    setBatchAccountCurrency,
    setBatchAccountInstitution,
    updateAccountMapping: updateFireflyAccountMapping,
    resetAccountCreateState,
  } = useImportAccountCreateState(setAccountMappings, getFireflyAccountSourceScope)
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({})
  const [categoryCreateKinds, setCategoryCreateKinds] = useState<Record<string, ImportCategoryKind>>({})
  const [importRun, setImportRun] = useState(FIREFLY_IMPORT_RUN_IDLE)
  const [importRunController] = useState(() => createFireflyImportRunController({
    onChange: setImportRun,
    discardStagedRun: (runId) => void discardStagedRun(runId),
    wait: waitForMilliseconds,
  }))
  const {
    failure: importFailure,
    completedImport,
    overlayPhase: importOverlayPhase,
    stageState: importStageState,
    canStop: canStopImport,
    stagedRunId,
  } = importRun
  const importResult = completedImport?.result ?? null
  const [selectedBudgetNames, setSelectedBudgetNames] = useState<Set<string> | null>(null)

  // Every answer the user gives about the import, as one value that changes only when one of them does
  const importAnswers = useMemo(
    () => ({
      budgetsFile,
      accountMappings,
      accountCreateTypes,
      accountCreateCurrencies,
      accountCreateInstitutions,
      categoryMappings,
      categoryCreateKinds,
      selectedBudgetNames,
    }),
    [
      accountCreateCurrencies,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappings,
      budgetsFile,
      categoryCreateKinds,
      categoryMappings,
      selectedBudgetNames,
    ],
  )

  // A failure is about the answers the import was sent with, so it stops showing once one changes
  const importError = getFireflyImportError(importFailure, importAnswers)
  const importFirefly = useImportFirefly()
  const commitStagedFirefly = useCommitStagedFireflyImport()
  const {
    categories,
    currencies,
    accountsLoading,
    currenciesLoading,
    currenciesError,
    accountsFailed,
    categoriesFailed,
    accountsResolved,
    accountsCurrent,
    categoriesResolved,
    refetchAccounts,
    refetchCategories,
    institutionsLoading,
    categoriesLoading,
    selectableAccounts,
    accountOptions,
    currencyOptions,
    institutionOptions,
    categoryMatchOptions,
    accountById,
    categoryById,
    institutionById,
  } = useImportReferenceData()

  // The commit assigns these seeded system categories to transfer legs and
  // balance rows, so the preview reads them from the user's category list
  const transferCategory = useMemo(
    () => (categories ?? []).find((category) => category.is_system && category.name === FIREFLY_TRANSFER_CATEGORY_NAME),
    [categories],
  )

  const balanceAdjustmentCategory = useMemo(
    () => (categories ?? []).find((category) => category.is_system && category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME),
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

  const accountSources = useMemo(
    () => getFireflyAccountSources(fireflyRows),
    [fireflyRows],
  )
  const trackedAccounts = accountSources.list

  const supportedCurrencyCodes = useMemo(
    () => getSupportedCurrencyCodes(currencies),
    [currencies],
  )

  const accountPrefills = useMemo(
    () => buildFireflyAccountPrefills(fireflyRows, accountSources, supportedCurrencyCodes),
    [accountSources, fireflyRows, supportedCurrencyCodes],
  )

  // Every Firefly source is an account the import writes rows into, so none of them can be
  // answered as money outside the tracked accounts
  const accountMappingSources = useMemo(
    () => trackedAccounts.map((source) => ({
      id: source.id,
      label: source.label,
      matchText: source.name,
      isCounterpartyOnly: false,
    })),
    [trackedAccounts],
  )

  // Names without an explicit choice use an unambiguous existing-account match. Once the account
  // list is current, unmatched names outside collisions default to create-new
  // An answer pointing at a deleted account is dropped before anything is derived from it, or the
  // commit sends an id the server will refuse. While account data is not current, an unmatched name
  // remains unanswered, and colliding names require an explicit choice even after the list is current
  const liveAccountMappings = useMemo(
    () => (accountsResolved
      ? dropVanishedAccountMappings(accountMappings, accountById).mappings
      : accountMappings),
    [accountById, accountMappings, accountsResolved],
  )

  const resolvedAccountMappings = useMemo(
    // Both sides of a Firefly transfer take rows, so no source here can record an archived or
    // read-only account and both matching lists are the same one
    () => resolveFireflyAccountMappings({
      sources: accountMappingSources,
      liveMappings: liveAccountMappings,
      selectableAccounts,
      accountsCurrent,
    }),
    [accountMappingSources, accountsCurrent, liveAccountMappings, selectableAccounts],
  )

  const autoFilledAccountSources = useMemo(
    () => new Set(
      trackedAccounts.map((source) => source.id).filter((source) => (
        isAutoFilledAccountSource(
          liveAccountMappings[source] ?? '',
          resolvedAccountMappings[source] ?? '',
          false,
        )
      )),
    ),
    [liveAccountMappings, resolvedAccountMappings, trackedAccounts],
  )

  // Read before the name match and the create-new default are layered on, so the batch bar can tell
  // an answer the user gave from one the step filled in for them
  const handAnsweredAccountSources = useMemo(
    () => new Set(Object.entries(liveAccountMappings).filter(([, choice]) => choice).map(([source]) => source)),
    [liveAccountMappings],
  )

  const resolvedAccountCreateDetails = useMemo(
    () => {
      const details: Record<string, FireflyAccountCreateDetails> = {}
      for (const { id: source } of trackedAccounts) {
        details[source] = {
          accountType: accountCreateTypes[source] ?? accountPrefills[source]?.accountType ?? '',
          currency: accountCreateCurrencies[source] ?? accountPrefills[source]?.currency ?? '',
          institutionId: accountCreateInstitutions[source] ?? '',
        }
      }
      return details
    },
    [accountCreateCurrencies, accountCreateInstitutions, accountCreateTypes, accountPrefills, trackedAccounts],
  )

  // Only rows the upload can carry with their category register category sources, so a category
  // only transfers, balance rows or rows no mapping could save carry is never asked about. One only
  // rows the forecast leaves out carry is still asked about, since which rows it leaves out depends
  // on the answers
  const importedCategories = useMemo(
    () => getFireflyImportedCategories(fireflyRows),
    [fireflyRows],
  )

  const inferredCategoryKinds = useMemo(
    () => buildFireflyCategoryKinds(fireflyRows),
    [fireflyRows],
  )

  // Same reason as the accounts above: a match pointing at a deleted category would reach the commit
  const liveCategoryMappings = useMemo(
    () => (categoriesResolved
      ? dropVanishedCategoryMappings(categoryMappings, categoryById).mappings
      : categoryMappings),
    [categoriesResolved, categoryById, categoryMappings],
  )

  const resolvedCategoryMappings = useMemo(
    () => inferFireflyCategoryMappings(importedCategories, liveCategoryMappings, categories ?? [], inferredCategoryKinds),
    [categories, liveCategoryMappings, importedCategories, inferredCategoryKinds],
  )

  const autoFilledCategories = useMemo(
    () => new Set(
      importedCategories.filter((source) => (
        !liveCategoryMappings[source] && resolvedCategoryMappings[source] !== CREATE_CATEGORY_VALUE
      )),
    ),
    [liveCategoryMappings, importedCategories, resolvedCategoryMappings],
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
      accountSources,
      accountById,
      accountMappings: resolvedAccountMappings,
      accountCreateDetails: resolvedAccountCreateDetails,
      institutionById,
      categoryById,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
      transferCategory,
      balanceAdjustmentCategory,
      currencies,
    }),
    [
      accountById,
      accountSources,
      balanceAdjustmentCategory,
      categoryById,
      currencies,
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

  const rowResolutionOptions = useMemo<FireflyRowResolutionOptions>(
    () => ({
      accountSources,
      accountById,
      accountMappings: resolvedAccountMappings,
      accountCreateDetails: resolvedAccountCreateDetails,
      institutionById,
      categoryById,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
      transferCategory,
      balanceAdjustmentCategory,
      currencies,
    }),
    [
      accountById,
      accountSources,
      balanceAdjustmentCategory,
      categoryById,
      currencies,
      institutionById,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
      resolvedCategoryKinds,
      resolvedCategoryMappings,
      transferCategory,
    ],
  )
  // A full pass over the export predicts the commit outcome, so the stats
  // and both row lists always come from the same resolution and the transaction estimate never
  // counts rows the commit would skip
  const importForecast = useMemo(
    () => forecastFireflyImport(fireflyRows, { fileId: transactionsFile?.id ?? null, ...rowResolutionOptions }),
    [fireflyRows, rowResolutionOptions, transactionsFile],
  )
  const importEstimate = importForecast
  const predictedSkippedRows = importForecast.skippedRows
  const predictedRowWarnings = importForecast.rowWarnings

  // The server refuses a row it cannot write rather than skipping it, so every row the forecast
  // predicts as skipped is left out of the upload
  const forecastSkippedRows = useMemo(
    () => new Set(predictedSkippedRows.map((row) => row.cells)),
    [predictedSkippedRows],
  )

  const importBuild = useMemo(
    () => buildFireflyImportPayload({
      transactionsFile,
      rows: fireflyRows,
      skippedRows: forecastSkippedRows,
      accountSources,
      accountMappings: resolvedAccountMappings,
      accountById,
      accountCreateDetails: resolvedAccountCreateDetails,
      importedCategories,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
      categoryById,
    }),
    [
      accountById,
      accountSources,
      categoryById,
      fireflyRows,
      forecastSkippedRows,
      importedCategories,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
      resolvedCategoryKinds,
      resolvedCategoryMappings,
      transactionsFile,
    ],
  )

  // A source answered create is counted only while an uploaded row uses it, since the commit
  // creates nothing for a source whose rows are all skipped
  const newAccountCount = useMemo(
    () => countFireflyCreatedSources(
      trackedAccounts.map((source) => source.id),
      resolvedAccountMappings,
      CREATE_ACCOUNT_VALUE,
      importBuild.writtenSources.accounts,
    ),
    [importBuild, resolvedAccountMappings, trackedAccounts],
  )

  const newCategoryCount = useMemo(
    () => countFireflyCreatedSources(
      importedCategories,
      resolvedCategoryMappings,
      CREATE_CATEGORY_VALUE,
      importBuild.writtenSources.categories,
    ),
    [importBuild, importedCategories, resolvedCategoryMappings],
  )

  // Drafts derive from the staged files and the category matching so the
  // budget preview can be reviewed before the import, which sends their
  // categories by the export names the category step mapped
  const budgetDrafts = useMemo(
    () => buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: fireflyRows,
      currencies,
      categoryMappings: resolvedCategoryMappings,
      categoryById,
    }),
    [budgetsFile, categoryById, currencies, fireflyRows, resolvedCategoryMappings],
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
    () => budgetDrafts.filter((draft) => !draft.disabledReason && resolvedSelectedBudgets.has(draft.name)),
    [budgetDrafts, resolvedSelectedBudgets],
  )

  // Read after the category matching, since what a budget counts depends on the Lumina categories
  // its Firefly categories become
  const budgetCountingNotes = useMemo(
    () => buildFireflyBudgetCountingNotes({
      drafts: budgetDrafts,
      selectedNames: resolvedSelectedBudgets,
      rows: fireflyRows,
      options: rowResolutionOptions,
    }),
    [budgetDrafts, fireflyRows, resolvedSelectedBudgets, rowResolutionOptions],
  )

  // What the run creates alongside the rows, built here rather than at the import so a budget the
  // import cannot send is refused while the selection can still change
  const runBudgetsBuild = useMemo<{ budgets: FireflyImportRunBudgets | null; error: string | null }>(
    () => {
      const categoryMappings = importBuild.payload?.categories
      if (!categoryMappings || pendingBudgetDrafts.length === 0) return { budgets: null, error: null }

      try {
        const budgets = buildFireflyRunBudgets(pendingBudgetDrafts, categoryMappings)

        // The budgets go in one request, and a request past the server's limit is refused whole
        if (getJsonByteSize(budgets) > FIREFLY_MAX_BUDGETS_REQUEST_BYTES) {
          return { budgets: null, error: 'The selected budgets are too large to import at once. Select fewer budgets.' }
        }
        return { budgets, error: null }
      } catch (error) {
        return { budgets: null, error: error instanceof Error ? error.message : String(error) }
      }
    },
    [importBuild.payload, pendingBudgetDrafts],
  )

  // The budget import takes a bounded number of budgets, and its refusal would name none of them
  const budgetSelectionError = pendingBudgetDrafts.length > FIREFLY_MAX_BUDGETS
    ? `Select at most ${FIREFLY_MAX_BUDGETS.toLocaleString()} budgets to import, since the importer takes up to that many at once.`
    : runBudgetsBuild.error

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

  const completedSkippedCount = completedImport?.skippedRowsAtCommit.length ?? 0
  const importSummary = importResult ? formatFireflyImportSummary(importResult, completedSkippedCount) : ''

  const importedBudgetNames = useMemo(
    () => new Set(importResult?.budgets.map((budget) => budget.name) ?? []),
    [importResult],
  )

  // Only the overlay says what a failure left, read off the upload still kept, since closing it
  // drops that upload and the preview beside the button then shows the reason alone
  const importOverlayError = importError && importOverlayPhase === 'error'
    ? describeFireflyImportFailure(importError, stagedRunId !== null)
    : importError
  const importOverlayOpen = importOverlayPhase !== 'idle'
  const isImportInFlight = importFirefly.isPending || commitStagedFirefly.isPending

  const canCommitImport = canStartFireflyImport({
    hasPayload: importBuild.payload !== null,
    processingFileKind,
    budgetSelectionError,
    overlayOpen: importOverlayOpen,
    inFlight: isImportInFlight,
    hasResult: importResult !== null,
  })

  const resetMappingState = () => {
    setAccountMappings({})
    resetAccountCreateState()
    setCategoryMappings({})
    setCategoryCreateKinds({})
  }

  const resetCommitState = () => {
    importRunController.reset()
    importFirefly.reset()
    commitStagedFirefly.reset()
  }

  const resetBudgetPanelState = () => {
    setSelectedBudgetNames(null)
  }

  const assignFireflyFile = (kind: FireflyFileKind, draft: ImportFileDraft | null) => {
    setFileIntakeErrors((current) => ({ ...current, [kind]: null }))

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

  const handleFireflyFileChange = async (
    kind: FireflyFileKind,
    acquiredFiles: ImportFileAcquisition,
  ) => {
    const intake = await processImportFileIntake({
      files: acquiredFiles,
      processing: processingFileKind !== null,
      unavailableReason: getImportUploadBlockReason(currencies, currenciesError)?.message ?? null,
      readFile: async (selectedFile) => {
        setFileIntakeErrors((current) => ({ ...current, [kind]: null }))
        setProcessingFileKind(kind)

        try {
          const [draft] = await Promise.all([
            readFireflyCsvFile(selectedFile, kind, supportedCurrencyCodes),
            waitForMilliseconds(FIREFLY_CSV_PROCESSING_MIN_MS),
          ])
          assignFireflyFile(kind, draft)
        } finally {
          setProcessingFileKind(null)
        }
      },
    })

    if (intake.status === 'refused') {
      setFileIntakeErrors((current) => ({ ...current, [kind]: intake.reason }))
    }
  }

  const removeFireflyFile = (kind: FireflyFileKind) => {
    assignFireflyFile(kind, null)
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || !canCommitImport) return

    // The import creates the budgets selected when it started, so they are captured here
    const request = { payload, budgets: runBudgetsBuild.budgets }
    await importRunController.start(
      predictedSkippedRows,
      importAnswers,
      (signal, onStaged) => importFirefly.mutateAsync({ request, signal, onStaged }),
    )
  }

  const retryImportCommit = async () => {
    if (isImportInFlight) return
    await importRunController.retry(importAnswers, (runId, signal) => commitStagedFirefly.mutateAsync({ runId, signal }))
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

  const resetFireflyWorkflow = () => {
    setTransactionsFile(null)
    setBudgetsFile(null)
    setProcessingFileKind(null)
    setFileIntakeErrors({ transactions: null, budgets: null })
    resetMappingState()
    resetCommitState()
    resetBudgetPanelState()
  }

  // Leaving the page abandons the import: while uploading that drops what was uploaded, and while
  // saving it only stops waiting, since the save is the server's to finish
  useEffect(() => () => importRunController.stop(), [importRunController])

  return {
    transactionsFile,
    budgetsFile,
    processingFileKind,
    fileIntakeErrors,
    fireflyRows,
    fireflyHeaders,
    trackedAccounts,
    accountPrefills,
    accountMappings: resolvedAccountMappings,
    autoFilledAccountSources,
    handAnsweredAccountSources,
    accountsFailed,
    categoriesFailed,
    refetchAccounts,
    refetchCategories,
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
    predictedRowWarnings,
    completedImport,
    completedSkippedCount,
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
    isImportInFlight,
    canStopImport,
    canRetryImportCommit: stagedRunId !== null,
    budgetDrafts,
    selectedBudgetNames: resolvedSelectedBudgets,
    importedBudgetNames,
    budgetSelectionError,
    budgetCountingNotes,
    accountsLoading,
    currenciesLoading,
    uploadBlockReason: getImportUploadBlockReason(currencies, currenciesError),
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
    retryImportCommit,
    cancelImport: importRunController.stop,
    closeImportOverlay: importRunController.close,
    toggleBudgetSelection,
    resetFireflyWorkflow,
  }
}

export type FireflyImportWorkflow = ReturnType<typeof useFireflyImportWorkflow>

/**
 * Says why an import failed and what that left behind: nothing, or an upload that can be saved again
 */
function describeFireflyImportFailure(reason: string, canSaveAgain: boolean) {
  const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`
  return `${sentence} ${canSaveAgain ? FIREFLY_IMPORT_SAVE_AGAIN_NOTE : FIREFLY_IMPORT_NOTHING_SAVED_NOTE}`
}
