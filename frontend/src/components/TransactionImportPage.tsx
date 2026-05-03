import { useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import {
  Check,
  ChevronDown,
  FileText,
  Info,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react'
import { useCategories, type Category } from '@/api/categories'
import { useAccounts, type AccountsOverview } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import Dropdown, { type DropdownOption } from '@/components/Dropdown'
import TransactionRow from '@/components/TransactionRow'

type ImportMode = 'single-file' | 'file-per-account'
type ColumnTarget =
  | 'account_id'
  | 'dt'
  | 'category_id'
  | 'amount'
  | 'currency'
  | 'merchant_id'
  | 'notes'
  | 'tag_ids'

type ColumnMap = Record<ColumnTarget, string>
type ColumnValidationErrors = Record<string, string>
type CsvRow = Record<string, string>
type ImportCategoryKind = Category['kind']

interface ImportFileDraft {
  id: string
  name: string
  size: number
  headers: string[]
  rows: CsvRow[]
  error: string | null
  accountId: string
}

interface PreviewTransactionRow {
  id: string
  accountInstitution: AccountsOverview['institution']
  accountName: string
  category: Category | undefined
  currency: string
  dateLabel: string
  transaction: Transaction
}

const EMPTY_COLUMN_MAP: ColumnMap = {
  account_id: '',
  dt: '',
  category_id: '',
  amount: '',
  currency: '',
  merchant_id: '',
  notes: '',
  tag_ids: '',
}

const COLUMN_TARGETS: Array<{
  id: ColumnTarget
  label: string
  hint: string
  required?: boolean
  mode?: ImportMode
}> = [
  { id: 'account_id', label: 'Account', hint: 'Resolved from the source account.', required: true, mode: 'single-file' },
  { id: 'dt', label: 'Date', hint: 'Transaction date.', required: true },
  { id: 'category_id', label: 'Category', hint: 'Resolved from imported category text.', required: true },
  { id: 'amount', label: 'Amount', hint: 'Raw signed amount.', required: true },
  { id: 'currency', label: 'Currency', hint: 'ISO currency code.' },
  { id: 'merchant_id', label: 'Merchant', hint: 'Resolved from imported merchant text.' },
  { id: 'notes', label: 'Notes', hint: 'Optional transaction notes.' },
  { id: 'tag_ids', label: 'Tags', hint: 'Resolved from imported tag text.' },
]

const COLUMN_VALIDATION_RULES: Record<ColumnTarget, {
  expected: string
  requiredValues?: boolean
  accepts: (value: string) => boolean
}> = {
  account_id: {
    expected: 'account names or source account labels; every row must have a value',
    requiredValues: true,
    accepts: isPlainTextValue,
  },
  dt: {
    expected: 'a valid date such as 2026-04-30 or 04/30/2026; every row must have a value',
    requiredValues: true,
    accepts: isValidDateValue,
  },
  category_id: {
    expected: 'category names as plain text',
    accepts: isPlainTextValue,
  },
  amount: {
    expected: 'a raw signed number such as -12.34 or 1,234.56; every row must have a value',
    requiredValues: true,
    accepts: isValidAmountValue,
  },
  currency: {
    expected: '3-letter ISO currency codes such as CAD or USD',
    accepts: isValidCurrencyCode,
  },
  merchant_id: {
    expected: 'merchant or payee names as plain text',
    accepts: isPlainTextValue,
  },
  notes: {
    expected: 'plain text notes',
    accepts: isPlainTextValue,
  },
  tag_ids: {
    expected: 'tag names separated by commas, semicolons, or pipes',
    accepts: isPlainTextValue,
  },
}

const KIND_LABELS: Record<Category['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

const DEFAULT_CATEGORY_ICON = '🏷️'
const CREATE_ACCOUNT_VALUE = '__create_account__'
const CREATE_CATEGORY_VALUE = '__create_category__'
const IMPORT_CATEGORY_KIND_OPTIONS: Array<{ value: ImportCategoryKind; label: string }> = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

const ACCOUNT_KIND_LABELS: Record<AccountsOverview['account_kind'], string> = {
  asset: 'Assets',
  revolving: 'Revolving Credit',
  amortizing: 'Amortizing Debt',
}

const ACCOUNT_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Revolving Credit' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Revolving Credit' },
  { value: 'heloc', label: 'HELOC', group: 'Revolving Credit' },
  { value: 'loan', label: 'Loan', group: 'Amortizing Debt' },
  { value: 'mortgage', label: 'Mortgage', group: 'Amortizing Debt' },
]

const IMPORT_INSET_STYLE: CSSProperties = {
  background: 'color-mix(in srgb, var(--app-input-bg) 58%, var(--app-bg))',
}

export default function TransactionImportPage() {
  const navigate = useNavigate()
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
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts()
  const { data: currencies = [], isLoading: currenciesLoading } = useCurrencies()
  const { data: categories, isLoading: categoriesLoading } = useCategories()

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
  const totalRows = files.reduce((sum, file) => sum + file.rows.length, 0)
  const mappedFieldCount = headers.length === 0 ? 0 : Object.values(columnMap).filter(Boolean).length

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

  return (
    <div
      className="flex h-screen min-h-screen overflow-hidden"
      style={{ background: 'var(--app-bg)', color: 'var(--app-text)' }}
    >
      <div
        className="hidden w-16 shrink-0 flex-col items-center justify-between py-7 sm:flex"
        style={{
          background: 'var(--app-button-primary-bg)',
          color: 'var(--app-button-primary-text)',
        }}
        aria-hidden
      >
        <Upload size={19} strokeWidth={2} />
        <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
          Import
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 px-5 pb-5 pt-6 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                CSV import
              </p>
              <h1 className="font-serif text-3xl font-light">
                Import Transactions
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
                Stage CSV transaction files before they are added to your ledger.
              </p>
            </div>

            <div className="flex shrink-0 items-start">
              <button
                type="button"
                className="app-icon-button shrink-0"
                onClick={() => navigate('/settings')}
                aria-label="Close import workflow"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3 sm:px-8 xl:overflow-hidden">
          <div className="flex min-h-full flex-col gap-8 xl:h-full xl:min-h-0 xl:flex-row">
            <aside className="xl:h-full xl:w-[340px] xl:shrink-0">
              <ImportStep
                index="01"
                title="Files"
                description="Choose how the import is shaped."
                className="xl:h-full"
                contentClassName="flex min-h-0 flex-col gap-3"
              >
                <div className="app-segmented-control w-full">
                  <button
                    type="button"
                    className={`app-segmented-option flex-1 text-sm ${mode === 'single-file' ? 'app-segmented-option-active' : ''}`}
                    onClick={() => handleModeChange('single-file')}
                  >
                    Single file
                  </button>
                  <button
                    type="button"
                    className={`app-segmented-option flex-1 text-sm ${mode === 'file-per-account' ? 'app-segmented-option-active' : ''}`}
                    onClick={() => handleModeChange('file-per-account')}
                  >
                    File per account
                  </button>
                </div>

                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  accept=".csv,text/csv"
                  multiple={mode === 'file-per-account'}
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  className="group grid min-h-32 w-full place-items-center px-5 py-6 text-center transition-colors duration-150 hover:bg-[var(--app-surface-soft)]"
                  style={{
                    ...IMPORT_INSET_STYLE,
                    color: 'var(--app-text-muted)',
                  }}
                  onClick={() => inputRef.current?.click()}
                >
                  <span
                    className="mb-3 flex h-11 w-11 items-center justify-center transition-colors duration-150"
                    style={{ background: 'var(--app-surface-soft)' }}
                  >
                    <Upload size={20} aria-hidden />
                  </span>
                  <span className="block text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
                    Upload CSV {mode === 'file-per-account' ? 'files' : 'file'}
                  </span>
                  <span className="mt-1 block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                    {mode === 'file-per-account' ? 'Multiple files accepted.' : 'One file accepted.'}
                  </span>
                </button>

                {files.length === 0 ? (
                  <EmptyState
                    title="No files staged"
                    description="Uploaded files will appear here."
                  />
                ) : (
                  <div className="overflow-hidden">
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_4rem_2.25rem] items-center gap-3 px-3 py-2 text-xs font-semibold uppercase"
                      style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}
                    >
                      <span>File</span>
                      <span className="text-right">Rows</span>
                      <span aria-label="Actions" />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {files.map((file) => (
                        <div
                          key={file.id}
                          className="grid grid-cols-[minmax(0,1fr)_4rem_2.25rem] items-center gap-3 px-3 py-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <FileText size={17} className="shrink-0" style={{ color: 'var(--app-text-muted)' }} aria-hidden />
                            <div className="min-w-0">
                              <p className="truncate text-[0.9375rem] font-medium">{file.name}</p>
                              <p className="truncate text-xs" style={{ color: file.error ? 'var(--app-negative)' : 'var(--app-text-subtle)' }}>
                                {file.error ?? `${formatBytes(file.size)} · ${file.headers.length} columns`}
                              </p>
                            </div>
                          </div>
                          <span className="text-right text-[0.9375rem] font-medium tabular-nums">{file.rows.length}</span>
                          <button
                            type="button"
                            className="app-icon-button"
                            onClick={() => removeFile(file.id)}
                            aria-label={`Remove ${file.name}`}
                          >
                            <X size={16} aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-auto grid grid-cols-3 gap-3 pt-3">
                  <ImportStat label="Files" value={files.length.toString()} />
                  <ImportStat label="Rows" value={totalRows.toString()} />
                  <ImportStat label="Mapped" value={mappedFieldCount.toString()} />
                </div>
              </ImportStep>
            </aside>

            <div className="min-w-0 xl:h-full xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
              <div className="space-y-8">
                <ImportStep
                  index="02"
                  title="Column Mapping"
                  description="Map each file column to an app field."
                >
                  {headers.length === 0 ? (
                    <EmptyState
                      title="No columns available"
                      description="Upload a CSV file to map columns."
                    />
                  ) : (
                    <HeaderMappingTable
                      headers={headers}
                      files={files}
                      options={columnTargetOptions}
                      columnMap={columnMap}
                      validationErrors={columnValidationErrors}
                      onChange={updateColumnTarget}
                    />
                  )}
                </ImportStep>

                <ImportStep index="03" title="Account Mapping">
                  <ImportNotice>
                    Imported amounts are treated as raw values. During import, each amount will be assigned the base currency of the mapped account or the currency selected for a new account.
                  </ImportNotice>
                  <ImportInfoCard title="Linking Accounts with Institutions">
                    You will be able to create and link institutions to accounts after the import is complete.
                  </ImportInfoCard>
                  {mode === 'single-file' ? (
                    sourceAccounts.length === 0 ? (
                      <EmptyState
                        title="No source accounts detected"
                        description="Map an account column first."
                      />
                    ) : (
                      <AccountMappingTable
                        rows={sourceAccounts.map((sourceAccount) => {
                          const value = getResolvedAccountChoice(accountMappings[sourceAccount])
                          const account = accountById.get(value)

                          return {
                            id: sourceAccount,
                            source: sourceAccount,
                            value,
                            accountType: account?.account_type ?? '',
                            accountCurrency: account?.currency ?? '',
                            createType: getResolvedAccountCreateType(sourceAccount, accountCreateTypes),
                            createCurrency: getResolvedAccountCreateCurrency(sourceAccount, accountCreateCurrencies),
                            onChange: (nextValue: string) => updateSourceAccount(sourceAccount, nextValue),
                            onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [sourceAccount]: nextValue })),
                            onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [sourceAccount]: nextValue })),
                          }
                        })}
                        options={accountOptions}
                        accountTypeOptions={ACCOUNT_TYPE_OPTIONS}
                        currencyOptions={currencyOptions}
                        disabled={accountsLoading}
                        currenciesDisabled={currenciesLoading}
                        selectedRowIds={selectedAccountRows}
                        batchAccountType={batchAccountType}
                        batchAccountCurrency={batchAccountCurrency}
                        onBatchAccountTypeChange={setBatchAccountType}
                        onBatchAccountCurrencyChange={setBatchAccountCurrency}
                        onSelectedRowsChange={setSelectedAccountRows}
                      />
                    )
                  ) : files.length === 0 ? (
                    <EmptyState
                      title="No files staged"
                      description="Upload CSV files to assign accounts."
                    />
                  ) : (
                    <AccountMappingTable
                      rows={files.map((file) => {
                        const value = getResolvedAccountChoice(file.accountId)
                        const account = accountById.get(value)

                        return {
                          id: file.id,
                          source: file.name,
                          value,
                          accountType: account?.account_type ?? '',
                          accountCurrency: account?.currency ?? '',
                          createType: getResolvedAccountCreateType(file.id, accountCreateTypes),
                          createCurrency: getResolvedAccountCreateCurrency(file.id, accountCreateCurrencies),
                          onChange: (nextValue: string) => updateFileAccount(file.id, nextValue),
                          onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [file.id]: nextValue })),
                          onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [file.id]: nextValue })),
                        }
                      })}
                      options={accountOptions}
                      accountTypeOptions={ACCOUNT_TYPE_OPTIONS}
                      currencyOptions={currencyOptions}
                      disabled={accountsLoading}
                      currenciesDisabled={currenciesLoading}
                      selectedRowIds={selectedAccountRows}
                      batchAccountType={batchAccountType}
                      batchAccountCurrency={batchAccountCurrency}
                      onBatchAccountTypeChange={setBatchAccountType}
                      onBatchAccountCurrencyChange={setBatchAccountCurrency}
                      onSelectedRowsChange={setSelectedAccountRows}
                    />
                  )}
                </ImportStep>

                <ImportStep
                  index="04"
                  title="Category Matching"
                  description="Manually match imported category values to existing categories, or queue new ones."
                >
                  {importedCategories.length === 0 ? (
                      <EmptyState
                        title="No imported categories detected"
                        description="Map a category column first."
                    />
                  ) : (
                    <ValueMatchTable
                      sourceLabel="Category From File"
                      detailLabel="Type"
                      targetLabel="Existing Category"
                      createValue={CREATE_CATEGORY_VALUE}
                      rows={importedCategories.map((category) => ({
                        id: category,
                        source: category,
                        detailKind: getCategoryMatchKind(
                          resolvedCategoryMappings[category] ?? '',
                          categoryCreateKinds[category],
                          categoryTypesBySource[category],
                          categoryById,
                        ),
                        detailDisabled: isExistingCategoryMatch(resolvedCategoryMappings[category] ?? ''),
                        onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [category]: kind })),
                        value: resolvedCategoryMappings[category] ?? '',
                        onChange: (value) => setCategoryMappings((current) => ({ ...current, [category]: value })),
                      }))}
                      options={categoryMatchOptions}
                      disabled={categoriesLoading}
                    />
                  )}
                </ImportStep>

                <ImportStep
                  index="05"
                  title="Merchant Handling"
                  description="Merchants are created when transactions are imported. If an imported merchant matches an existing merchant name, the transaction will use the existing merchant."
                  action={(
                    <ImportCollapseToggle
                      expanded={merchantHandlingOpen}
                      label={merchantHandlingOpen ? 'Collapse merchant handling' : 'Expand merchant handling'}
                      onClick={() => setMerchantHandlingOpen((current) => !current)}
                    />
                  )}
                >
                  {merchantHandlingOpen && (importedMerchants.length === 0 ? (
                      <EmptyState
                        title="No imported merchants detected"
                        description="Map a merchant column first."
                    />
                  ) : (
                    <ImportCreateList
                      sourceLabel="Merchant From File"
                      rows={importedMerchants}
                    />
                  ))}
                </ImportStep>

                <ImportStep
                  index="06"
                  title="Tag Handling"
                  description="Tags are created when transactions are imported. If an imported tag matches an existing tag name, the transaction will use the existing tag."
                  action={(
                    <ImportCollapseToggle
                      expanded={tagHandlingOpen}
                      label={tagHandlingOpen ? 'Collapse tag handling' : 'Expand tag handling'}
                      onClick={() => setTagHandlingOpen((current) => !current)}
                    />
                  )}
                >
                  {tagHandlingOpen && (importedTags.length === 0 ? (
                      <EmptyState
                        title="No imported tags detected"
                        description="Map a tags column first."
                    />
                  ) : (
                    <ImportCreateList
                      sourceLabel="Tag From File"
                      rows={importedTags}
                    />
                  ))}
                </ImportStep>

                <ImportStep
                  index="07"
                  title="Imported Data Preview"
                  description="Showing the first 5 compiled transactions."
                >
                  {missingRequiredColumnLabels.length > 0 ? (
                    <EmptyState
                      title="Missing required columns"
                      description={missingRequiredColumnLabels.join(', ')}
                    />
                  ) : previewRows.length === 0 ? (
                    <EmptyState
                      title="No preview rows"
                      description="Mapped rows will appear here."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="min-w-[58rem]">
                        {previewGroups.map((group, groupIndex) => (
                          <div key={`${group.dateLabel}-${groupIndex}`}>
                            <div
                              className="flex items-center justify-between px-3 py-2"
                              style={{
                                background: 'var(--app-input-bg)',
                                borderBottom: '1px solid var(--app-border)',
                              }}
                            >
                              <p
                                className="text-sm font-semibold uppercase tracking-wide"
                                style={{ color: 'var(--app-text-subtle)' }}
                              >
                                {group.dateLabel}
                              </p>
                            </div>

                            <div>
                              {group.rows.map((row) => (
                                <TransactionRow
                                  key={row.id}
                                  accountInstitution={row.accountInstitution}
                                  accountName={row.accountName}
                                  category={row.category}
                                  currency={row.currency}
                                  transaction={row.transaction}
                                  onOpen={() => undefined}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </ImportStep>

                <div className="flex justify-end pb-1">
                  <button type="button" className="app-primary-button" disabled>
                    Commit import
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ImportStat({ label, value, numeric = true }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-1">
      <p className="truncate text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
        {label}
      </p>
      <p className={`truncate text-lg font-medium ${numeric ? 'font-financial tabular-nums' : ''}`}>{value}</p>
    </div>
  )
}

function ImportStep({
  index,
  title,
  description,
  action,
  className = '',
  contentClassName = 'space-y-3',
  children,
}: {
  index: string
  title: string
  description?: string
  action?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}) {
  return (
    <section className={`grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 ${className}`}>
      <div className="flex min-h-0 flex-col items-center">
        <span
          className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none"
          style={{ color: 'var(--app-accent)' }}
          aria-hidden
        >
          {index}
        </span>
        <span
          className="mt-1 w-px flex-1"
          style={{ backgroundColor: 'var(--app-border-strong)' }}
          aria-hidden
        />
      </div>

      <div className={`min-w-0 pb-1 ${contentClassName}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
              {title}
            </p>
            {description && (
              <p className="mt-1 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
        {children}
      </div>
    </section>
  )
}

function ImportCollapseToggle({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="app-icon-button h-9 w-9 shrink-0"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
    >
      <ChevronDown
        size={17}
        className="transition-transform duration-150"
        style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        aria-hidden
      />
    </button>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="px-4 py-4 text-center"
      style={{
        ...IMPORT_INSET_STYLE,
        color: 'var(--app-text-subtle)',
      }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
        {title}
      </p>
      <p className="mt-1 text-sm">{description}</p>
    </div>
  )
}

function ImportNotice({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg px-4 py-3"
      style={{
        ...IMPORT_INSET_STYLE,
        color: 'var(--app-text-muted)',
      }}
    >
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: 'var(--app-warning-text)' }}
        aria-hidden
      >
        <TriangleAlert size={16} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-semibold leading-5" style={{ color: 'var(--app-text)' }}>
          Currency Handling
        </p>
        <p className="mt-1 text-sm leading-5">
          {children}
        </p>
      </div>
    </div>
  )
}

function ImportInfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg px-4 py-3"
      style={{
        ...IMPORT_INSET_STYLE,
        color: 'var(--app-text-muted)',
      }}
    >
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: 'var(--app-accent)' }}
        aria-hidden
      >
        <Info size={16} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-semibold leading-5" style={{ color: 'var(--app-text)' }}>
          {title}
        </p>
        <p className="mt-1 text-sm leading-5">
          {children}
        </p>
      </div>
    </div>
  )
}

function HeaderMappingTable({
  headers,
  files,
  options,
  columnMap,
  validationErrors,
  onChange,
}: {
  headers: string[]
  files: ImportFileDraft[]
  options: DropdownOption[]
  columnMap: ColumnMap
  validationErrors: ColumnValidationErrors
  onChange: (header: string, target: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed min-w-[48rem] text-left text-[0.9375rem]">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[38%]" />
          <col className="w-[32%]" />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-3 font-medium">Imported Column</th>
            <th className="px-4 py-3 font-medium">Examples From File</th>
            <th className="px-4 py-3 font-medium">Match To App Field</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((header) => {
            const selectedTarget = getTargetForHeader(columnMap, header)
            const samples = getColumnSamples(files, header)
            const isIgnored = selectedTarget === ''
            const validationError = validationErrors[header]

            return (
              <tr
                key={header}
                style={{
                  background: isIgnored
                    ? 'color-mix(in srgb, var(--app-bg) 88%, var(--app-text) 12%)'
                    : undefined,
                }}
              >
                <td className="px-4 py-2.5 align-middle">
                  <div className="flex items-center gap-2">
                    <p className={`font-medium ${isIgnored ? 'line-through' : ''}`} style={{ color: isIgnored ? 'var(--app-text-muted)' : undefined }}>
                      {header}
                    </p>
                    {isIgnored && (
                      <span className="text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
                        Ignored
                      </span>
                    )}
                  </div>
                </td>
                <td className="max-w-[24rem] px-4 py-2.5 align-middle">
                  <p className="truncate text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                    {samples.length > 0 ? samples.join(', ') : 'No samples'}
                  </p>
                </td>
                <td className="px-4 py-2.5 align-middle">
                  <div className="flex items-center gap-2">
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      {validationError && (
                        <span className="group relative inline-flex">
                          <TriangleAlert
                            size={15}
                            strokeWidth={2.75}
                            aria-label={validationError}
                            className="cursor-help"
                            style={{ color: 'var(--app-negative)' }}
                          />
                          <span className="app-tooltip-panel app-hover-tooltip w-64">
                            {validationError}
                          </span>
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Dropdown
                        options={options}
                        value={selectedTarget}
                        onChange={(nextValue) => onChange(header, nextValue)}
                        searchable
                        className={`app-input ${validationError ? 'app-input-error' : ''}`}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AccountMappingTable({
  rows,
  options,
  accountTypeOptions,
  currencyOptions,
  disabled,
  currenciesDisabled,
  selectedRowIds,
  batchAccountType,
  batchAccountCurrency,
  onBatchAccountTypeChange,
  onBatchAccountCurrencyChange,
  onSelectedRowsChange,
}: {
  rows: Array<{
    id: string
    source: string
    value: string
    accountType: string
    accountCurrency: string
    createType: string
    createCurrency: string
    onChange: (value: string) => void
    onCreateTypeChange: (value: string) => void
    onCreateCurrencyChange: (value: string) => void
  }>
  options: DropdownOption[]
  accountTypeOptions: DropdownOption[]
  currencyOptions: DropdownOption[]
  disabled: boolean
  currenciesDisabled: boolean
  selectedRowIds: Set<string>
  batchAccountType: string
  batchAccountCurrency: string
  onBatchAccountTypeChange: (value: string) => void
  onBatchAccountCurrencyChange: (value: string) => void
  onSelectedRowsChange: (rows: Set<string>) => void
}) {
  const selectedRows = rows.filter((row) => selectedRowIds.has(row.id))
  const allRowsSelected = rows.length > 0 && selectedRows.length === rows.length
  const someRowsSelected = selectedRows.length > 0 && !allRowsSelected
  const createRows = rows.filter((row) => row.value === CREATE_ACCOUNT_VALUE)
  const mappedCount = rows.filter((row) => row.value && row.value !== CREATE_ACCOUNT_VALUE).length
  const newCount = createRows.length
  const reviewCount = rows.length - mappedCount - newCount

  const toggleRow = (row: (typeof rows)[number]) => {
    const next = new Set(selectedRowIds)
    if (next.has(row.id)) {
      next.delete(row.id)
    } else {
      next.add(row.id)
    }
    onSelectedRowsChange(next)
  }

  const toggleAllRows = () => {
    if (allRowsSelected) {
      onSelectedRowsChange(new Set())
      return
    }

    onSelectedRowsChange(new Set(rows.map((row) => row.id)))
  }

  const applyBatchType = () => {
    if (!batchAccountType && !batchAccountCurrency) return
    for (const row of selectedRows) {
      if (row.value !== CREATE_ACCOUNT_VALUE) row.onChange(CREATE_ACCOUNT_VALUE)
      if (batchAccountType) row.onCreateTypeChange(batchAccountType)
      if (batchAccountCurrency) row.onCreateCurrencyChange(batchAccountCurrency)
    }
    onBatchAccountTypeChange('')
    onBatchAccountCurrencyChange('')
    onSelectedRowsChange(new Set())
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[68rem] grid-cols-[3rem_27fr_29fr_20fr_24fr] items-center rounded-lg py-3"
          style={IMPORT_INSET_STYLE}
        >
          <div className="col-span-3 min-w-0 px-4">
            <p className="text-sm font-semibold">Batch Create Accounts</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
              {selectedRows.length} selected · {mappedCount} mapped · {newCount} new · {reviewCount} review
            </p>
          </div>
          <div className="min-w-0 px-4">
            <Dropdown
              options={accountTypeOptions}
              value={batchAccountType}
              onChange={onBatchAccountTypeChange}
              searchable
              placeholder="Type"
              className="app-input"
            />
          </div>
          <div className="flex min-w-0 items-center gap-3 px-4">
            <div className="min-w-0 flex-1">
              <Dropdown
                options={currencyOptions}
                value={batchAccountCurrency}
                onChange={onBatchAccountCurrencyChange}
                searchable
                placeholder="Currency"
                className="app-input"
                disabled={currenciesDisabled}
              />
            </div>
            <button
              type="button"
              className="app-primary-button h-10 shrink-0"
              onClick={applyBatchType}
              disabled={(!batchAccountType && !batchAccountCurrency) || selectedRows.length === 0}
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed min-w-[68rem] text-left text-[0.9375rem]">
          <colgroup>
            <col className="w-12" />
            <col className="w-[27%]" />
            <col className="w-[29%]" />
            <col className="w-[20%]" />
            <col className="w-[24%]" />
          </colgroup>
          <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
            <tr>
              <th className="w-12 px-4 py-3 font-medium">
                <ImportCheckbox
                  checked={allRowsSelected}
                  indeterminate={someRowsSelected}
                  onChange={toggleAllRows}
                  disabled={rows.length === 0}
                  label={allRowsSelected ? 'Deselect all accounts' : 'Select all accounts'}
                />
              </th>
              <th className="px-4 py-3 font-medium">Source Account</th>
              <th className="px-4 py-3 font-medium">Existing Account</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Currency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const creating = row.value === CREATE_ACCOUNT_VALUE

              return (
                <tr key={row.id}>
                  <td className="px-4 py-3 align-middle">
                    <ImportCheckbox
                      checked={selectedRowIds.has(row.id)}
                      onChange={() => toggleRow(row)}
                      label={`Select ${row.source}`}
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate font-medium">{row.source}</p>
                      {creating && (
                        <span className="shrink-0 text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                          New
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Dropdown
                      options={options}
                      value={row.value}
                      onChange={row.onChange}
                      searchable
                      blankWhenEmpty
                      className="app-input"
                      disabled={disabled}
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Dropdown
                      options={accountTypeOptions}
                      value={creating ? row.createType : row.accountType}
                      onChange={row.onCreateTypeChange}
                      searchable
                      blankWhenEmpty
                      className="app-input"
                      disabled={!creating}
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Dropdown
                      options={currencyOptions}
                      value={creating ? row.createCurrency : row.accountCurrency}
                      onChange={row.onCreateCurrencyChange}
                      searchable
                      blankWhenEmpty
                      className="app-input"
                      disabled={!creating || currenciesDisabled}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ValueMatchTable({
  sourceLabel,
  detailLabel,
  targetLabel,
  createValue,
  rows,
  options,
  disabled,
}: {
  sourceLabel: string
  detailLabel?: string
  targetLabel: string
  createValue?: string
  rows: Array<{
    id: string
    source: string
    detail?: string
    detailKind?: ImportCategoryKind | ''
    detailDisabled?: boolean
    onDetailKindChange?: (kind: ImportCategoryKind) => void
    value: string
    onChange: (value: string) => void
  }>
  options: DropdownOption[]
  disabled: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed min-w-[48rem] text-left text-[0.9375rem]">
        <colgroup>
          <col className={detailLabel ? 'w-[34%]' : 'w-[45%]'} />
          {detailLabel && <col className="w-64" />}
          <col className={detailLabel ? undefined : 'w-[55%]'} />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-2.5 font-medium">{sourceLabel}</th>
            {detailLabel && <th className="w-64 px-4 py-2.5 font-medium">{detailLabel}</th>}
            <th className="px-4 py-2.5 font-medium">{targetLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const creating = Boolean(createValue && row.value === createValue)

            return (
              <tr key={row.id}>
                <td className="px-4 py-2 align-middle">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-medium">{row.source}</p>
                    {creating && (
                      <span className="shrink-0 text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        New
                      </span>
                    )}
                  </div>
                </td>
                {detailLabel && (
                  <td className="px-4 py-2 align-middle">
                    {row.onDetailKindChange ? (
                      <ImportCategoryTypeToggle
                        value={row.detailKind ?? ''}
                        onChange={row.onDetailKindChange}
                        disabled={disabled || row.detailDisabled}
                      />
                    ) : (
                      <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
                        {row.detail ?? ''}
                      </span>
                    )}
                  </td>
                )}
                <td className="px-4 py-2 align-middle">
                  <Dropdown
                    options={options}
                    value={row.value}
                    onChange={row.onChange}
                    searchable
                    blankWhenEmpty
                    className="app-input h-9 px-3"
                    disabled={disabled}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ImportCategoryTypeToggle({
  value,
  onChange,
  disabled,
}: {
  value: ImportCategoryKind | ''
  onChange: (value: ImportCategoryKind) => void
  disabled?: boolean
}) {
  const shouldReduceMotion = useReducedMotion()
  const selectedIndex = IMPORT_CATEGORY_KIND_OPTIONS.findIndex((option) => option.value === value)

  return (
    <div
      className={`app-segmented-control relative w-full overflow-hidden ${disabled ? 'opacity-60' : ''}`}
      role="tablist"
      aria-label="Category type"
    >
      {selectedIndex >= 0 && (
        <motion.span
          className="pointer-events-none absolute rounded-md"
          style={{
            top: '0.125rem',
            bottom: '0.125rem',
            left: '0.125rem',
            width: `calc((100% - 0.25rem) / ${IMPORT_CATEGORY_KIND_OPTIONS.length})`,
            background: 'var(--app-accent-soft)',
            border: '1px solid var(--app-accent-border)',
          }}
          animate={{ x: `${selectedIndex * 100}%` }}
          transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }}
          aria-hidden
        />
      )}
      {IMPORT_CATEGORY_KIND_OPTIONS.map((option) => {
        const active = value === option.value

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`app-segmented-option relative z-10 w-1/3 px-0 text-center text-sm ${active ? 'app-segmented-option-active' : ''}`}
            style={active ? { background: 'transparent' } : undefined}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ImportCreateList({
  sourceLabel,
  rows,
}: {
  sourceLabel: string
  rows: string[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed min-w-[42rem] text-left text-[0.9375rem]">
        <colgroup>
          <col className="w-[45%]" />
          <col />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-2.5 font-medium">{sourceLabel}</th>
            <th className="px-4 py-2.5 font-medium">Import Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td className="px-4 py-2 align-middle">
                <p className="truncate font-medium">{row}</p>
              </td>
              <td className="px-4 py-2 align-middle">
                <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
                  Create or use existing by name
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ImportCheckbox({
  checked,
  disabled,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  indeterminate?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      className="mx-auto flex h-5 w-5 items-center justify-center rounded-lg transition-opacity duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        background: checked || indeterminate ? 'var(--app-accent)' : 'var(--app-input-bg)',
        border: `1px solid ${checked || indeterminate ? 'var(--app-accent)' : 'var(--app-border-strong)'}`,
        color: 'var(--app-button-primary-text)',
        opacity: disabled ? 0.38 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={onChange}
      disabled={disabled}
    >
      {checked && <Check size={13} strokeWidth={3} aria-hidden />}
      {!checked && indeterminate && (
        <span className="h-0.5 w-2.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden />
      )}
    </button>
  )
}

async function readCsvFile(file: File): Promise<ImportFileDraft> {
  const id = createFileId(file)

  try {
    const text = await file.text()
    const { headers, rows } = parseCsv(text)
    return {
      id,
      name: file.name,
      size: file.size,
      headers,
      rows,
      error: headers.length === 0 ? 'No header row detected' : null,
      accountId: '',
    }
  } catch {
    return {
      id,
      name: file.name,
      size: file.size,
      headers: [],
      rows: [],
      error: 'Unable to read file',
      accountId: '',
    }
  }
}

function createFileId(file: File) {
  return `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2)}`
}

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const delimiter = detectDelimiter(text)
  const records = parseCsvRecords(text, delimiter)
    .map((record) => record.map((cell) => cell.trim()))
    .filter((record) => record.some(Boolean))

  if (records.length === 0) return { headers: [], rows: [] }

  const headers = dedupeHeaders(records[0])
  const rows = records.slice(1).map((record) => {
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = record[index] ?? ''
    })
    return row
  })

  return { headers, rows }
}

function parseCsvRecords(text: string, delimiter: string) {
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      row.push(field)
      records.push(row)
      row = []
      field = ''
      if (char === '\r' && nextChar === '\n') index += 1
      continue
    }

    field += char
  }

  if (field || row.length > 0) {
    row.push(field)
    records.push(row)
  }

  return records
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  const candidates = [',', ';', '\t']
  return candidates
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ','
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') inQuotes = !inQuotes
    if (char === delimiter && !inQuotes) count += 1
  }

  return count
}

function dedupeHeaders(rawHeaders: string[]) {
  const seen = new Map<string, number>()

  return rawHeaders.map((header, index) => {
    const base = header || `Column ${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} ${count + 1}`
  })
}

function validateColumnMap(columnMap: ColumnMap, files: ImportFileDraft[]) {
  if (files.length === 0) return { map: EMPTY_COLUMN_MAP, errors: {} }

  const availableHeaders = new Set(files.flatMap((file) => file.headers))
  const errors: ColumnValidationErrors = {}
  const map = { ...EMPTY_COLUMN_MAP }

  for (const target of COLUMN_TARGETS) {
    const header = columnMap[target.id]
    if (!header || !availableHeaders.has(header)) continue

    const validation = validateColumnValues(files, header, target.id)
    map[target.id] = header
    if (!validation.valid) errors[header] = validation.message
  }

  return { map, errors }
}

function validateColumnValues(files: ImportFileDraft[], header: string, target: ColumnTarget) {
  const rule = COLUMN_VALIDATION_RULES[target]
  const values = getColumnValues(files, header)

  if (values.length === 0) {
    return {
      valid: false,
      message: `Expected ${rule.expected}. This column has no readable values.`,
    }
  }

  const blankCount = values.filter((value) => value.length === 0).length
  if (rule.requiredValues && blankCount > 0) {
    return {
      valid: false,
      message: `Expected ${rule.expected}. ${blankCount} row${blankCount === 1 ? '' : 's'} are blank.`,
    }
  }

  const invalidValue = values.filter(Boolean).find((value) => !rule.accepts(value))
  if (invalidValue) {
    return {
      valid: false,
      message: `Expected ${rule.expected}. "${truncateValue(invalidValue)}" does not match.`,
    }
  }

  return { valid: true, message: '' }
}

function getColumnValues(files: ImportFileDraft[], header: string) {
  return files.flatMap((file) => {
    if (!file.headers.includes(header)) return []
    return file.rows.map((row) => row[header]?.trim() ?? '')
  })
}

function getMappedValue(row: CsvRow, header: string) {
  return header ? row[header]?.trim() ?? '' : ''
}

function getTargetForHeader(columnMap: ColumnMap, header: string) {
  return COLUMN_TARGETS.find((target) => columnMap[target.id] === header)?.id ?? ''
}

function splitImportedValues(value: string) {
  return value
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getImportedCategoryTypes(
  files: ImportFileDraft[],
  categoryHeader: string,
  amountHeader: string,
  importedCategories: string[],
) {
  const signsByCategory = new Map<string, Set<'expense' | 'income'>>()

  if (!categoryHeader || !amountHeader) {
    return Object.fromEntries(importedCategories.map((category) => [category, '']))
  }

  for (const file of files) {
    if (!file.headers.includes(categoryHeader) || !file.headers.includes(amountHeader)) continue

    for (const row of file.rows) {
      const category = row[categoryHeader]?.trim()
      if (!category) continue

      const amount = parseImportNumber(row[amountHeader] ?? '')
      if (amount === null || amount === 0) continue

      const signs = signsByCategory.get(category) ?? new Set<'expense' | 'income'>()
      signs.add(amount < 0 ? 'expense' : 'income')
      signsByCategory.set(category, signs)
    }
  }

  return Object.fromEntries(importedCategories.map((category) => {
    const signs = signsByCategory.get(category)
    if (!signs || signs.size === 0) return [category, '']
    if (signs.size > 1) return [category, 'Mixed']
    return [category, signs.has('expense') ? 'Expense' : 'Income']
  }))
}

function keepCurrentMatchMap(
  current: Record<string, string>,
  sources: string[],
) {
  let changed = Object.keys(current).length !== sources.length
  const next: Record<string, string> = {}

  for (const source of sources) {
    next[source] = current[source] ?? ''
    if (current[source] !== next[source]) changed = true
  }

  return changed ? next : current
}

function getCategoryMatchKind(
  selectedCategoryId: string,
  createKind: ImportCategoryKind | undefined,
  inferredType: string | undefined,
  categoryById: Map<string, Category>,
) {
  if (isExistingCategoryMatch(selectedCategoryId)) {
    return categoryById.get(selectedCategoryId)?.kind ?? ''
  }

  return createKind ?? getCategoryKindFromTypeLabel(inferredType)
}

function isExistingCategoryMatch(value: string) {
  return Boolean(value && value !== CREATE_CATEGORY_VALUE)
}

function getResolvedAccountChoice(explicitValue: string | undefined) {
  return explicitValue || ''
}

function getResolvedAccountCreateType(
  rowId: string,
  accountCreateTypes: Record<string, string>,
) {
  return accountCreateTypes[rowId] || ''
}

function getResolvedAccountCreateCurrency(
  rowId: string,
  accountCreateCurrencies: Record<string, string>,
) {
  return accountCreateCurrencies[rowId] || ''
}

function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function removeSetValue<T>(set: Set<T>, value: T) {
  if (!set.has(value)) return set
  const next = new Set(set)
  next.delete(value)
  return next
}

function groupPreviewRowsByDate(rows: PreviewTransactionRow[]) {
  const groups: Array<{ dateLabel: string; rows: PreviewTransactionRow[] }> = []

  for (const row of rows) {
    let group = groups[groups.length - 1]
    if (!group || group.dateLabel !== row.dateLabel) {
      group = { dateLabel: row.dateLabel, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }

  return groups
}

function getPreviewCurrency(
  importedCurrency: string,
  accountCurrency: string | undefined,
  createAccountCurrency: string,
  fallbackCurrency: string,
) {
  for (const currency of [importedCurrency, accountCurrency, createAccountCurrency, fallbackCurrency]) {
    const normalized = currency?.trim().toUpperCase()
    if (normalized && isSupportedCurrency(normalized)) return normalized
  }

  return 'CAD'
}

function getPreviewCategory(
  importedCategory: string,
  categoryMappings: Record<string, string>,
  categoryById: Map<string, Category>,
  categoryCreateKinds: Record<string, ImportCategoryKind>,
  categoryTypesBySource: Record<string, string>,
  amount: number,
) {
  if (!importedCategory) return undefined

  const mapped = categoryMappings[importedCategory]
  if (mapped === CREATE_CATEGORY_VALUE) {
    return {
      id: `import-preview-category-${importedCategory}`,
      group_id: null,
      owner_id: null,
      name: importedCategory,
      kind: getPreviewCategoryKind(categoryCreateKinds[importedCategory], categoryTypesBySource[importedCategory], amount),
      icon: DEFAULT_CATEGORY_ICON,
      is_system: false,
      created_at: '',
    }
  }

  if (mapped) return categoryById.get(mapped)
  return undefined
}

function getPreviewCategoryKind(
  categoryKind: ImportCategoryKind | undefined,
  categoryType: string | undefined,
  amount: number,
): Category['kind'] {
  if (categoryKind) return categoryKind
  if (categoryType === 'Transfer') return 'transfer'
  if (categoryType === 'Income') return 'income'
  if (categoryType === 'Expense') return 'expense'
  if (amount > 0) return 'income'
  return 'expense'
}

function getCategoryKindFromTypeLabel(categoryType: string | undefined): ImportCategoryKind | '' {
  if (categoryType === 'Transfer') return 'transfer'
  if (categoryType === 'Income') return 'income'
  if (categoryType === 'Expense') return 'expense'
  return ''
}

function normalizeImportDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    return isValidDateParts(year, month, day) ? formatYmd(year, month, day) : ''
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (slashMatch) {
    const first = Number(slashMatch[1])
    const second = Number(slashMatch[2])
    const year = normalizeDateYear(Number(slashMatch[3]))
    if (isValidDateParts(year, first, second)) return formatYmd(year, first, second)
    if (isValidDateParts(year, second, first)) return formatYmd(year, second, first)
    return ''
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatYmd(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
}

function getPreviewDateLabel(ymd: string) {
  if (!ymd) return 'Missing Date'
  const [year, month, day] = ymd.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatYmd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toMinorUnits(value: number, currency: string) {
  return Math.round(value * 10 ** getCurrencyExponent(currency))
}

function getCurrencyExponent(currency: string) {
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    return formatter.resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

function isSupportedCurrency(currency: string) {
  if (!isValidCurrencyCode(currency)) return false

  try {
    new Intl.NumberFormat(undefined, { style: 'currency', currency })
    return true
  } catch {
    return false
  }
}

function getColumnSamples(files: ImportFileDraft[], header: string) {
  return unique(
    getColumnValues(files, header).filter(Boolean),
  ).slice(0, 3)
}

function isPlainTextValue() {
  return true
}

function isValidDateValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoMatch) {
    return isValidDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (slashMatch) {
    const first = Number(slashMatch[1])
    const second = Number(slashMatch[2])
    const year = normalizeDateYear(Number(slashMatch[3]))
    return isValidDateParts(year, first, second) || isValidDateParts(year, second, first)
  }

  return /[a-z]/i.test(trimmed) && !Number.isNaN(Date.parse(trimmed))
}

function normalizeDateYear(year: number) {
  if (year >= 100) return year
  return year >= 70 ? 1900 + year : 2000 + year
}

function isValidDateParts(year: number, month: number, day: number) {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function isValidAmountValue(value: string) {
  return parseImportNumber(value) !== null
}

function parseImportNumber(value: string) {
  const normalized = value.trim()
  if (!normalized) return null

  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return null

  const parsed = Number(normalized.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function isValidCurrencyCode(value: string) {
  return /^[A-Z]{3}$/i.test(value.trim())
}

function truncateValue(value: string) {
  return value.length > 28 ? `${value.slice(0, 25)}...` : value
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
