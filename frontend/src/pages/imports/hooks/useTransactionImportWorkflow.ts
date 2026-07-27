import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useCategories } from '@/api/categories'
import { useAccounts } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useInstitutions } from '@/api/institutions'
import { useImportTransactions, type TransactionImportResponse } from '@/api/transaction-imports'
import {
  CREATE_ACCOUNT_VALUE,
  EMPTY_COLUMN_MAP,
} from '../constants'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, ImportCategoryKind, ImportFileDraft, ImportOverlayPhase, PreviewTransactionRow } from '../types'
import {
  buildColumnTargetOptions,
  buildImportAccountMappingSources,
  buildImportAccountOptions,
  buildImportCategoryMatchOptions,
  buildImportCurrencyOptions,
  buildImportInstitutionOptions,
  buildTransactionImportPayload,
  buildImportPreviewRows,
  formatImportSummary,
  getErrorMessage,
  getImportedCategoryTypes,
  getImportedCategories,
  getImportedMerchants,
  getImportedTags,
  getImportHeaders,
  getMissingRequiredColumnLabels,
  getNextAutoFilledColumnHeaders,
  getNextColumnMap,
  getNextColumnValidationErrors,
  inferAccountMappings,
  inferCategoryMappings,
  isColumnMappingComplete,
  groupPreviewRowsByDate,
  inferColumnMap,
  keepCurrentMatchMap,
  readCsvFile,
  removeRecordKey,
  removeSetValue,
  validateColumnValues,
} from '../utils'
import { waitForMilliseconds } from '@/utils/timing'

const FILE_ACCOUNT_MATCH_KEY = '__file_account__'
const CSV_PROCESSING_MIN_MS = 1500
const IMPORT_OVERLAY_MIN_MS = 2000

/**
 * Drives the generic CSV import flow: staging one file, mapping its columns to app fields, resolving
 * the accounts and categories those columns reference against the user's existing ones, building the
 * preview and commit payload, and running the commit
 *
 * Account and category matches are only inferred automatically while the required columns stay
 * mapped to the same headers; changing a required column's mapping clears the matching auto-fill key
 * so a stale inference is never carried into a different set of source values
 */
