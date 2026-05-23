import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useCategories } from '@/api/categories'
import { useAccounts } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useInstitutions } from '@/api/institutions'
import { useImportTransactions, type TransactionImportResponse } from '@/api/transactions'
import type { DropdownOption } from '@/components/Dropdown'
import {
  ACCOUNT_KIND_LABELS,
  COLUMN_TARGETS,
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  EMPTY_COLUMN_MAP,
  KIND_LABELS,
} from '../constants'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, ImportAccountSource, ImportCategoryKind, ImportFileDraft, ImportOverlayPhase, PreviewTransactionRow } from '../types'
import {
  buildTransactionImportPayload,
  formatImportSummary,
  getErrorMessage,
  getImportAccountName,
  getImportedCategoryTypes,
  getMappedValue,
  getPreviewCategory,
  getPreviewCurrency,
  getPreviewDateLabel,
  inferAccountMappings,
  inferCategoryMappings,
  getResolvedAccountChoice,
  getResolvedAccountCreateCurrency,
  getResolvedAccountCreateInstitution,
  groupPreviewRowsByDate,
  inferColumnMap,
  keepCurrentMatchMap,
  normalizeImportDate,
  parseImportNumber,
  readCsvFile,
  removeRecordKey,
  removeSetValue,
  splitImportedValues,
  toMinorUnits,
  unique,
  validateColumnValues,
} from '../utils'

