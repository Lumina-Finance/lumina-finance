import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useCategories } from '@/api/categories'
import { useAccounts } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useImportTransactions, type TransactionImportResponse } from '@/api/transactions'
import type { DropdownOption } from '@/components/Dropdown'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import {
  ACCOUNT_KIND_LABELS,
  COLUMN_TARGETS,
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  EMPTY_COLUMN_MAP,
  KIND_LABELS,
} from '../constants'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, ImportCategoryKind, ImportFileDraft, ImportMode, PreviewTransactionRow } from '../types'
import {
  buildTransactionImportPayload,
  formatImportSummary,
  getErrorMessage,
  getImportedCategoryTypes,
  getMappedValue,
  getPreviewCategory,
  getPreviewCurrency,
  getPreviewDateLabel,
  getResolvedAccountChoice,
  getResolvedAccountCreateCurrency,
  groupPreviewRowsByDate,
  keepCurrentMatchMap,
  normalizeImportDate,
  parseImportNumber,
  readCsvFile,
  removeRecordKey,
  removeSetValue,
  splitImportedValues,
  toMinorUnits,
  unique,
  validateColumnMap,
  validateColumnValues,
} from '../utils'

export function useTransactionImportWorkflow() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ImportMode>('single-file')
  const [files, setFiles] = useState<ImportFileDraft[]>([])
  const [columnMap, setColumnMap] = useState<ColumnMap>(EMPTY_COLUMN_MAP)
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const [accountCreateTypes, setAccountCreateTypes] = useState<Record<string, string>>({})
  const [accountCreateCurrencies, setAccountCreateCurrencies] = useState<Record<string, string>>({})
  const [selectedAccountRows, setSelectedAccountRows] = useState<Set<string>>(() => new Set())
  const [batchAccountType, setBatchAccountType] = useState('')
  const [batchAccountCurrency, setBatchAccountCurrency] = useState('')
  const [merchantHandlingOpen, setMerchantHandlingOpen] = useState(true)
  const [tagHandlingOpen, setTagHandlingOpen] = useState(true)
  const [columnValidationErrors, setColumnValidationErrors] = useState<ColumnValidationErrors>({})
  const [categoryMappings, setCategoryMappings] = useState<Record<string, string>>({})
  const [categoryCreateKinds, setCategoryCreateKinds] = useState<Record<string, ImportCategoryKind>>({})
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<TransactionImportResponse | null>(null)
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts()
  const { data: currencies = [], isLoading: currenciesLoading } = useCurrencies()
  const { data: categories, isLoading: categoriesLoading } = useCategories()
  const importTransactions = useImportTransactions()
  const importFeedback = useActionFeedback()

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

  const headers = useMemo(
    () => unique(files.flatMap((file) => file.headers)),
    [files],
  )

  const availableColumnTargets = useMemo(
    () => COLUMN_TARGETS.filter((target) => !target.mode || target.mode === mode),
    [mode],
  )

  const missingRequiredColumnLabels = useMemo(
    () =>
      availableColumnTargets
        .filter((target) => target.required && !columnMap[target.id])
        .map((target) => target.label),
    [availableColumnTargets, columnMap],
  )

  const columnTargetOptions = useMemo<DropdownOption[]>(
    () => [
      { value: '', label: 'Do not import' },
      ...availableColumnTargets.map((target) => ({
        value: target.id,
        label: target.label,
        group: target.required ? 'Required fields' : 'Optional fields',
      })),
    ],
    [availableColumnTargets],
  )

  const sourceAccounts = useMemo(() => {
    if (mode !== 'single-file' || !columnMap.account_id) return []
    return unique(
      files.flatMap((file) =>
        file.rows.map((row) => row[columnMap.account_id]?.trim()).filter(Boolean),
      ),
    )
  }, [columnMap.account_id, files, mode])

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

  const resolvedCategoryMappings = useMemo(
    () => keepCurrentMatchMap(categoryMappings, importedCategories),
    [categoryMappings, importedCategories],
  )

  const previewRows = useMemo<PreviewTransactionRow[]>(() => {
    if (missingRequiredColumnLabels.length > 0) return []

    const rows: PreviewTransactionRow[] = []
    const fallbackCurrency = currencies.some((currency) => currency.id === 'CAD') ? 'CAD' : currencies[0]?.id ?? 'CAD'
    const timestamp = new Date().toISOString()

    for (const file of files) {
      for (let rowIndex = 0; rowIndex < file.rows.length; rowIndex += 1) {
        const row = file.rows[rowIndex]
        const sourceAccount = mode === 'single-file'
          ? getMappedValue(row, columnMap.account_id)
          : file.name
        const accountKey = mode === 'single-file' ? sourceAccount : file.id
        const accountChoice = mode === 'single-file'
          ? getResolvedAccountChoice(accountMappings[sourceAccount])
          : getResolvedAccountChoice(file.accountId)
        const account = accountChoice === CREATE_ACCOUNT_VALUE ? undefined : accountById.get(accountChoice)
        const createAccountCurrency = accountChoice === CREATE_ACCOUNT_VALUE
          ? getResolvedAccountCreateCurrency(accountKey, accountCreateCurrencies)
          : ''
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
          accountInstitution: account?.institution ?? null,
          accountName: account?.name ?? (sourceAccount || file.name || 'Unmapped account'),
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
  }, [accountById, accountCreateCurrencies, accountMappings, categoryById, categoryCreateKinds, categoryTypesBySource, columnMap, currencies, files, missingRequiredColumnLabels, mode, resolvedCategoryMappings])

  const previewGroups = useMemo(
    () => groupPreviewRowsByDate(previewRows),
    [previewRows],
  )
  const importBuild = useMemo(
    () => buildTransactionImportPayload({
      accountCreateCurrencies,
      accountCreateTypes,
      accountMappings,
      categoryById,
      categoryCreateKinds,
      categoryMappings: resolvedCategoryMappings,
      categoryTypesBySource,
      columnMap,
      columnValidationErrors,
      files,
      importedCategories,
      mode,
      sourceAccounts,
    }),
    [
      accountCreateCurrencies,
      accountCreateTypes,
      accountMappings,
      categoryById,
      categoryCreateKinds,
      categoryTypesBySource,
      columnMap,
      columnValidationErrors,
      files,
      importedCategories,
      mode,
      resolvedCategoryMappings,
      sourceAccounts,
    ],
  )
  const totalRows = files.reduce((sum, file) => sum + file.rows.length, 0)
  const mappedFieldCount = headers.length === 0 ? 0 : Object.values(columnMap).filter(Boolean).length
  const importSummary = importResult ? formatImportSummary(importResult) : ''
  const canCommitImport = Boolean(importBuild.payload) && !importFeedback.isPending && !importTransactions.isPending && !importResult

  const handleModeChange = (nextMode: ImportMode) => {
    setMode(nextMode)
    setAccountMappings({})
    setAccountCreateTypes({})
    setAccountCreateCurrencies({})
    setSelectedAccountRows(new Set())
    setBatchAccountType('')
    setBatchAccountCurrency('')
    setFiles((current) => (nextMode === 'single-file' ? current.slice(0, 1) : current))
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    const drafts = await Promise.all(selectedFiles.map(readCsvFile))
    const next = mode === 'single-file' ? drafts.slice(0, 1) : [...files, ...drafts]

    setFiles(next)
    setColumnMap((previous) => {
      const result = validateColumnMap(previous, next)
      setColumnValidationErrors(result.errors)
      return result.map
    })

    event.target.value = ''
  }

  const removeFile = (fileId: string) => {
    setFiles((current) => {
      const next = current.filter((file) => file.id !== fileId)
      setColumnMap((previous) => {
        const result = validateColumnMap(previous, next)
        setColumnValidationErrors(result.errors)
        return result.map
      })
      return next
    })
    setAccountCreateTypes((current) => removeRecordKey(current, fileId))
    setAccountCreateCurrencies((current) => removeRecordKey(current, fileId))
    setSelectedAccountRows((current) => removeSetValue(current, fileId))
  }

  const updateFileAccount = (fileId: string, accountId: string) => {
    setFiles((current) =>
      current.map((file) => (file.id === fileId ? { ...file, accountId } : file)),
    )
    if (accountId !== CREATE_ACCOUNT_VALUE) {
      setAccountCreateTypes((current) => removeRecordKey(current, fileId))
      setAccountCreateCurrencies((current) => removeRecordKey(current, fileId))
      setSelectedAccountRows((current) => removeSetValue(current, fileId))
    }
  }

  const updateSourceAccount = (sourceAccount: string, accountId: string) => {
    setAccountMappings((current) => ({ ...current, [sourceAccount]: accountId }))
    if (accountId !== CREATE_ACCOUNT_VALUE) {
      setAccountCreateTypes((current) => removeRecordKey(current, sourceAccount))
      setAccountCreateCurrencies((current) => removeRecordKey(current, sourceAccount))
      setSelectedAccountRows((current) => removeSetValue(current, sourceAccount))
    }
  }

  const updateColumnTarget = (header: string, targetValue: string) => {
    const validation = targetValue
      ? validateColumnValues(files, header, targetValue as ColumnTarget)
      : { valid: true, message: '' }
    const displacedHeader = targetValue ? columnMap[targetValue as ColumnTarget] : ''

    if (targetValue) {
      setColumnValidationErrors((current) => {
        let next = displacedHeader && displacedHeader !== header
          ? removeRecordKey(current, displacedHeader)
          : current

        next = validation.valid
          ? removeRecordKey(next, header)
          : { ...next, [header]: validation.message }

        return next
      })
    } else {
      setColumnValidationErrors((current) => removeRecordKey(current, header))
    }

    setColumnMap((current) => {
      const next = { ...current }

      for (const target of COLUMN_TARGETS) {
        if (next[target.id] === header) next[target.id] = ''
      }
      if (targetValue) next[targetValue as ColumnTarget] = header

      return next
    })
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || importFeedback.isPending || importTransactions.isPending) return

    setImportError(null)
    setImportResult(null)

    try {
      const result = await importFeedback.run(() => importTransactions.mutateAsync(payload))
      setImportResult(result)
    } catch (error) {
      setImportError(getErrorMessage(error))
    }
  }

  return {
    inputRef,
    mode,
    files,
    columnMap,
    accountMappings,
    accountCreateTypes,
    accountCreateCurrencies,
    selectedAccountRows,
    batchAccountType,
    batchAccountCurrency,
    merchantHandlingOpen,
    tagHandlingOpen,
    columnValidationErrors,
    categoryMappings,
    categoryCreateKinds,
    importError,
    importResult,
    accountsLoading,
    currenciesLoading,
    categoriesLoading,
    importFeedback,
    accountOptions,
    currencyOptions,
    categoryMatchOptions,
    accountById,
    categoryById,
    headers,
    availableColumnTargets,
    missingRequiredColumnLabels,
    columnTargetOptions,
    sourceAccounts,
    importedCategories,
    importedMerchants,
    categoryTypesBySource,
    importedTags,
    resolvedCategoryMappings,
    previewRows,
    previewGroups,
    importBuild,
    totalRows,
    mappedFieldCount,
    importSummary,
    canCommitImport,
    setAccountCreateTypes,
    setAccountCreateCurrencies,
    setSelectedAccountRows,
    setBatchAccountType,
    setBatchAccountCurrency,
    setCategoryMappings,
    setCategoryCreateKinds,
    setMerchantHandlingOpen,
    setTagHandlingOpen,
    handleModeChange,
    handleFileChange,
    removeFile,
    updateFileAccount,
    updateSourceAccount,
    updateColumnTarget,
    handleCommitImport,
  }
}

export type TransactionImportWorkflow = ReturnType<typeof useTransactionImportWorkflow>