export function useTransactionImportWorkflow() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<ImportFileDraft[]>([])
  const [isProcessingFiles, setIsProcessingFiles] = useState(false)
  const [autoFilledColumnHeaders, setAutoFilledColumnHeaders] = useState<Set<string>>(() => new Set())
  const [columnMap, setColumnMap] = useState<ColumnMap>(EMPTY_COLUMN_MAP)
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const [accountAutoMatchKey, setAccountAutoMatchKey] = useState('')
  const [accountCreateTypes, setAccountCreateTypes] = useState<Record<string, string>>({})
  const [accountCreateCurrencies, setAccountCreateCurrencies] = useState<Record<string, string>>({})
  const [accountCreateInstitutions, setAccountCreateInstitutions] = useState<Record<string, string>>({})
  const [selectedAccountRows, setSelectedAccountRows] = useState<Set<string>>(() => new Set())
  const [batchAccountType, setBatchAccountType] = useState('')
  const [batchAccountCurrency, setBatchAccountCurrency] = useState('')
  const [batchAccountInstitution, setBatchAccountInstitution] = useState('')
  const [merchantHandlingOpen, setMerchantHandlingOpen] = useState(true)
  const [tagHandlingOpen, setTagHandlingOpen] = useState(true)
  const [columnValidationErrors, setColumnValidationErrors] = useState<ColumnValidationErrors>({})
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({})
  const [categoryAutoMatchKey, setCategoryAutoMatchKey] = useState('')
  const [categoryCreateKinds, setCategoryCreateKinds] = useState<Record<string, ImportCategoryKind>>({})
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<TransactionImportResponse | null>(null)
  const [importOverlayPhase, setImportOverlayPhase] = useState<ImportOverlayPhase>('idle')
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts()
  const { data: currencies = [], isLoading: currenciesLoading } = useCurrencies()
  const { data: institutions = [], isLoading: institutionsLoading } = useInstitutions()
  const { data: categories, isLoading: categoriesLoading } = useCategories()
  const importTransactions = useImportTransactions()
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

  const headers = useMemo(
    () => getImportHeaders(files),
    [files],
  )

  const missingRequiredColumnLabels = useMemo(
    () => getMissingRequiredColumnLabels(columnMap),
    [columnMap],
  )

  const columnTargetOptions = useMemo(
    () => buildColumnTargetOptions(),
    [],
  )

  const accountMappingSources = useMemo(
    () => buildImportAccountMappingSources(files, columnMap.account_id),
    [columnMap.account_id, files],
  )

  const canInferAccountMappings = Boolean(accountAutoMatchKey)
    && accountAutoMatchKey === (columnMap.account_id || FILE_ACCOUNT_MATCH_KEY)

  const resolvedAccountMappings = useMemo(
    () => (
      canInferAccountMappings
        ? inferAccountMappings(accountMappingSources, accountMappings, selectableAccounts)
        : accountMappings
    ),
    [accountMappingSources, accountMappings, canInferAccountMappings, selectableAccounts],
  )

  const autoFilledAccountSources = useMemo(
    () => new Set(
      accountMappingSources
        .filter((source) => !accountMappings[source.id] && Boolean(resolvedAccountMappings[source.id]))
        .map((source) => source.id),
    ),
    [accountMappingSources, accountMappings, resolvedAccountMappings],
  )

  const importedCategories = useMemo(
    () => getImportedCategories(files, columnMap.category_id),
    [columnMap.category_id, files],
  )

  const importedMerchants = useMemo(
    () => getImportedMerchants(files, columnMap.merchant_id),
    [columnMap.merchant_id, files],
  )

  const categoryTypesBySource = useMemo(
    () => getImportedCategoryTypes(files, columnMap.category_id, columnMap.amount, importedCategories),
    [columnMap.amount, columnMap.category_id, files, importedCategories],
  )

  const importedTags = useMemo(
    () => getImportedTags(files, columnMap.tag_ids),
    [columnMap.tag_ids, files],
  )

  const canInferCategoryMappings = Boolean(columnMap.category_id)
    && categoryAutoMatchKey === columnMap.category_id

  const resolvedCategoryMappings = useMemo(
    () => (
      canInferCategoryMappings
        ? inferCategoryMappings(importedCategories, categoryMappings, categories ?? [], categoryTypesBySource)
        : keepCurrentMatchMap(categoryMappings, importedCategories)
    ),
    [canInferCategoryMappings, categories, categoryMappings, categoryTypesBySource, importedCategories],
  )

  const autoFilledCategories = useMemo(
    () => new Set(
      importedCategories.filter((category) => !categoryMappings[category] && Boolean(resolvedCategoryMappings[category])),
    ),
    [categoryMappings, importedCategories, resolvedCategoryMappings],
  )

  const previewRows = useMemo<PreviewTransactionRow[]>(
    () => buildImportPreviewRows({
      files,
      columnMap,
      missingRequiredColumnLabels,
      currencies,
      accountById,
      accountCreateCurrencies,
      accountCreateInstitutions,
      categoryById,
      categoryCreateKinds,
      categoryTypesBySource,
      institutionById,
      resolvedAccountMappings,
      resolvedCategoryMappings,
    }),
    [accountById, accountCreateCurrencies, accountCreateInstitutions, categoryById, categoryCreateKinds, categoryTypesBySource, columnMap, currencies, files, institutionById, missingRequiredColumnLabels, resolvedAccountMappings, resolvedCategoryMappings],
  )

  const previewGroups = useMemo(
    () => groupPreviewRowsByDate(previewRows),
    [previewRows],
  )
  const importBuild = useMemo(
    () => buildTransactionImportPayload({
      accountCreateCurrencies,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappings: resolvedAccountMappings,
      accountSources: accountMappingSources,
      categoryById,
      categoryCreateKinds,
      categoryMappings: resolvedCategoryMappings,
      categoryTypesBySource,
      columnMap,
      columnValidationErrors,
      files,
      importedCategories,
    }),
    [
      accountCreateCurrencies,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappingSources,
      categoryById,
      categoryCreateKinds,
      categoryTypesBySource,
      columnMap,
      columnValidationErrors,
      files,
      importedCategories,
      resolvedAccountMappings,
      resolvedCategoryMappings,
    ],
  )
  const totalRows = files.reduce((sum, file) => sum + file.rows.length, 0)
  const mappedFieldCount = headers.length === 0 ? 0 : Object.values(columnMap).filter(Boolean).length
  const importSummary = importResult ? formatImportSummary(importResult) : ''
  const importOverlayOpen = importOverlayPhase !== 'idle'
  const canCommitImport = Boolean(importBuild.payload) && !importOverlayOpen && !importTransactions.isPending && !importResult

  const syncAutoMatchKeys = (
    nextColumnMap: ColumnMap,
    nextColumnValidationErrors: ColumnValidationErrors,
    nextFiles: ImportFileDraft[],
  ) => {
    if (!isColumnMappingComplete(nextColumnMap, nextColumnValidationErrors, nextFiles)) {
      setAccountAutoMatchKey('')
      setCategoryAutoMatchKey('')
      return
    }

    setAccountAutoMatchKey(nextColumnMap.account_id || FILE_ACCOUNT_MATCH_KEY)
    setCategoryAutoMatchKey(nextColumnMap.category_id)
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const selectedFiles = Array.from(event.target.files ?? [])
    if (selectedFiles.length === 0) return

    setIsProcessingFiles(true)

    try {
      const [drafts] = await Promise.all([
        Promise.all(selectedFiles.map(readCsvFile)),
        waitForMilliseconds(CSV_PROCESSING_MIN_MS),
      ])
      const next = drafts.slice(0, 1)

      setFiles(next)
      setColumnMap((previous) => {
        const result = inferColumnMap(previous, next)
        setColumnValidationErrors(result.errors)
        setAutoFilledColumnHeaders((current) => getNextAutoFilledColumnHeaders(current, previous, result.map))
        syncAutoMatchKeys(result.map, result.errors, next)
        return result.map
      })
    } finally {
      setIsProcessingFiles(false)
      input.value = ''
    }
  }

  const removeFile = (fileId: string) => {
    setFiles((current) => {
      const next = current.filter((file) => file.id !== fileId)
      setColumnMap((previous) => {
        const result = inferColumnMap(previous, next)
        setColumnValidationErrors(result.errors)
        setAutoFilledColumnHeaders((current) => getNextAutoFilledColumnHeaders(current, previous, result.map))
        syncAutoMatchKeys(result.map, result.errors, next)
        return result.map
      })
      return next
    })
  }

  const updateSourceAccount = (sourceAccount: string, accountId: string) => {
    setAccountMappings((current) => ({ ...current, [sourceAccount]: accountId }))
    if (accountId !== CREATE_ACCOUNT_VALUE) {
      setAccountCreateTypes((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateCurrencies((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateInstitutions((current) => removeRecordKey(current, sourceAccount))
      setSelectedAccountRows((current) => removeSetValue(current, sourceAccount))
    }
  }

  const updateColumnTarget = (header: string, targetValue: string) => {
    const validation = targetValue
      ? validateColumnValues(files, header, targetValue as ColumnTarget)
      : { valid: true, message: '' }
    const previousAccountHeader = columnMap.account_id
    const previousCategoryHeader = columnMap.category_id
    const displacedHeader = targetValue ? columnMap[targetValue as ColumnTarget] : ''
    const nextColumnValidationErrors = getNextColumnValidationErrors(
      columnValidationErrors,
      header,
      displacedHeader,
      targetValue,
      validation,
    )
    const nextColumnMap = getNextColumnMap(columnMap, header, targetValue)
    const nextColumnMappingComplete = isColumnMappingComplete(nextColumnMap, nextColumnValidationErrors, files)

    setAutoFilledColumnHeaders((current) => {
      const next = new Set(current)
      next.delete(header)
      if (displacedHeader) next.delete(displacedHeader)
      return next
    })

    if (nextColumnMappingComplete) {
      syncAutoMatchKeys(nextColumnMap, nextColumnValidationErrors, files)
    } else {
      if (targetValue === 'account_id') {
        setAccountAutoMatchKey(header)
      } else if (previousAccountHeader === header) {
        setAccountAutoMatchKey('')
      }

      if (targetValue === 'category_id') {
        setCategoryAutoMatchKey(header)
      } else if (previousCategoryHeader === header) {
        setCategoryAutoMatchKey('')
      }
    }

    setColumnValidationErrors(nextColumnValidationErrors)
    setColumnMap(nextColumnMap)
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || importOverlayOpen || importTransactions.isPending) return

    setImportError(null)
    setImportResult(null)
    setImportOverlayPhase('importing')
    const minimumOverlay = waitForMilliseconds(IMPORT_OVERLAY_MIN_MS)

    try {
      const result = await importTransactions.mutateAsync(payload)
      await minimumOverlay
      setImportResult(result)
      setImportOverlayPhase('success')
    } catch (error) {
      await minimumOverlay
      setImportError(getErrorMessage(error))
      setImportOverlayPhase('error')
    }
  }

  const dismissImportOverlay = () => {
    if (importOverlayPhase !== 'error') return
    setImportOverlayPhase('idle')
  }

  const resetImportWorkflow = () => {
    setFiles([])
    setIsProcessingFiles(false)
    setAutoFilledColumnHeaders(new Set())
    setColumnMap(EMPTY_COLUMN_MAP)
    setAccountMappings({})
    setAccountAutoMatchKey('')
    setAccountCreateTypes({})
    setAccountCreateCurrencies({})
    setAccountCreateInstitutions({})
    setSelectedAccountRows(new Set())
    setBatchAccountType('')
    setBatchAccountCurrency('')
    setBatchAccountInstitution('')
    setMerchantHandlingOpen(true)
    setTagHandlingOpen(true)
    setColumnValidationErrors({})
    setCategoryMappings({})
    setCategoryAutoMatchKey('')
    setCategoryCreateKinds({})
    setImportError(null)
    setImportResult(null)
    setImportOverlayPhase('idle')
    importTransactions.reset()
    if (inputRef.current) inputRef.current.value = ''
  }

  return {
    inputRef,
    files,
    isProcessingFiles,
    autoFilledColumnHeaders,
    columnMap,
    accountMappings: resolvedAccountMappings,
    autoFilledAccountSources,
    accountCreateTypes,
    accountCreateCurrencies,
    accountCreateInstitutions,
    selectedAccountRows,
    batchAccountType,
    batchAccountCurrency,
    batchAccountInstitution,
    merchantHandlingOpen,
    tagHandlingOpen,
    columnValidationErrors,
    categoryMappings,
    categoryCreateKinds,
    importError,
    importResult,
    importOverlayPhase,
    importOverlayOpen,
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
    headers,
    missingRequiredColumnLabels,
    columnTargetOptions,
    accountMappingSources,
    importedCategories,
    importedMerchants,
    categoryTypesBySource,
    importedTags,
    resolvedCategoryMappings,
    autoFilledCategories,
    previewRows,
    previewGroups,
    importBuild,
    totalRows,
    mappedFieldCount,
    importSummary,
    canCommitImport,
    setAccountCreateTypes,
    setAccountCreateCurrencies,
    setAccountCreateInstitutions,
    setSelectedAccountRows,
    setBatchAccountType,
    setBatchAccountCurrency,
    setBatchAccountInstitution,
    setCategoryMappings,
    setCategoryCreateKinds,
    setMerchantHandlingOpen,
    setTagHandlingOpen,
    handleFileChange,
    removeFile,
    updateSourceAccount,
    updateColumnTarget,
    handleCommitImport,
    dismissImportOverlay,
    resetImportWorkflow,
  }
}

export type TransactionImportWorkflow = ReturnType<typeof useTransactionImportWorkflow>