const FILE_ACCOUNT_MATCH_KEY = '__file_account__'
const CSV_PROCESSING_MIN_MS = 1500
const IMPORT_OVERLAY_MIN_MS = 2000

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

  const accountOptions = useMemo<DropdownOption[]>(
    () => [
      { value: CREATE_ACCOUNT_VALUE, label: 'Create New Account', group: 'Import Action' },
      ...accounts.map((account) => ({
        value: account.id,
        label: account.name,
        group: ACCOUNT_KIND_LABELS[account.account_kind],
      })),
    ],
    [accounts],
  )

  const currencyOptions = useMemo<DropdownOption[]>(
    () =>
      currencies.map((currency) => ({
        value: currency.id,
        label: currency.id,
      })),
    [currencies],
  )

  const institutionOptions = useMemo<DropdownOption[]>(
    () => [
      { value: '', label: 'None' },
      ...institutions.map((institution) => ({
        value: institution.id,
        label: institution.name,
      })),
    ],
    [institutions],
  )

  const categoryMatchOptions = useMemo<DropdownOption[]>(
    () => [
      {
        value: CREATE_CATEGORY_VALUE,
        label: 'Create new category',
        group: 'Import action',
      },
      ...(categories ?? [])
        .slice()
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
        .map((category) => ({
          value: category.id,
          label: category.name,
          group: KIND_LABELS[category.kind],
          icon: category.icon ?? DEFAULT_CATEGORY_ICON,
        })),
    ],
    [categories],
  )

  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
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
    () => unique(files.flatMap((file) => file.headers)),
    [files],
  )

  const missingRequiredColumnLabels = useMemo(
    () =>
      COLUMN_TARGETS
        .filter((target) => target.required && !columnMap[target.id])
        .map((target) => target.label),
    [columnMap],
  )

  const columnTargetOptions = useMemo<DropdownOption[]>(
    () => [
      { value: '', label: 'Do not import' },
      ...COLUMN_TARGETS.map((target) => ({
        value: target.id,
        label: target.label,
        group: target.required ? 'Required fields' : 'Optional fields',
      })),
    ],
    [],
  )

  const sourceAccounts = useMemo(() => {
    if (!columnMap.account_id) return []
    return unique(
      files.flatMap((file) =>
        file.rows.map((row) => row[columnMap.account_id]?.trim()).filter(Boolean),
      ),
    )
  }, [columnMap.account_id, files])

  const accountMappingSources = useMemo<ImportAccountSource[]>(
    () => {
      if (columnMap.account_id) {
        return sourceAccounts.map((source) => ({
          id: source,
          label: source,
          matchText: source,
        }))
      }

      return files.map((file) => ({
        id: file.id,
        label: getImportAccountName(file.name),
        matchText: file.name,
      }))
    },
    [columnMap.account_id, files, sourceAccounts],
  )

  const canInferAccountMappings = Boolean(accountAutoMatchKey)
    && accountAutoMatchKey === (columnMap.account_id || FILE_ACCOUNT_MATCH_KEY)

  const resolvedAccountMappings = useMemo(
    () => (
      canInferAccountMappings
        ? inferAccountMappings(accountMappingSources, accountMappings, accounts)
        : accountMappings
    ),
    [accountMappingSources, accountMappings, accounts, canInferAccountMappings],
  )

  const autoFilledAccountSources = useMemo(
    () => new Set(
      accountMappingSources
        .filter((source) => !accountMappings[source.id] && Boolean(resolvedAccountMappings[source.id]))
        .map((source) => source.id),
    ),
    [accountMappingSources, accountMappings, resolvedAccountMappings],
  )

  const importedCategories = useMemo(() => {
    if (!columnMap.category_id) return []
    return unique(
      files.flatMap((file) =>
        file.rows.map((row) => row[columnMap.category_id]?.trim()).filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b))
  }, [columnMap.category_id, files])

  const importedMerchants = useMemo(() => {
    if (!columnMap.merchant_id) return []
    return unique(
      files.flatMap((file) =>
        file.rows.map((row) => row[columnMap.merchant_id]?.trim()).filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b))
  }, [columnMap.merchant_id, files])

  const categoryTypesBySource = useMemo(
    () => getImportedCategoryTypes(files, columnMap.category_id, columnMap.amount, importedCategories),
    [columnMap.amount, columnMap.category_id, files, importedCategories],
  )

  const importedTags = useMemo(() => {
    if (!columnMap.tag_ids) return []
    return unique(
      files.flatMap((file) =>
        file.rows.flatMap((row) => splitImportedValues(row[columnMap.tag_ids] ?? '')),
      ),
    ).sort((a, b) => a.localeCompare(b))
  }, [columnMap.tag_ids, files])

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

  const previewRows = useMemo<PreviewTransactionRow[]>(() => {
    if (missingRequiredColumnLabels.length > 0) return []

    const rows: PreviewTransactionRow[] = []
    const fallbackCurrency = currencies.some((currency) => currency.id === 'CAD') ? 'CAD' : currencies[0]?.id ?? 'CAD'
    const timestamp = new Date().toISOString()

    for (const file of files) {
      for (let rowIndex = 0; rowIndex < file.rows.length; rowIndex += 1) {
        const row = file.rows[rowIndex]
        const accountSource = columnMap.account_id ? getMappedValue(row, columnMap.account_id) : file.id
        const accountLabel = columnMap.account_id ? accountSource : getImportAccountName(file.name)
        const accountChoice = getResolvedAccountChoice(resolvedAccountMappings[accountSource])
        const account = accountChoice === CREATE_ACCOUNT_VALUE ? undefined : accountById.get(accountChoice)
        const createAccountCurrency = accountChoice === CREATE_ACCOUNT_VALUE
          ? getResolvedAccountCreateCurrency(accountSource, accountCreateCurrencies)
          : ''
        const createAccountInstitution = accountChoice === CREATE_ACCOUNT_VALUE
          ? institutionById.get(getResolvedAccountCreateInstitution(accountSource, accountCreateInstitutions))
          : undefined
        const importedDate = getMappedValue(row, columnMap.dt)
        const dt = normalizeImportDate(importedDate)
        const merchant = getMappedValue(row, columnMap.merchant_id)
        const notes = getMappedValue(row, columnMap.notes)
        const currency = getPreviewCurrency(
          getMappedValue(row, columnMap.currency),
          account?.currency,
          createAccountCurrency,
          fallbackCurrency,
        )
        const amountValue = parseImportNumber(getMappedValue(row, columnMap.amount)) ?? 0
        const amount = toMinorUnits(amountValue, currency)
        const importedCategory = getMappedValue(row, columnMap.category_id)
        const importedTagValues = splitImportedValues(getMappedValue(row, columnMap.tag_ids))
        const category = getPreviewCategory(
          importedCategory,
          resolvedCategoryMappings,
          categoryById,
          categoryCreateKinds,
          categoryTypesBySource,
          amountValue,
        )
        const tagIds = importedTagValues.map((tag, tagIndex) => `${file.id}-${rowIndex}-tag-${tagIndex}-${tag}`)

        rows.push({
          id: `${file.id}-${rowIndex}`,
          accountInstitution: account?.institution ?? createAccountInstitution ?? null,
          accountName: account?.name ?? (accountLabel || 'Unmapped account'),
          category,
          currency,
          dateLabel: getPreviewDateLabel(dt),
          transaction: {
            id: `import-preview-${file.id}-${rowIndex}`,
            created_by_user_id: 'import-preview',
            account_id: account?.id ?? accountChoice,
            dt,
            merchant_id: merchant ? `import-preview-merchant-${file.id}-${rowIndex}` : null,
            merchant_name: merchant || null,
            category_id: category?.id ?? '',
            amount,
            currency,
            fx_rate: null,
            notes: notes || null,
            created_at: timestamp,
            updated_at: timestamp,
            tag_ids: tagIds,
            tags: importedTagValues.map((tag, tagIndex) => ({
              id: tagIds[tagIndex],
              group_id: null,
              name: tag,
            })),
          },
        })

        if (rows.length >= 5) return rows
      }
    }

    return rows
  }, [accountById, accountCreateCurrencies, accountCreateInstitutions, categoryById, categoryCreateKinds, categoryTypesBySource, columnMap, currencies, files, institutionById, missingRequiredColumnLabels, resolvedAccountMappings, resolvedCategoryMappings])

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
        sleep(CSV_PROCESSING_MIN_MS),
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
    const minimumOverlay = sleep(IMPORT_OVERLAY_MIN_MS)

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

