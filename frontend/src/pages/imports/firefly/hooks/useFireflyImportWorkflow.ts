import { useMemo, useState, type ChangeEvent } from 'react'
import { useAccounts } from '@/api/accounts'
import { useCreateBaseBudget } from '@/api/budgets'
import { useCategories } from '@/api/categories'
import { useCurrencies } from '@/api/currency'
import { useImportFireflyTransactions, type FireflyTransactionImportResponse } from '@/api/dataImports'
import { useInstitutions } from '@/api/institutions'
import { toMinorUnits } from '@/pages/budgets/utils/money'
import { waitForMilliseconds } from '@/utils/timing'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '../../constants'
import type { ImportCategoryKind, ImportFileDraft, ImportOverlayPhase } from '../../types'
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
  FIREFLY_CSV_PROCESSING_MIN_MS,
  FIREFLY_IMPORT_OVERLAY_MIN_MS,
  FIREFLY_BALANCE_ADJUSTMENT_CATEGORY_NAME,
  FIREFLY_SAMPLE_PREVIEW_LIMIT,
  FIREFLY_TRANSFER_CATEGORY_NAME,
} from '../constants'
import type { FireflyBudgetImportStatus, FireflyFileKind } from '../types'
import {
  buildFireflyAccountPrefills,
  buildFireflyBudgetDrafts,
  buildFireflyCategoryKinds,
  buildFireflyImportPayload,
  buildFireflyPreviewRows,
  estimateFireflyImport,
  formatFireflyImportSummary,
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
  const [selectedBudgetNames, setSelectedBudgetNames] = useState<Set<string> | null>(null)
  const [budgetImportStatuses, setBudgetImportStatuses] = useState<Record<string, FireflyBudgetImportStatus>>({})
  const [budgetImportErrors, setBudgetImportErrors] = useState<Record<string, string>>({})
  const [isImportingBudgets, setIsImportingBudgets] = useState(false)
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts()
  const { data: currencies = [], isLoading: currenciesLoading } = useCurrencies()
  const { data: institutions = [], isLoading: institutionsLoading } = useInstitutions()
  const { data: categories, isLoading: categoriesLoading } = useCategories()
  const importFireflyTransactions = useImportFireflyTransactions()
  const createBaseBudget = useCreateBaseBudget()

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

  const institutionById = useMemo(
    () => new Map(institutions.map((institution) => [institution.id, institution])),
    [institutions],
  )

  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  )

  const fireflyRows = useMemo(
    () => getFireflyFileRows(transactionsFile),
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

  const importEstimate = useMemo(
    () => estimateFireflyImport(fireflyRows),
    [fireflyRows],
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

  const budgetDrafts = useMemo(
    () => (
      importResult
        ? buildFireflyBudgetDrafts({
          budgetsFile,
          transactionRows: fireflyRows,
          categorySourceIds: importResult.category_source_ids,
        })
        : []
    ),
    [budgetsFile, fireflyRows, importResult],
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

  const importSummary = importResult ? formatFireflyImportSummary(importResult) : ''
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
    importFireflyTransactions.reset()
  }

  const resetBudgetPanelState = () => {
    setSelectedBudgetNames(null)
    setBudgetImportStatuses({})
    setBudgetImportErrors({})
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

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || importOverlayOpen || importFireflyTransactions.isPending) return

    setImportError(null)
    setImportResult(null)
    setImportOverlayPhase('importing')
    const minimumOverlay = waitForMilliseconds(FIREFLY_IMPORT_OVERLAY_MIN_MS)

    try {
      const result = await importFireflyTransactions.mutateAsync(payload)
      await minimumOverlay
      setImportResult(result)
      setImportOverlayPhase('success')
    } catch (error) {
      await minimumOverlay
      setImportError(getErrorMessage(error))
      setImportOverlayPhase('error')
    }
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

  const handleImportBudgets = async () => {
    if (isImportingBudgets) return

    const pendingDrafts = budgetDrafts.filter((draft) => (
      !draft.disabledReason
      && resolvedSelectedBudgets.has(draft.name)
      && budgetImportStatuses[draft.name] !== 'imported'
    ))
    if (pendingDrafts.length === 0) return

    setIsImportingBudgets(true)

    try {
      // Budgets are created one at a time so a failure marks only its own row
      for (const draft of pendingDrafts) {
        const overallLimit = toMinorUnits(draft.amount, currencies, draft.currencyCode)
        if (overallLimit === null || !draft.periodStart) {
          setBudgetImportStatuses((current) => ({ ...current, [draft.name]: 'error' }))
          setBudgetImportErrors((current) => ({ ...current, [draft.name]: 'The exported limit amount is not a valid number' }))
          continue
        }

        try {
          await createBaseBudget.mutateAsync({
            name: draft.name,
            currency: draft.currencyCode,
            recurrence_freq: 'monthly',
            instance_length: 1,
            recurrence_weekday: null,
            recurrence_dom: 1,
            recurrence_month: null,
            recurs: true,
            category_ids: draft.categoryIds,
            period_start: draft.periodStart,
            overall_limit: overallLimit,
          })
          setBudgetImportStatuses((current) => ({ ...current, [draft.name]: 'imported' }))
          setBudgetImportErrors((current) => removeRecordKey(current, draft.name))
        } catch (error) {
          setBudgetImportStatuses((current) => ({ ...current, [draft.name]: 'error' }))
          setBudgetImportErrors((current) => ({ ...current, [draft.name]: getErrorMessage(error) }))
        }
      }
    } finally {
      setIsImportingBudgets(false)
    }
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
    newAccountCount,
    newCategoryCount,
    importBuild,
    importError,
    importResult,
    importOverlayPhase,
    importOverlayOpen,
    importSummary,
    canCommitImport,
    budgetDrafts,
    selectedBudgetNames: resolvedSelectedBudgets,
    budgetImportStatuses,
    budgetImportErrors,
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
    handleImportBudgets,
    resetFireflyWorkflow,
  }
}

export type FireflyImportWorkflow = ReturnType<typeof useFireflyImportWorkflow>
