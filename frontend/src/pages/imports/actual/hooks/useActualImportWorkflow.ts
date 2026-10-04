import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getTodayYmd, resolveTimeZone } from '@/utils/date'
import { findCurrencyExponent } from '@/utils/moneyInput'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  IMPORT_MAX_BUDGETS,
  IMPORT_SAMPLE_PREVIEW_LIMIT,
  IMPORT_TRANSFER_CATEGORY_NAME,
} from '@/pages/imports/constants'
import {
  useImportAccountCreateState,
  useImportBudgetSelection,
  useProviderAccountAnswers,
  useProviderCategoryAnswers,
  useProviderCategoryAnswerState,
  useProviderFileIntake,
  useProviderImportReferenceData,
  useProviderImportRun,
} from '@/pages/imports/hooks'
import type { ImportAccountCreateDetails, ImportCategoryKind } from '@/pages/imports/types'
import {
  buildProviderRunBudgets,
  countCreatedImportSources,
  getImportUploadBlockReason,
  getProviderBudgetSelectionError,
  getSupportedCurrencyCodes,
  groupPreviewRowsByDate,
  type ImportFileAcquisition,
} from '@/pages/imports/utils'
import {
  ACTUAL_CATEGORY_RENAME_APP_NAME,
  ACTUAL_IMPORT_FILE_TYPE,
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
import { buildActualImportPayload, isArchivedWhenCreated, type ActualImportBuild } from '@/pages/imports/actual/utils/payload'
import { buildActualPreviewRows } from '@/pages/imports/actual/utils/preview'
import { readActualBudgetFile } from '@/pages/imports/actual/utils/readFile'

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

// An Actual Budget import reads one file, so its one refusal is kept under one kind
const ACTUAL_FILE_KINDS = ['budget'] as const

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
  const fileIntake = useProviderFileIntake(ACTUAL_FILE_KINDS)
  const isProcessingFile = fileIntake.processingKind !== null
  const fileIntakeError = fileIntake.intakeErrors.budget
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
  const categoryAnswers = useProviderCategoryAnswerState()
  const { categoryMappings, categoryCreateKinds, categoryCreateNames } = categoryAnswers
  const [paymentModes, setPaymentModes] = useState<Record<string, ActualPaymentMode>>({})
  const [selectedBudgetIds, setSelectedBudgetIds] = useState<Set<string> | null>(null)

  // Every answer the user gives about the import, as one value that changes only when one of them does
  const importAnswers = useMemo(
    () => ({
      accountMappings,
      accountCreateTypes,
      accountCreateCurrencies,
      accountCreateInstitutions,
      categoryMappings,
      categoryCreateKinds,
      categoryCreateNames,
      paymentModes,
      selectedBudgetIds,
    }),
    [
      accountCreateCurrencies,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappings,
      categoryCreateKinds,
      categoryCreateNames,
      categoryMappings,
      paymentModes,
      selectedBudgetIds,
    ],
  )

  const run = useProviderImportRun<ActualSkippedRow>({ source: 'actual_budget', answers: importAnswers })
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

    // The commit files transfer legs and opening balances under these seeded categories
    transferCategory,
    balanceAdjustmentCategory,
  } = useProviderImportReferenceData({ transferCategoryName: IMPORT_TRANSFER_CATEGORY_NAME })

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

  const { resolvedAccountMappings, autoFilledAccountSources, handAnsweredAccountSources } = useProviderAccountAnswers({
    sources: accountMappingSources,
    accountMappings,
    reference: { accountsResolved, accountsCurrent, accountById, selectableAccounts },
  })

  const resolvedAccountCreateDetails = useMemo(
    () => {
      const details: Record<string, ImportAccountCreateDetails> = {}
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

  const inferCategoryMappings = useCallback(
    (liveMappings: Record<string, string>) => inferActualCategoryMappings(categorySources, liveMappings, categories ?? []),
    [categories, categorySources],
  )

  const categoryNameSources = useMemo(
    () => categorySources.map((source) => ({ id: source.id, name: source.createName })),
    [categorySources],
  )

  const proposedCategoryKinds = useMemo(
    () => Object.fromEntries(categorySources.map((source) => [source.id, getActualCategoryKind(source)])) as Record<string, ImportCategoryKind>,
    [categorySources],
  )

  // A transfer source can only be created as a transfer, whatever was chosen for it before
  const fixedKindCategorySources = useMemo(
    () => new Set(categorySources.filter((source) => source.role === 'transfer').map((source) => source.id)),
    [categorySources],
  )

  const { resolvedCategoryMappings, autoFilledCategories, resolvedCategoryKinds, categoryRenames } = useProviderCategoryAnswers({
    sources: categoryNameSources,
    answers: categoryAnswers,
    inferMappings: inferCategoryMappings,
    proposedKinds: proposedCategoryKinds,
    fixedKindSources: fixedKindCategorySources,
    appName: ACTUAL_CATEGORY_RENAME_APP_NAME,
    reference: { categoriesResolved, categoryById },
  })

  const currentMonth = today.slice(0, 7)
  const budgetDrafts = useMemo(
    () => (budget ? buildActualBudgetDrafts(budget, currentMonth) : []),
    [budget, currentMonth],
  )

  const importableBudgetIds = useMemo(
    () => budgetDrafts.filter((draft) => !draft.disabledReason).map((draft) => draft.categoryId),
    [budgetDrafts],
  )
  const {
    selectedKeys: resolvedSelectedBudgetIds,
    toggleBudgetSelection,
    setBudgetsSelected,
  } = useImportBudgetSelection({
    selection: selectedBudgetIds,
    setSelection: setSelectedBudgetIds,
    importableKeys: importableBudgetIds,
  })

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
        categoryRenames,
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
      categoryRenames,
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

  const runBudgetsBuild = useMemo(
    () => {
      const currency = importBuild.currency
      if (!importBuild.payload || !currency || currencyExponent === null || pendingBudgetDrafts.length === 0) {
        return { budgets: null, error: null }
      }
      return buildProviderRunBudgets(() => buildActualRunBudgets(
        pendingBudgetDrafts,
        currency,
        budget?.budgetDecimals ?? 2,
        currencyExponent,
        importBuild.budgetCategoryMappings,
      ))
    },
    [budget, currencyExponent, importBuild, pendingBudgetDrafts],
  )

  const budgetSelectionError = getProviderBudgetSelectionError(pendingBudgetDrafts.length, IMPORT_MAX_BUDGETS, runBudgetsBuild.error)

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
      categoryRenames,
      categoryById,
      transferCategory,
      balanceAdjustmentCategory,
      currencies,
      skippedTransactionIds,
    }, IMPORT_SAMPLE_PREVIEW_LIMIT),
    [
      accountById,
      balanceAdjustmentCategory,
      categoryById,
      categoryRenames,
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

  const canCommitImport = run.canCommit({ hasPayload: importBuild.payload !== null, isProcessingFile, budgetSelectionError })

  const resetAnswers = () => {
    setAccountMappings({})
    resetAccountCreateState()
    categoryAnswers.resetCategoryAnswers()
    setPaymentModes({})
    setSelectedBudgetIds(null)
    run.resetImportRun()
  }

  const handleActualFileChange = async (acquiredFiles: ImportFileAcquisition) => {
    const intake = await fileIntake.readImportFile('budget', {
      files: acquiredFiles,
      unavailableReason: getImportUploadBlockReason(currencies, currenciesError)?.message ?? null,
      fileType: ACTUAL_IMPORT_FILE_TYPE,
      read: async (file) => ({ file, read: await readActualBudgetFile(file) }),
    })

    if (intake.status !== 'accepted') return

    const { file, read } = intake.result
    if (read.status === 'refused') {
      fileIntake.setIntakeError('budget', read.reason)
      return
    }
    if (read.budget.currencyCode && !supportedCurrencyCodes.has(read.budget.currencyCode)) {
      fileIntake.setIntakeError('budget', getActualUnsupportedCurrencyError(read.budget.currencyCode))
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
    fileIntake.setIntakeError('budget', null)
    resetAnswers()
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || !canCommitImport) return
    await run.startImport({
      payload,
      budgets: runBudgetsBuild.budgets,
      archiveAccountSources: importBuild.archiveAccountSources,
      skippedRows: predictedSkippedRows,
    })
  }

  const setPaymentMode = (transferSourceId: string, mode: ActualPaymentMode) => {
    setPaymentModes((current) => ({ ...current, [transferSourceId]: mode }))
  }

  const resetActualWorkflow = () => {
    removeActualFile()
    fileIntake.resetFileIntake()
  }

  return {
    ...run.workflow,
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
    categoryRenames,
    budgetDrafts,
    budgetRefusals,
    budgetsMissingPayments,
    selectedBudgetIds: resolvedSelectedBudgetIds,
    budgetSelectionError,
    importEstimate,
    previewRows,
    previewGroups,
    predictedSkippedRows,
    newAccountCount,
    newCategoryCount,
    importBuild,
    canCommitImport,
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
    setCategoryMappings: categoryAnswers.setCategoryMappings,
    setCategoryCreateKinds: categoryAnswers.setCategoryCreateKinds,
    setCategoryCreateNames: categoryAnswers.setCategoryCreateNames,
    setPaymentMode,
    handleActualFileChange,
    removeActualFile,
    updateActualAccountMapping,
    handleCommitImport,
    toggleBudgetSelection,
    setBudgetsSelected,
    resetActualWorkflow,
  }
}

export type ActualImportWorkflow = ReturnType<typeof useActualImportWorkflow>
