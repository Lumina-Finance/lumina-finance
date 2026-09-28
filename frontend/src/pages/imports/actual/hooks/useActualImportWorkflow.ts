import { useEffect, useMemo, useState } from 'react'
import { useCommitStagedJournalImport, useImportJournal, type ImportRunBudgets } from '@/api/provider-imports'
import { getJsonByteSize } from '@/api/shared/importBatchSize'
import { discardStagedRun } from '@/api/transaction-imports'
import { useAuth } from '@/hooks/useAuth'
import { getTodayYmd, resolveTimeZone } from '@/utils/date'
import { findCurrencyExponent } from '@/utils/moneyInput'
import { LOADING_ANIMATION_MIN_MS, waitForMilliseconds } from '@/utils/timing'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME } from '@/utils/transfers'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { useImportAccountCreateState, useImportReferenceData } from '@/pages/imports/hooks'
import type { ImportCategoryKind, ImportProgressStep } from '@/pages/imports/types'
import {
  canStartProviderImport,
  countCreatedImportSources,
  createProviderImportRunController,
  describeProviderImportFailure,
  dropVanishedAccountMappings,
  dropVanishedCategoryMappings,
  formatProviderImportSummary,
  getImportUploadBlockReason,
  getProviderImportError,
  getSupportedCurrencyCodes,
  groupPreviewRowsByDate,
  isAutoFilledAccountSource,
  processImportFileIntake,
  PROVIDER_IMPORT_RUN_IDLE,
  PROVIDER_IMPORT_STAGES,
  PROVIDER_MAX_BUDGETS_REQUEST_BYTES,
  buildImportAccountOptions,
  type ImportFileAcquisition,
  type ProviderImportRunState,
} from '@/pages/imports/utils'
import {
  ACTUAL_IMPORT_FILE_TYPE,
  ACTUAL_MAX_BUDGETS,
  ACTUAL_SAMPLE_PREVIEW_LIMIT,
  ACTUAL_TRANSFER_CATEGORY_NAME,
  getActualUnsupportedCurrencyError,
} from '@/pages/imports/actual/constants'
import type { ActualBudgetFile, ActualJournal, ActualPaymentMode, ActualSkippedRow } from '@/pages/imports/actual/types'
import { buildActualBudgetDrafts, buildActualRunBudgets, getActualBudgetRefusal } from '@/pages/imports/actual/utils/budgets'
import {
  applyActualCreditPayments,
  applyActualPaymentModes,
  getActualCategoryKind,
  getActualPaymentMode,
  getActualRevolvingAccountIds,
  getVisibleActualCategorySources,
  inferActualCategoryMappings,
} from '@/pages/imports/actual/utils/categories'
import { getActualTransferSourceId, normaliseActualBudget } from '@/pages/imports/actual/utils/normalise'
import { buildActualImportPayload, isArchivedWhenCreated, type ActualAccountCreateDetails, type ActualImportBuild } from '@/pages/imports/actual/utils/payload'
import { buildActualPreviewRows } from '@/pages/imports/actual/utils/preview'
import { readActualBudgetFile } from '@/pages/imports/actual/utils/readFile'
import { getPersonalAccounts, getPersonalCategoryOptions, resolveActualAccountMappings } from '@/pages/imports/actual/utils/scope'

/** The export the flow has read, as the files step lists it */
export interface ActualStagedFile {
  id: string
  name: string
  size: number
  budgetName: string | null
  rowCount: number
}

// Staging a different export resets every answer, so one fixed scope holds for every source
const getActualAccountSourceScope = () => 'actual'

const EMPTY_JOURNAL: ActualJournal = { accounts: [], categories: [], entries: [], skippedRows: [] }

const EMPTY_BUILD: ActualImportBuild = {
  errors: [],
  payload: null,
  currency: null,
  skippedRows: [],
  writtenSources: { accounts: new Set(), categories: new Set() },
  archiveAccountSources: [],
  budgetCategoryMappings: [],
}

/**
 * Drives the whole Actual Budget import flow: reading the export, resolving its accounts and
 * categories against the user's own, choosing budgets, and running it as one run that uploads
 * everything and then writes all of it at once
 *
 * Balances and the budgets' current month are as of today in the user's own timezone, matching how
 * Lumina Finance counts rows dated later, so today is read from their profile rather than from the
 * browser. Staging a different export resets every answer and any prior result, since the answers
 * were given for the accounts and categories of the one before
 */