function getNextColumnMap(columnMap: ColumnMap, header: string, targetValue: string) {
  const next = { ...columnMap }

  for (const target of COLUMN_TARGETS) {
    if (next[target.id] === header) next[target.id] = ''
  }
  if (targetValue) next[targetValue as ColumnTarget] = header

  return next
}

function getNextAutoFilledColumnHeaders(
  current: Set<string>,
  previousColumnMap: ColumnMap,
  nextColumnMap: ColumnMap,
) {
  const mappedHeaders = new Set(Object.values(nextColumnMap).filter(Boolean))
  const next = new Set([...current].filter((header) => mappedHeaders.has(header)))

  for (const target of COLUMN_TARGETS) {
    const header = nextColumnMap[target.id]
    if (header && previousColumnMap[target.id] !== header) next.add(header)
  }

  return next
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function getNextColumnValidationErrors(
  columnValidationErrors: ColumnValidationErrors,
  header: string,
  displacedHeader: string,
  targetValue: string,
  validation: { valid: boolean; message: string },
) {
  if (!targetValue) return removeRecordKey(columnValidationErrors, header)

  let next = displacedHeader && displacedHeader !== header
    ? removeRecordKey(columnValidationErrors, displacedHeader)
    : columnValidationErrors

  next = validation.valid
    ? removeRecordKey(next, header)
    : { ...next, [header]: validation.message }

  return next
}

function isColumnMappingComplete(
  columnMap: ColumnMap,
  columnValidationErrors: ColumnValidationErrors,
  files: ImportFileDraft[],
) {
  if (files.length === 0) return false

  const missingRequired = COLUMN_TARGETS.some(
    (target) => target.required && !columnMap[target.id],
  )
  if (missingRequired) return false

  const mappedHeaders = new Set(Object.values(columnMap).filter(Boolean))
  return !Object.keys(columnValidationErrors).some((header) => mappedHeaders.has(header))
}
