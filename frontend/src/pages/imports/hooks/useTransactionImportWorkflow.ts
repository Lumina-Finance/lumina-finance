import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useImportTransactions, type TransactionImportResponse } from '@/api/transaction-imports'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_LABEL, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, ImportCategoryKind, ImportFileDraft, ImportOverlayPhase, PreviewTransactionRow } from '@/pages/imports/types'
import {
  buildColumnTargetOptions,
  buildImportAccountMappingSources,
  buildTransactionImportPayload,
  buildImportPreviewRows,
  formatImportSummary,
  getErrorMessage,
  getImportedCategoryTypes,
  getImportedCategories,
  getImportedMerchants,
  getImportedTags,
  getImportHeaders,
  getColumnValues,
  getMissingRequiredColumnLabels,
  getNextAutoFilledColumnHeaders,
  getNextColumnMap,
  getNextColumnValidationErrors,
  inferAccountMappings,
  inferCategoryMappings,
  isColumnMappingComplete,
  groupPreviewRowsByDate,
  inferColumnMap,
  type ImportDateFormat,
  keepCurrentMatchMap,
  readCsvFile,
  scanImportDateFormats,
  validateColumnValues,
} from '@/pages/imports/utils'
import { waitForMilliseconds } from '@/utils/timing'
import { useImportAccountCreateState } from './useImportAccountCreateState'
import { useImportReferenceData } from './useImportReferenceData'

/**
 * A date format the user picked, tagged with the column and files it was picked for
 */
interface DateFormatChoice {
  scope: string
  format: ImportDateFormat
}

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
    updateAccountMapping: updateSourceAccount,
  } = useImportAccountCreateState(setAccountMappings)
  const [merchantHandlingOpen, setMerchantHandlingOpen] = useState(true)
  const [tagHandlingOpen, setTagHandlingOpen] = useState(true)
  const [columnValidationErrors, setColumnValidationErrors] = useState<ColumnValidationErrors>({})
  const [dateFormatChoice, setDateFormatChoice] = useState<DateFormatChoice | null>(null)
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({})
  const [categoryAutoMatchKey, setCategoryAutoMatchKey] = useState('')
  const [categoryCreateKinds, setCategoryCreateKinds] = useState<Record<string, ImportCategoryKind>>({})
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<TransactionImportResponse | null>(null)
  const [importOverlayPhase, setImportOverlayPhase] = useState<ImportOverlayPhase>('idle')
  const importTransactions = useImportTransactions()
  const {
    currencies,
    categories,
    accountsLoading,
    currenciesLoading,
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

  const dateFormatScan = useMemo(
    () => scanImportDateFormats(columnMap.dt ? getColumnValues(files, columnMap.dt) : []),
    [columnMap.dt, files],
  )

  // Names what the scan was run against, so a format chosen for one column and set of files is
  // dropped rather than carried onto another
  const dateFormatScope = `${columnMap.dt}:${files.map((file) => file.id).join(',')}`

  // The user's answer while it still applies, otherwise the only format the column can be read in.
  // More than one survivor leaves it unanswered, because choosing between them is exactly the guess
  // this path exists to remove
  const dateFormat = dateFormatChoice?.scope === dateFormatScope
    ? dateFormatChoice.format
    : (dateFormatScan.readable.length === 1 ? dateFormatScan.readable[0] : null)

  // The date column answers to a choice made outside the mapping table, so its error is worked out
  // on every render rather than kept in the stored map, which only refreshes when a mapping changes
  const dateColumnValidation = useMemo(
    () => (columnMap.dt ? validateColumnValues(files, columnMap.dt, 'dt', dateFormat) : null),
    [columnMap.dt, dateFormat, files],
  )

  const resolvedColumnValidationErrors = useMemo(() => {
    if (!columnMap.dt || !dateColumnValidation) return columnValidationErrors

    const next = { ...columnValidationErrors }
    if (dateColumnValidation.valid) delete next[columnMap.dt]
    else next[columnMap.dt] = dateColumnValidation.message

    return next
  }, [columnMap.dt, columnValidationErrors, dateColumnValidation])

  const setDateFormat = (format: ImportDateFormat) => {
    setDateFormatChoice({ scope: dateFormatScope, format })
  }

  const accountMappingSources = useMemo(
    () => buildImportAccountMappingSources(files, columnMap.account_id, columnMap.counterparty_account_id),
    [columnMap.account_id, columnMap.counterparty_account_id, files],
  )

  // Only a source no row is written to can answer that the money left the tracked accounts, so the
  // extra choice is kept off every other row's dropdown
  const counterpartyAccountOptions = useMemo(
    () => [
      { value: OUTSIDE_ACCOUNT_VALUE, label: OUTSIDE_ACCOUNT_LABEL, group: 'Import Action' },
      ...accountOptions,
    ],
    [accountOptions],
  )

  const canInferAccountMappings = Boolean(accountAutoMatchKey)
    && accountAutoMatchKey === (columnMap.account_id || FILE_ACCOUNT_MATCH_KEY)

  const resolvedAccountMappings = useMemo(
    () => {
      const resolved = canInferAccountMappings
        ? inferAccountMappings(accountMappingSources, accountMappings, selectableAccounts)
        : { ...accountMappings }

      // No row is written to these, so the import creates nothing for them unless the user asks for
      // an account by hand, and the transfers pointing at them say the money left the app
      for (const source of accountMappingSources) {
        if (source.isCounterpartyOnly && !resolved[source.id]) resolved[source.id] = OUTSIDE_ACCOUNT_VALUE
      }
      return resolved
    },
    [accountMappingSources, accountMappings, canInferAccountMappings, selectableAccounts],
  )

  // The highlight says a choice was matched from the file. The outside answer on a counterparty
  // source is a default rather than a match, so it is left plain
  const autoFilledAccountSources = useMemo(
    () => new Set(
      accountMappingSources
        .filter((source) => {
          if (accountMappings[source.id]) return false
          const resolved = resolvedAccountMappings[source.id]
          if (!resolved) return false
          return !(source.isCounterpartyOnly && resolved === OUTSIDE_ACCOUNT_VALUE)
        })
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
      dateFormat,
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
    [accountById, accountCreateCurrencies, accountCreateInstitutions, categoryById, categoryCreateKinds, categoryTypesBySource, columnMap, currencies, dateFormat, files, institutionById, missingRequiredColumnLabels, resolvedAccountMappings, resolvedCategoryMappings],
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
      columnValidationErrors: resolvedColumnValidationErrors,
      dateFormat,
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
      dateFormat,
      files,
      importedCategories,
      resolvedAccountMappings,
      resolvedCategoryMappings,
      resolvedColumnValidationErrors,
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
    setDateFormatChoice(null)
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
    columnValidationErrors: resolvedColumnValidationErrors,
    dateFormat,
    dateFormatScan,
    setDateFormat,
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
    counterpartyAccountOptions,
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
