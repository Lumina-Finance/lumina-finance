import { useMemo, useState } from 'react'
import { waitForMilliseconds } from '@/utils/timing'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, IMPORT_MAX_BUDGETS, IMPORT_SAMPLE_PREVIEW_LIMIT } from '@/pages/imports/constants'
import {
  useImportAccountCreateState,
  useImportBudgetSelection,
  useProviderAccountAnswers,
  useProviderImportReferenceData,
  useProviderImportRun,
} from '@/pages/imports/hooks'
import type { ImportCategoryKind, ImportFileDraft } from '@/pages/imports/types'
import {
  buildProviderRunBudgets,
  countCreatedImportSources,
  dropVanishedCategoryMappings,
  getImportCategoryRenames,
  getImportUploadBlockReason,
  getProviderBudgetSelectionError,
  getSupportedCurrencyCodes,
  groupPreviewRowsByDate,
  processImportFileIntake,
  type ImportFileAcquisition,
} from '@/pages/imports/utils'
import {
  FIREFLY_CATEGORY_RENAME_APP_NAME,
  FIREFLY_CSV_PROCESSING_MIN_MS,
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
  forecastFireflyImport,
  getFireflyFileHeaders,
  getFireflyFileRows,
  getFireflyImportedCategories,
  getFireflyAccountSources,
  inferFireflyCategoryMappings,
  readFireflyAccountDetails,
  readFireflyCsvFile,
  type FireflyAccountCreateDetails,
  type FireflyRowResolutionOptions,
  type FireflySkippedRowDetail,
} from '@/pages/imports/firefly/utils'

// This flow reads its account sources from the staged export rather than from a column the user
// picks, and staging a different export resets everything, so its answers are never carried onto a
// set of sources they were not given for and one fixed scope holds for every source
const getFireflyAccountSourceScope = () => 'firefly'

/**
 * Drives the whole Firefly III import flow: reading the transactions, budgets and accounts exports,
 * resolving their accounts and categories against the user's existing ones, building the import,
 * and running it as one run that uploads everything and then writes all of it at once
 *
 * Uploading a new transactions export resets every derived mapping and any prior result, since a
 * different export invalidates all of it. A new accounts export resets the account answers, since
 * it changes which accounts there are and what each is proposed as. An import that fails writes nothing, and one whose save
 * failed for a reason trying again could clear keeps its upload, so a retry only saves again
 */