export function useActualImportWorkflow() {
  const { user } = useAuth()
  const today = getTodayYmd(resolveTimeZone(user?.tz))
  const [stagedFile, setStagedFile] = useState<ActualStagedFile | null>(null)
  const [budget, setBudget] = useState<ActualBudgetFile | null>(null)
  const [isProcessingFile, setIsProcessingFile] = useState(false)
  const [fileIntakeError, setFileIntakeError] = useState<string | null>(null)
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
    updateAccountMapping: updateActualAccountMapping,
    resetAccountCreateState,
  } = useImportAccountCreateState(setAccountMappings, getActualAccountSourceScope)
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({})
  const [categoryCreateKinds, setCategoryCreateKinds] = useState<Record<string, ImportCategoryKind>>({})
  const [paymentModes, setPaymentModes] = useState<Record<string, ActualPaymentMode>>({})
  const [selectedBudgetIds, setSelectedBudgetIds] = useState<Set<string> | null>(null)
  const [importRun, setImportRun] = useState<ProviderImportRunState<ActualSkippedRow>>(PROVIDER_IMPORT_RUN_IDLE)
  const [importRunController] = useState(() => createProviderImportRunController<ActualSkippedRow>({
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

  // Every answer the user gives about the import, as one value that changes only when one of them does
  const importAnswers = useMemo(
    () => ({
      accountMappings,
      accountCreateTypes,
      accountCreateCurrencies,
      accountCreateInstitutions,
      categoryMappings,
      categoryCreateKinds,
      paymentModes,
      selectedBudgetIds,
    }),
    [
      accountCreateCurrencies,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappings,
      categoryCreateKinds,
      categoryMappings,
      paymentModes,
      selectedBudgetIds,
    ],
  )

  // A failure is about the answers the import was sent with, so it stops showing once one changes
  const importError = getProviderImportError(importFailure, importAnswers)
  const importJournal = useImportJournal()
  const commitStagedJournal = useCommitStagedJournalImport()
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
    currencyOptions,
    institutionOptions,
    categoryMatchOptions: allCategoryMatchOptions,
    accountById,
    categoryById,
    institutionById,
  } = useImportReferenceData()

  const accountOptions = useMemo(() => buildImportAccountOptions(getPersonalAccounts(selectableAccounts)), [selectableAccounts])
  const categoryMatchOptions = useMemo(
    () => getPersonalCategoryOptions(allCategoryMatchOptions, categoryById),
    [allCategoryMatchOptions, categoryById],
  )

  // The commit files transfer legs and opening balances under these seeded categories
  const transferCategory = useMemo(
    () => (categories ?? []).find((category) => category.is_system && category.name === ACTUAL_TRANSFER_CATEGORY_NAME),
    [categories],
  )
  const balanceAdjustmentCategory = useMemo(
    () => (categories ?? []).find((category) => category.is_system && category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME),
    [categories],
  )

  const journal = useMemo(
    () => (budget ? normaliseActualBudget(budget, today) : EMPTY_JOURNAL),
    [budget, today],
  )
  const accountSources = journal.accounts

  const supportedCurrencyCodes = useMemo(() => getSupportedCurrencyCodes(currencies), [currencies])

  // A budget with Actual's currency feature on names its currency, and every new account takes it.
  // Without it the currency is the user's to choose, since guessing would write every amount wrong
  const proposedCurrency = budget?.currencyCode && supportedCurrencyCodes.has(budget.currencyCode) ? budget.currencyCode : ''

  // Every Actual account takes rows or is created, so none can be answered as money outside the import
  const accountMappingSources = useMemo(
    () => accountSources.map((source) => ({ id: source.id, label: source.label, matchText: source.name, isCounterpartyOnly: false })),
    [accountSources],
  )

  // An answer pointing at a deleted account is dropped before anything is derived from it
  const liveAccountMappings = useMemo(
    () => (accountsResolved ? dropVanishedAccountMappings(accountMappings, accountById).mappings : accountMappings),
    [accountById, accountMappings, accountsResolved],
  )

  const resolvedAccountMappings = useMemo(
    () => resolveActualAccountMappings(accountMappingSources, liveAccountMappings, selectableAccounts, accountsCurrent),
    [accountMappingSources, accountsCurrent, liveAccountMappings, selectableAccounts],
  )

  const autoFilledAccountSources = useMemo(
    () => new Set(accountSources.map((source) => source.id).filter((source) => (
      isAutoFilledAccountSource(liveAccountMappings[source] ?? '', resolvedAccountMappings[source] ?? '', false)
    ))),
    [accountSources, liveAccountMappings, resolvedAccountMappings],
  )

  const handAnsweredAccountSources = useMemo(
    () => new Set(Object.entries(liveAccountMappings).filter(([, choice]) => choice).map(([source]) => source)),
    [liveAccountMappings],
  )

  const resolvedAccountCreateDetails = useMemo(
    () => {
      const details: Record<string, ActualAccountCreateDetails> = {}
      for (const source of accountSources) {
        details[source.id] = {
          accountType: accountCreateTypes[source.id] ?? source.proposedType,
          currency: accountCreateCurrencies[source.id] ?? proposedCurrency,
          institutionId: accountCreateInstitutions[source.id] ?? '',
        }
      }
      return details
    },
    [accountCreateCurrencies, accountCreateInstitutions, accountCreateTypes, accountSources, proposedCurrency],
  )

  // Whether a transfer pays a credit account follows the account each side is linked to or created as
  const revolvingAccountIds = useMemo(
    () => getActualRevolvingAccountIds(
      accountSources.map((source) => source.id),
      resolvedAccountMappings,
      resolvedAccountCreateDetails,
      accountById,
    ),
    [accountById, accountSources, resolvedAccountCreateDetails, resolvedAccountMappings],
  )

  const creditJournal = useMemo(() => applyActualCreditPayments(journal, revolvingAccountIds), [journal, revolvingAccountIds])
  const categorySources = creditJournal.categories

  // Every category with payments to off-budget accounts has a mode, a transfer until the user says otherwise
  const resolvedPaymentModes = useMemo(
    () => Object.fromEntries(categorySources.flatMap((source) => (
      source.role === 'transfer' && source.categoryId ? [[source.id, getActualPaymentMode(paymentModes, source.id)]] : []
    ))) as Record<string, ActualPaymentMode>,
    [categorySources, paymentModes],
  )

  // What the import sends, previews and counts. Answers and budgets stay on the journal as read, so
  // each source keeps its own answer while the user switches a mode back and forth
  const effectiveJournal = useMemo(
    () => applyActualPaymentModes(creditJournal, resolvedPaymentModes),
    [creditJournal, resolvedPaymentModes],
  )

  // Same reason as the accounts above: a match pointing at a deleted category would reach the commit
  const liveCategoryMappings = useMemo(
    () => (categoriesResolved ? dropVanishedCategoryMappings(categoryMappings, categoryById).mappings : categoryMappings),
    [categoriesResolved, categoryById, categoryMappings],
  )

  const resolvedCategoryMappings = useMemo(
    () => inferActualCategoryMappings(categorySources, liveCategoryMappings, categories ?? []),
    [categories, categorySources, liveCategoryMappings],
  )

  const autoFilledCategories = useMemo(
    () => new Set(categorySources.map((source) => source.id).filter((source) => (
      !liveCategoryMappings[source] && resolvedCategoryMappings[source] !== CREATE_CATEGORY_VALUE
    ))),
    [categorySources, liveCategoryMappings, resolvedCategoryMappings],
  )

  // A transfer source can only be created as a transfer, whatever was chosen for it before
  const resolvedCategoryKinds = useMemo(
    () => {
      const kinds: Record<string, ImportCategoryKind> = {}
      for (const source of categorySources) {
        const proposed = getActualCategoryKind(source)
        kinds[source.id] = source.role === 'transfer' ? proposed : categoryCreateKinds[source.id] ?? proposed
      }
      return kinds
    },
    [categoryCreateKinds, categorySources],
  )

  const currentMonth = today.slice(0, 7)
  const budgetDrafts = useMemo(
    () => (budget ? buildActualBudgetDrafts(budget, currentMonth) : []),
    [budget, currentMonth],
  )

  // Importable budgets start checked until the user makes an explicit selection
  const resolvedSelectedBudgetIds = useMemo(
    () => selectedBudgetIds ?? new Set(budgetDrafts.filter((draft) => !draft.disabledReason).map((draft) => draft.categoryId)),
    [budgetDrafts, selectedBudgetIds],
  )

  const selectedBudgetDrafts = useMemo(
    () => budgetDrafts.filter((draft) => !draft.disabledReason && resolvedSelectedBudgetIds.has(draft.categoryId)),
    [budgetDrafts, resolvedSelectedBudgetIds],
  )

  const budgetCategorySources = useMemo(
    () => new Set(selectedBudgetDrafts.map((draft) => draft.categorySourceId)),
    [selectedBudgetDrafts],
  )

  const visibleCategorySources = useMemo(
    () => getVisibleActualCategorySources(categorySources, resolvedPaymentModes, budgetCategorySources),
    [budgetCategorySources, categorySources, resolvedPaymentModes],
  )

  const importBuild = useMemo(
    () => (budget
      ? buildActualImportPayload(effectiveJournal, {
        accountMappings: resolvedAccountMappings,
        accountCreateDetails: resolvedAccountCreateDetails,
        accountById,
        categoryMappings: resolvedCategoryMappings,
        categoryCreateKinds: resolvedCategoryKinds,
        categoryById,
        currencies,
        fileCurrency: budget.currencyCode,
        budgetCategorySources,
      })
      : EMPTY_BUILD),
    [
      accountById,
      budget,
      budgetCategorySources,
      categoryById,
      currencies,
      effectiveJournal,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
      resolvedCategoryKinds,
      resolvedCategoryMappings,
    ],
  )

  const currencyExponent = importBuild.currency ? findCurrencyExponent(currencies, importBuild.currency) : null

  // A budget the answers make unimportable moves to the skipped list with its reason, and comes
  // back once the answer changes
  const budgetRefusals = useMemo(
    () => new Map(budgetDrafts.map((draft) => [draft.categoryId, getActualBudgetRefusal(draft, {
      currency: importBuild.currency,
      budgetDecimals: budget?.budgetDecimals ?? 2,
      currencyExponent,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
      categoryById,
    })])),
    [budget, budgetDrafts, categoryById, currencyExponent, importBuild.currency, resolvedCategoryKinds, resolvedCategoryMappings],
  )

  const pendingBudgetDrafts = useMemo(
    () => selectedBudgetDrafts.filter((draft) => !budgetRefusals.get(draft.categoryId)),
    [budgetRefusals, selectedBudgetDrafts],
  )

  // Budgets count expenses only, so one whose category's payments to off-budget accounts come in as
  // transfers shows less spent than Actual did
  const budgetsMissingPayments = useMemo(
    () => pendingBudgetDrafts
      .filter((draft) => resolvedPaymentModes[getActualTransferSourceId(draft.categoryId)] === 'transfer')
      .map((draft) => draft.name),
    [pendingBudgetDrafts, resolvedPaymentModes],
  )

  // Built here rather than at the import so a budget the import cannot send is refused while the
  // selection can still change
  const runBudgetsBuild = useMemo<{ budgets: ImportRunBudgets | null; error: string | null }>(
    () => {
      if (!importBuild.payload || !importBuild.currency || currencyExponent === null || pendingBudgetDrafts.length === 0) {
        return { budgets: null, error: null }
      }
      try {
        const budgets = buildActualRunBudgets(
          pendingBudgetDrafts,
          importBuild.currency,
          budget?.budgetDecimals ?? 2,
          currencyExponent,
          importBuild.budgetCategoryMappings,
        )

        // The budgets go in one request, and a request past the server's limit is refused whole
        if (getJsonByteSize(budgets) > PROVIDER_MAX_BUDGETS_REQUEST_BYTES) {
          return { budgets: null, error: 'The selected budgets are too large to import at once. Select fewer budgets.' }
        }
        return { budgets, error: null }
      } catch (error) {
        return { budgets: null, error: error instanceof Error ? error.message : String(error) }
      }
    },
    [budget, currencyExponent, importBuild, pendingBudgetDrafts],
  )

  const budgetSelectionError = pendingBudgetDrafts.length > ACTUAL_MAX_BUDGETS
    ? `Select at most ${ACTUAL_MAX_BUDGETS.toLocaleString()} budgets to import, since the importer takes up to that many at once.`
    : runBudgetsBuild.error

  // Rows the reader left out and rows the chosen currency can't hold, in date order
  const predictedSkippedRows = useMemo(
    () => [...journal.skippedRows, ...importBuild.skippedRows].sort((a, b) => a.date.localeCompare(b.date)),
    [importBuild.skippedRows, journal.skippedRows],
  )

  const skippedTransactionIds = useMemo(
    () => new Set(importBuild.skippedRows.map((row) => row.transactionId)),
    [importBuild.skippedRows],
  )

  const importEstimate = useMemo(
    () => {
      const entries = effectiveJournal.entries.filter((entry) => !skippedTransactionIds.has(entry.transactionId))
      return {
        rowCount: entries.length,
        transactionEstimate: entries.reduce((total, entry) => total + (entry.type === 'transfer' ? 2 : 1), 0),
      }
    },
    [effectiveJournal.entries, skippedTransactionIds],
  )

  const previewRows = useMemo(
    () => buildActualPreviewRows(effectiveJournal, {
      accountMappings: resolvedAccountMappings,
      accountCreateDetails: resolvedAccountCreateDetails,
      accountById,
      institutionById,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
      categoryById,
      transferCategory,
      balanceAdjustmentCategory,
      currencies,
      skippedTransactionIds,
    }, ACTUAL_SAMPLE_PREVIEW_LIMIT),
    [
      accountById,
      balanceAdjustmentCategory,
      categoryById,
      currencies,
      effectiveJournal,
      institutionById,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
      resolvedCategoryKinds,
      resolvedCategoryMappings,
      skippedTransactionIds,
      transferCategory,
    ],
  )

  const previewGroups = useMemo(() => groupPreviewRowsByDate(previewRows), [previewRows])

  // A source answered create is counted only while the import sends it
  const newAccountCount = countCreatedImportSources(
    accountSources.map((source) => source.id),
    resolvedAccountMappings,
    CREATE_ACCOUNT_VALUE,
    importBuild.writtenSources.accounts,
  )
  const newCategoryCount = countCreatedImportSources(
    categorySources.map((source) => source.id),
    resolvedCategoryMappings,
    CREATE_CATEGORY_VALUE,
    new Set([...importBuild.writtenSources.categories, ...budgetCategorySources]),
  )

  // Closed accounts the import creates are archived, and a balance left in one is brought to zero
  const closedAccountsWithBalance = accountSources.filter((source) => (
    isArchivedWhenCreated(source) && source.balance !== 0 && resolvedAccountMappings[source.id] === CREATE_ACCOUNT_VALUE
  ))

  // A closed account holding rows dated after today can't be archived, so the import creates it open
  const closedAccountsKeptOpen = accountSources.filter((source) => (
    source.closed && !isArchivedWhenCreated(source) && resolvedAccountMappings[source.id] === CREATE_ACCOUNT_VALUE
  ))

  // Closed accounts linked to one the user has write their rows there and leave it as it is
  const closedAccountsLinked = accountSources.filter((source) => {
    const choice = resolvedAccountMappings[source.id]
    return source.closed && source.rowCount > 0 && Boolean(choice) && choice !== CREATE_ACCOUNT_VALUE
  })

  const importOverlaySteps = useMemo<ImportProgressStep[] | undefined>(
    () => {
      if (!importStageState) return undefined
      const { isFinished, stage } = importStageState
      const currentIndex = PROVIDER_IMPORT_STAGES.findIndex((entry) => entry.id === stage)
      return PROVIDER_IMPORT_STAGES.slice(currentIndex).map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        status: index > 0 ? 'queued' : isFinished ? 'done' : 'active',
      }))
    },
    [importStageState],
  )

  const completedSkippedCount = completedImport?.skippedRowsAtCommit.length ?? 0
  const importSummary = importResult ? formatProviderImportSummary(importResult, completedSkippedCount) : ''
  const importedBudgetNames = useMemo(
    () => new Set(importResult?.budgets.map((result) => result.name) ?? []),
    [importResult],
  )

  const importOverlayError = importError && importOverlayPhase === 'error'
    ? describeProviderImportFailure(importError, stagedRunId !== null)
    : importError
  const importOverlayOpen = importOverlayPhase !== 'idle'
  const isImportInFlight = importJournal.isPending || commitStagedJournal.isPending

  const canCommitImport = canStartProviderImport({
    hasPayload: importBuild.payload !== null,
    isProcessingFile,
    budgetSelectionError,
    overlayOpen: importOverlayOpen,
    inFlight: isImportInFlight,
    hasResult: importResult !== null,
  })

  const resetAnswers = () => {
    setAccountMappings({})
    resetAccountCreateState()
    setCategoryMappings({})
    setCategoryCreateKinds({})
    setPaymentModes({})
    setSelectedBudgetIds(null)
    importRunController.reset()
    importJournal.reset()
    commitStagedJournal.reset()
  }

  const handleActualFileChange = async (acquiredFiles: ImportFileAcquisition) => {
    const intake = await processImportFileIntake({
      files: acquiredFiles,
      processing: isProcessingFile,
      unavailableReason: getImportUploadBlockReason(currencies, currenciesError)?.message ?? null,
      fileType: ACTUAL_IMPORT_FILE_TYPE,
      readFile: async (file) => {
        setFileIntakeError(null)
        setIsProcessingFile(true)
        try {
          const [read] = await Promise.all([readActualBudgetFile(file), waitForMilliseconds(LOADING_ANIMATION_MIN_MS)])
          return { file, read }
        } finally {
          setIsProcessingFile(false)
        }
      },
    })

    if (intake.status === 'refused') {
      setFileIntakeError(intake.reason)
      return
    }
    if (intake.status !== 'accepted') return

    const { file, read } = intake.result
    if (read.status === 'refused') {
      setFileIntakeError(read.reason)
      return
    }
    if (read.budget.currencyCode && !supportedCurrencyCodes.has(read.budget.currencyCode)) {
      setFileIntakeError(getActualUnsupportedCurrencyError(read.budget.currencyCode))
      return
    }

    setBudget(read.budget)
    setStagedFile({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      budgetName: read.budget.budgetName,
      rowCount: read.budget.transactions.length,
    })
    resetAnswers()
  }

  const removeActualFile = () => {
    setBudget(null)
    setStagedFile(null)
    setFileIntakeError(null)
    resetAnswers()
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || !canCommitImport) return

    // The import creates the budgets selected when it started, so they are captured here
    const request = {
      source: 'actual_budget' as const,
      payload,
      budgets: runBudgetsBuild.budgets,
      archiveAccountSources: importBuild.archiveAccountSources,
    }
    await importRunController.start(
      predictedSkippedRows,
      importAnswers,
      (signal, onStaged) => importJournal.mutateAsync({ request, signal, onStaged }),
    )
  }

  const retryImportCommit = async () => {
    if (isImportInFlight) return
    await importRunController.retry(importAnswers, (runId, signal) => commitStagedJournal.mutateAsync({ runId, signal }))
  }

  const toggleBudgetSelection = (categoryId: string) => {
    const next = new Set(resolvedSelectedBudgetIds)
    if (next.has(categoryId)) {
      next.delete(categoryId)
    } else {
      next.add(categoryId)
    }
    setSelectedBudgetIds(next)
  }

  const setBudgetsSelected = (categoryIds: string[], selected: boolean) => {
    const next = new Set(resolvedSelectedBudgetIds)
    for (const categoryId of categoryIds) {
      if (selected) {
        next.add(categoryId)
      } else {
        next.delete(categoryId)
      }
    }
    setSelectedBudgetIds(next)
  }

  const setPaymentMode = (transferSourceId: string, mode: ActualPaymentMode) => {
    setPaymentModes((current) => ({ ...current, [transferSourceId]: mode }))
  }

  const resetActualWorkflow = () => {
    removeActualFile()
    setIsProcessingFile(false)
  }

  // Leaving the page abandons the import: while uploading that drops what was uploaded, and while
  // saving it only stops waiting, since the save is the server's to finish
  useEffect(() => () => importRunController.stop(), [importRunController])

  return {
    stagedFile,
    budget,
    journal,
    isProcessingFile,
    fileIntakeError,
    accountSources,
    categorySources,
    visibleCategorySources,
    paymentModes: resolvedPaymentModes,
    accountMappings: resolvedAccountMappings,
    autoFilledAccountSources,
    handAnsweredAccountSources,
    accountCreateDetails: resolvedAccountCreateDetails,
    closedAccountsWithBalance,
    closedAccountsKeptOpen,
    closedAccountsLinked,
    accountsFailed,
    categoriesFailed,
    refetchAccounts,
    refetchCategories,
    selectedAccountRows,
    batchAccountType,
    batchAccountCurrency,
    batchAccountInstitution,
    resolvedCategoryMappings,
    autoFilledCategories,
    resolvedCategoryKinds,
    budgetDrafts,
    budgetRefusals,
    budgetsMissingPayments,
    selectedBudgetIds: resolvedSelectedBudgetIds,
    importedBudgetNames,
    budgetSelectionError,
    importEstimate,
    previewRows,
    previewGroups,
    predictedSkippedRows,
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
    setPaymentMode,
    handleActualFileChange,
    removeActualFile,
    updateActualAccountMapping,
    handleCommitImport,
    retryImportCommit,
    cancelImport: importRunController.stop,
    closeImportOverlay: importRunController.close,
    toggleBudgetSelection,
    setBudgetsSelected,
    resetActualWorkflow,
  }
}

export type ActualImportWorkflow = ReturnType<typeof useActualImportWorkflow>