export function useFireflyImportWorkflow() {
  const [transactionsFile, setTransactionsFile] = useState<ImportFileDraft | null>(null)
  const [budgetsFile, setBudgetsFile] = useState<ImportFileDraft | null>(null)
  const [accountsFile, setAccountsFile] = useState<ImportFileDraft | null>(null)
  const [processingFileKind, setProcessingFileKind] = useState<FireflyFileKind | null>(null)
  const [fileIntakeErrors, setFileIntakeErrors] = useState<Record<FireflyFileKind, string | null>>({
    transactions: null,
    budgets: null,
    accounts: null,
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
  const [categoryCreateNames, setCategoryCreateNames] = useState<Record<string, string>>({})
  const [selectedBudgetNames, setSelectedBudgetNames] = useState<Set<string> | null>(null)

  // Every answer the user gives about the import, as one value that changes only when one of them does
  const importAnswers = useMemo(
    () => ({
      budgetsFile,
      accountsFile,
      accountMappings,
      accountCreateTypes,
      accountCreateCurrencies,
      accountCreateInstitutions,
      categoryMappings,
      categoryCreateKinds,
      categoryCreateNames,
      selectedBudgetNames,
    }),
    [
      accountCreateCurrencies,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappings,
      accountsFile,
      budgetsFile,
      categoryCreateKinds,
      categoryCreateNames,
      categoryMappings,
      selectedBudgetNames,
    ],
  )

  const run = useProviderImportRun<FireflySkippedRowDetail>({ source: 'firefly', answers: importAnswers })
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

    // The commit assigns these seeded system categories to transfer legs and balance rows
    transferCategory,
    balanceAdjustmentCategory,
  } = useProviderImportReferenceData({ transferCategoryName: FIREFLY_TRANSFER_CATEGORY_NAME })

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

  const accountDetails = useMemo(
    () => (accountsFile && !accountsFile.error ? readFireflyAccountDetails(accountsFile.rows) : null),
    [accountsFile],
  )

  const accountSources = useMemo(
    () => getFireflyAccountSources(fireflyRows, accountDetails),
    [accountDetails, fireflyRows],
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

  // Every Firefly source is an account the import writes rows into or creates, so none of them
  // can be answered as money outside the tracked accounts
  const accountMappingSources = useMemo(
    () => trackedAccounts.map((source) => ({
      id: source.id,
      label: source.label,
      matchText: source.name,
      isCounterpartyOnly: false,
    })),
    [trackedAccounts],
  )

  // Both sides of a Firefly transfer take rows, so no source here can record an archived or read-only
  // account and both matching lists are the same one
  const { resolvedAccountMappings, autoFilledAccountSources, handAnsweredAccountSources } = useProviderAccountAnswers({
    sources: accountMappingSources,
    accountMappings,
    reference: { accountsResolved, accountsCurrent, accountById, selectableAccounts },
  })

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

  const categoryRenames = useMemo(
    () => getImportCategoryRenames({
      sources: importedCategories.map((source) => ({ id: source, name: source })),
      mappings: resolvedCategoryMappings,
      kinds: resolvedCategoryKinds,
      typedNames: categoryCreateNames,
      categoryById,
      appName: FIREFLY_CATEGORY_RENAME_APP_NAME,
    }),
    [categoryById, categoryCreateNames, importedCategories, resolvedCategoryKinds, resolvedCategoryMappings],
  )

  const previewRows = useMemo(
    () => buildFireflyPreviewRows({
      rows: fireflyRows,
      limit: IMPORT_SAMPLE_PREVIEW_LIMIT,
      accountSources,
      accountById,
      accountMappings: resolvedAccountMappings,
      accountCreateDetails: resolvedAccountCreateDetails,
      institutionById,
      categoryById,
      categoryMappings: resolvedCategoryMappings,
      categoryCreateKinds: resolvedCategoryKinds,
      categoryRenames,
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
      categoryRenames,
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
      categoryRenames,
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
      categoryRenames,
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
      categoryRenames,
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
      categoryRenames,
      resolvedCategoryKinds,
      resolvedCategoryMappings,
      transactionsFile,
    ],
  )

  // A source answered create is counted only while the import sends it, since the commit creates
  // nothing for a source whose rows are all skipped unless the accounts export lists it
  const newAccountCount = useMemo(
    () => countCreatedImportSources(
      trackedAccounts.map((source) => source.id),
      resolvedAccountMappings,
      CREATE_ACCOUNT_VALUE,
      importBuild.writtenSources.accounts,
    ),
    [importBuild, resolvedAccountMappings, trackedAccounts],
  )

  const newCategoryCount = useMemo(
    () => countCreatedImportSources(
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

  const {
    selectedKeys: resolvedSelectedBudgets,
    toggleBudgetSelection,
    setBudgetsSelected,
  } = useImportBudgetSelection({
    selection: selectedBudgetNames,
    setSelection: setSelectedBudgetNames,
    importableKeys: importableBudgetNames,
  })

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

  // What the run creates alongside the rows, sending their categories by the export names the
  // category step mapped
  const runBudgetsBuild = useMemo(
    () => {
      const categoryMappings = importBuild.payload?.categories
      if (!categoryMappings || pendingBudgetDrafts.length === 0) return { budgets: null, error: null }
      return buildProviderRunBudgets(() => buildFireflyRunBudgets(pendingBudgetDrafts, categoryMappings))
    },
    [importBuild.payload, pendingBudgetDrafts],
  )

  const budgetSelectionError = getProviderBudgetSelectionError(pendingBudgetDrafts.length, IMPORT_MAX_BUDGETS, runBudgetsBuild.error)

  const canCommitImport = run.canCommit({
    hasPayload: importBuild.payload !== null,
    isProcessingFile: processingFileKind !== null,
    budgetSelectionError,
  })

  const resetMappingState = () => {
    setAccountMappings({})
    resetAccountCreateState()
    setCategoryMappings({})
    setCategoryCreateKinds({})
    setCategoryCreateNames({})
  }

  const resetCommitState = () => {
    run.resetImportRun()
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

    if (kind === 'accounts') {
      setAccountsFile(draft)

      // The accounts export adds accounts and changes what each is proposed as, so the account
      // answers start over. The category answers still hold
      setAccountMappings({})
      resetAccountCreateState()
      resetCommitState()
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
    await run.startImport({
      payload,
      budgets: runBudgetsBuild.budgets,
      archiveAccountSources: importBuild.archiveAccountSources,
      skippedRows: predictedSkippedRows,
    })
  }

  const resetFireflyWorkflow = () => {
    setTransactionsFile(null)
    setBudgetsFile(null)
    setAccountsFile(null)
    setProcessingFileKind(null)
    setFileIntakeErrors({ transactions: null, budgets: null, accounts: null })
    resetMappingState()
    resetCommitState()
    resetBudgetPanelState()
  }

  return {
    ...run.workflow,
    transactionsFile,
    budgetsFile,
    accountsFile,
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
    categoryRenames,
    importEstimate,
    previewRows,
    previewGroups,
    predictedSkippedRows,
    predictedRowWarnings,
    newAccountCount,
    newCategoryCount,
    importBuild,
    canCommitImport,
    budgetDrafts,
    selectedBudgetNames: resolvedSelectedBudgets,
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
    setCategoryCreateNames,
    handleFireflyFileChange,
    removeFireflyFile,
    updateFireflyAccountMapping,
    handleCommitImport,
    toggleBudgetSelection,
    setBudgetsSelected,
    resetFireflyWorkflow,
  }
}

export type FireflyImportWorkflow = ReturnType<typeof useFireflyImportWorkflow>
