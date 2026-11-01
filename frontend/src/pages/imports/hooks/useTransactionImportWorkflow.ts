import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import { getImportFileName } from '@/api/import-runs'
import { useTransactions } from '@/api/transactions'
import {
  useCommitStagedImport,
  useImportLayouts,
  useImportTransactions,
  type TransactionImportResponse,
} from '@/api/transaction-imports'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import { useAuth } from '@/hooks/useAuth'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import { OUTSIDE_ACCOUNT_LABEL, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'
import type {
  ColumnMap,
  ColumnTarget,
  ColumnValidationErrors,
  CsvReadingChoices,
  ImportAmountDirection,
  ImportCategoryKind,
  ImportFileDraft,
  ImportRowProblem,
  PreviewTransactionRow,
} from '@/pages/imports/types'
import {
  buildColumnTargetOptions,
  buildImportAnswerScope,
  buildImportAccountMappingSources,
  buildImportAccountOptions,
  buildTransactionImportPayload,
  answerImportDirectionValue,
  buildImportPreviewRows,
  countRowsWithNoMerchant,
  formatImportSummary,
  getArchivedAccountMatches,
  dropVanishedAccountMappings,
  dropVanishedCategoryMappings,
  getImportDirectionValues,
  getCsvCategoryRenames,
  getImportedCategoryTypes,
  getImportedCategories,
  getImportedMerchants,
  getImportedTags,
  getImportAccountRowState,
  getImportHeaders,
  getStatedCurrencyByAccountSource,
  getColumnValues,
  countImportRowsOutsideDateRange,
  getImportDateRangeBlockReason,
  getImportDateRangeFilter,
  getLatestStartSuggestion,
  getLatestTransactionFilters,
  excludeRefusedRows,
  includeEveryImportRow,
  isImportDateRangeCrossed,
  getMissingRequiredColumnLabels,
  getNextAutoFilledColumnHeaders,
  getNextColumnMap,
  getImportUploadBlockReason,
  getNextColumnValidationErrors,
  getSupportedCurrencyCodes,
  inferCategoryMappings,
  isAutoFilledAccountSource,
  isColumnMappingComplete,
  getCsvImportStats,
  groupPreviewRowsByDate,
  guessImportDirectionAnswers,
  inferColumnMap,
  type ImportAmountFormat,
  type ImportDateFormat,
  type ImportFileAcquisition,
  buildImportAmountFormatScope,
  buildImportDateFormatScope,
  chooseImportFormat,
  createImportFormatChoiceState,
  getImportAmountFormatValues,
  keepCurrentMatchMap,
  moveImportFormatChoiceToScope,
  processImportFileIntake,
  readCsvFile,
  readCsvFileWithLayout,
  readSavedImportLayouts,
  buildCsvImportLayout,
  getImportLayoutsUploadBlockReason,
  type RememberedImportLayout,
  readScopedImportAnswers,
  resolveImportAccountCreateCurrencies,
  resolveImportAccountMappings,
  resolveImportFormatChoice,
  scanImportAmountFormatChoices,
  scanImportDateFormatChoices,
  validateColumnValues,
  writeScopedImportAnswers,
  emptyScopedImportAnswers,
  alignNameAnswersWithValues,
  SEVERAL_CSV_IMPORT_FILE_TYPE,
  labelStagedFiles,
  removeStagedFile,
  restageImportFiles,
  getChosenSkipLastRows,
  getSharedReadingChoices,
  stageImportFiles,
  type ImportDelimiter,
  type ScopedImportAnswers,
  type StagingCandidate,
  type CsvImportAnswers,
} from '@/pages/imports/utils'
import { isImportableAccount } from '@/utils/importableAccount'
import { waitForMilliseconds } from '@/utils/timing'
import { useImportAccountCreateState } from './useImportAccountCreateState'
import { useImportMerchantMatches } from './useImportMerchantMatches'
import { useImportTagMatches } from './useImportTagMatches'
import { useImportReferenceData } from './useImportReferenceData'
import { useImportDateRange } from './useImportDateRange'
import { useImportRun } from './useImportRun'
import { useUnchangedImportAnswers } from './useUnchangedImportAnswers'

const FILE_ACCOUNT_MATCH_KEY = '__file_account__'

// Stands for no column mapped as the category, where every row is filed under (no category),
// (money in, no category) or (transfer, no category) and those values are still matched automatically
const NO_CATEGORY_COLUMN_MATCH_KEY = '__no_category_column__'

// Stands in while a reference list has not arrived, so nothing is treated as cleared and the memos
// below keep the same identity from render to render
const NO_CLEARED_SOURCES: Set<string> = new Set()
const CSV_PROCESSING_MIN_MS = LOADING_ANIMATION_MIN_MS

// What the overlay calls the upload of a CSV file
const CSV_UPLOAD_LABEL = 'Uploading the import'

/**
 * Drives the generic CSV import flow: staging one file or several with one layout, which the first
 * sets, and which share one set of answers and make one import, mapping their columns to app fields, resolving
 * the accounts and categories those columns reference against the user's existing ones, building the
 * preview and commit payload, and running the commit
 *
 * Account and category matches are only inferred automatically while the required columns stay
 * mapped to the same headers; changing a required column's mapping clears the matching auto-fill key
 * so a stale inference is never carried into a different set of source values
 *
 * @param fixedAccount - The account this import was started from, null for an ordinary import. It
 *   answers the account question outright, so the column mapping neither offers nor keeps an account
 *   column while it holds, and every source rows are written to is that account rather than anything
 *   resolved from the file. A transfer's counterparty is resolved as it always is
 */
export function useTransactionImportWorkflow(fixedAccount: AccountsOverview | null = null) {
  const { user } = useAuth()
  const timeZone = user?.tz
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<ImportFileDraft[]>([])
  const [isProcessingFiles, setIsProcessingFiles] = useState(false)
  const [fileIntakeError, setFileIntakeError] = useState<string | null>(null)
  const [autoFilledColumnHeaders, setAutoFilledColumnHeaders] = useState<Set<string>>(() => new Set())

  // Columns the user has answered for, so replacing the file with one carrying the same headings
  // leaves their answers alone instead of guessing over them. A column set to Do not import counts
  // as answered, which is the case an empty mapping cannot tell apart on its own
  const [decidedColumnHeaders, setDecidedColumnHeaders] = useState<Set<string>>(() => new Set())
  const [storedColumnMap, setStoredColumnMap] = useState<ColumnMap>(EMPTY_COLUMN_MAP)
  const isAccountFixed = fixedAccount !== null

  // Settings are remembered only for an import started from an account, which is the one place the
  // account a file went to is known before its rows are read. The layouts an uploaded file is checked
  // against are that account's own. An ordinary import reads none and saves none
  const importLayouts = useImportLayouts(isAccountFixed)
  const fixedAccountId = fixedAccount?.id ?? null
  const rememberedLayouts = useMemo(
    () => readSavedImportLayouts(importLayouts.data ?? []).filter((layout) => layout.accountId === fixedAccountId),
    [fixedAccountId, importLayouts.data],
  )

  // The account an import was started from answers for every row, so nothing downstream may read a
  // mapped account column while that holds. Emptied here rather than cleared outright, because the
  // column mapping is only inferred when a file is staged: a user who leaves the scope, maps the
  // account column by hand and comes back would otherwise arrive with it mapped, the row sources
  // would go back to being that column's values, and every row with a blank account cell would be
  // refused on a page where the column is meant not to matter
  //
  // What is stored keeps that answer only until the next file is staged or the next column is
  // answered here, both of which write this emptied map back. So leaving the scope leaves the
  // account column unmapped in the ordinary case, for the user to answer on the page they went to
  const columnMap = useMemo(
    () => (isAccountFixed ? { ...storedColumnMap, account_id: '' } : storedColumnMap),
    [isAccountFixed, storedColumnMap],
  )

  const [scopedAccountMappings, setScopedAccountMappings] =
    useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [accountAutoMatchKey, setAccountAutoMatchKey] = useState('')

  const [dateFormatChoice, setDateFormatChoice] = useState(() => createImportFormatChoiceState<ImportDateFormat>(''))

  // Detected and checked over every row in the file, whatever dates are chosen, since the chosen
  // dates can only be read once the format is settled
  const dateValues = useMemo(() => (columnMap.dt ? getColumnValues(files, columnMap.dt) : []), [columnMap.dt, files])
  const dateFormatScan = useMemo(
    () => scanImportDateFormatChoices(dateValues, 'automatic', timeZone),
    [dateValues, timeZone],
  )
  const dateFormatScope = buildImportDateFormatScope(columnMap, files)
  const dateFormat = resolveImportFormatChoice(dateFormatChoice, dateFormatScope, dateFormatScan.automatic)
  const dateFormatAutomatic =
    dateFormatScan.automatic !== null &&
    (dateFormatChoice.scope !== dateFormatScope || dateFormatChoice.chosen === null)

  // The dates the import is limited to. Kept apart from the column mapping, since the mapping
  // describes the file while the range is a choice about this one import
  //
  // The page reads the range once the user has finished editing it, while the fields show it at once
  const { dateRange, shownDateRange, applyDateRange, setDateRangeEnd, resetDateRange, setIsPointerInDatePanel } =
    useImportDateRange()
  const isCommitAfterDatesRef = useRef(false)

  const dateRangeFilter = useMemo(
    () => getImportDateRangeFilter({ columnMap, dateFormat, timeZone, dateRange }),
    [columnMap, dateFormat, dateRange, timeZone],
  )

  // Every question about the file's values is asked about the rows the import takes, so a name only
  // rows outside the chosen dates carry is not asked about. A range that cannot be applied yet asks
  // about every row, which is what the import holds until the dates or the format are put right
  const isRowIncluded = dateRangeFilter ?? includeEveryImportRow
  const outsideRangeRowCount = useMemo(
    () => countImportRowsOutsideDateRange(files, dateRangeFilter),
    [dateRangeFilter, files],
  )
  const isDateRangeCrossed = isImportDateRangeCrossed(columnMap, shownDateRange)

  // Read from the dates on screen, not the ones the page has taken, so Commit import is greyed out
  // for as long as a date is wrong, including while the user is still in the field
  const dateRangeBlockReason = getImportDateRangeBlockReason(columnMap, shownDateRange)

  // Offered rather than filled in, so the start stays empty unless the user asks for it
  const todayYmd = useTodayYmd()
  const { data: latestTransactions } = useTransactions(getLatestTransactionFilters(fixedAccount?.id ?? null, todayYmd))
  const latestStartSuggestion = getLatestStartSuggestion(latestTransactions?.[0]?.dt)

  const accountMappingSources = useMemo(
    () =>
      buildImportAccountMappingSources(files, columnMap.account_id, columnMap.counterparty_account_id, isRowIncluded),
    [columnMap.account_id, columnMap.counterparty_account_id, files, isRowIncluded],
  )

  // The account sources come from two columns, so an answer is about whichever of them supplied it
  // and survives the other one changing. The date format choice answers to its own column the same
  // way, and this is that idea for a set of sources that has more than one origin
  const rowAccountAnswerScope = buildImportAnswerScope(columnMap.account_id, files)
  const counterpartyAnswerScope = buildImportAnswerScope(columnMap.counterparty_account_id, files)
  const categoryAnswerScope = buildImportAnswerScope(columnMap.category_id, files)
  const merchantAnswerScope = buildImportAnswerScope(columnMap.merchant_id, files)
  const tagAnswerScope = buildImportAnswerScope(columnMap.tag_ids, files)

  const counterpartyOnlySourceIds = useMemo(
    () => new Set(accountMappingSources.filter((source) => source.isCounterpartyOnly).map((source) => source.id)),
    [accountMappingSources],
  )

  // Both resolvers are held steady, since the answers read through them reach the commit payload
  // and the preview, and a new function each render would rebuild those on every keystroke
  const getAccountSourceScope = useMemo(
    () => (sourceId: string) =>
      counterpartyOnlySourceIds.has(sourceId) ? counterpartyAnswerScope : rowAccountAnswerScope,
    [counterpartyAnswerScope, counterpartyOnlySourceIds, rowAccountAnswerScope],
  )

  const getCategorySourceScope = useMemo(() => () => categoryAnswerScope, [categoryAnswerScope])
  const getMerchantSourceScope = useMemo(() => () => merchantAnswerScope, [merchantAnswerScope])
  const getTagSourceScope = useMemo(() => () => tagAnswerScope, [tagAnswerScope])

  const accountMappings = useMemo(
    () => readScopedImportAnswers(scopedAccountMappings, getAccountSourceScope),
    [getAccountSourceScope, scopedAccountMappings],
  )

  const setAccountMappings: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedAccountMappings((current) => {
      const answers = readScopedImportAnswers(current, getAccountSourceScope)
      return writeScopedImportAnswers(
        current,
        typeof update === 'function' ? update(answers) : update,
        getAccountSourceScope,
      )
    })
  }

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
    resetAccountCreateState,
  } = useImportAccountCreateState(setAccountMappings, getAccountSourceScope)
  const [columnValidationErrors, setColumnValidationErrors] = useState<ColumnValidationErrors>({})

  const [amountFormatChoice, setAmountFormatChoice] = useState(() =>
    createImportFormatChoiceState<ImportAmountFormat>(''),
  )

  // What the user said each word in the Direction column means. Scoped like every other per-value
  // answer, so setting that column to Do not import and mapping it back is not the same as answering
  // the question again, and a different column's words start unanswered
  const [scopedDirectionAnswers, setScopedDirectionAnswers] =
    useState<ScopedImportAnswers<ImportAmountDirection>>(emptyScopedImportAnswers)
  const [scopedCategoryMappings, setScopedCategoryMappings] =
    useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [categoryAutoMatchKey, setCategoryAutoMatchKey] = useState('')
  const [scopedCategoryCreateKinds, setScopedCategoryCreateKinds] =
    useState<ScopedImportAnswers<ImportCategoryKind>>(emptyScopedImportAnswers)

  // The name the user typed for a new category whose own name an existing category holds for another type
  const [scopedCategoryCreateNames, setScopedCategoryCreateNames] =
    useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)

  // What the user answered for each merchant name, and the name they wrote for one being created.
  // Scoped like every other answer, so a second file's merchants start unanswered
  const [scopedMerchantMappings, setScopedMerchantMappings] =
    useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [scopedMerchantCreateNames, setScopedMerchantCreateNames] =
    useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)

  // The same for each tag name, scoped to the tags column
  const [scopedTagMappings, setScopedTagMappings] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [scopedTagCreateNames, setScopedTagCreateNames] =
    useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)

  // Tells a finished file read whether the workflow it started in is still the one on screen, so a
  // reset in between drops its result instead of writing into what replaced it
  const workflowRunRef = useRef(0)

  // The files the staged drafts were read from, by draft id, kept so they can be read again with
  // another separator and told apart from a file picked a second time
  const sourceFilesRef = useRef<Map<string, File>>(new Map())
  const importTransactions = useImportTransactions()
  const commitStagedImport = useCommitStagedImport()

  // Every answer the import is sent with, held by the answers themselves rather than by what they
  // resolve to. The ledger is read again after an interrupted save, which can re-resolve an
  // auto-filled answer against what that save created, and that must not read as the user changing
  // an answer, or Commit import would settle the kept upload instead of saving it. The fixed
  // account is held by its id, since its object is replaced whenever the accounts list is read
  const importAnswers = useUnchangedImportAnswers<CsvImportAnswers>({
    files,
    storedColumnMap,
    fixedAccountId: fixedAccount?.id ?? null,
    scopedAccountMappings,
    accountCreateTypes,
    accountCreateCurrencies,
    accountCreateInstitutions,
    dateFormatChoice,
    dateRange,
    amountFormatChoice,
    scopedDirectionAnswers,
    scopedCategoryMappings,
    scopedCategoryCreateKinds,
    scopedCategoryCreateNames,
    scopedMerchantMappings,
    scopedMerchantCreateNames,
    scopedTagMappings,
    scopedTagCreateNames,
  })

  const run = useImportRun<TransactionImportResponse, ImportRowProblem>({
    answers: importAnswers,
    uploadLabel: CSV_UPLOAD_LABEL,
    mutations: [importTransactions, commitStagedImport],
    formatSummary: ({ result, skippedRowsAtCommit, outsideRangeCountAtCommit }) =>
      formatImportSummary(result, skippedRowsAtCommit.length, outsideRangeCountAtCommit),
  })

  const categoryMappings = useMemo(
    () => readScopedImportAnswers(scopedCategoryMappings, getCategorySourceScope),
    [getCategorySourceScope, scopedCategoryMappings],
  )

  const categoryCreateKinds = useMemo(
    () => readScopedImportAnswers(scopedCategoryCreateKinds, getCategorySourceScope),
    [getCategorySourceScope, scopedCategoryCreateKinds],
  )

  const setCategoryMappings: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedCategoryMappings((current) => {
      const answers = readScopedImportAnswers(current, getCategorySourceScope)
      return writeScopedImportAnswers(
        current,
        typeof update === 'function' ? update(answers) : update,
        getCategorySourceScope,
      )
    })
  }

  const setCategoryCreateKinds: Dispatch<SetStateAction<Record<string, ImportCategoryKind>>> = (update) => {
    setScopedCategoryCreateKinds((current) => {
      const answers = readScopedImportAnswers(current, getCategorySourceScope)
      return writeScopedImportAnswers(
        current,
        typeof update === 'function' ? update(answers) : update,
        getCategorySourceScope,
      )
    })
  }

  const categoryCreateNames = useMemo(
    () => readScopedImportAnswers(scopedCategoryCreateNames, getCategorySourceScope),
    [getCategorySourceScope, scopedCategoryCreateNames],
  )

  const setCategoryCreateNames: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedCategoryCreateNames((current) => {
      const answers = readScopedImportAnswers(current, getCategorySourceScope)
      return writeScopedImportAnswers(
        current,
        typeof update === 'function' ? update(answers) : update,
        getCategorySourceScope,
      )
    })
  }

  const merchantMappings = useMemo(
    () => readScopedImportAnswers(scopedMerchantMappings, getMerchantSourceScope),
    [getMerchantSourceScope, scopedMerchantMappings],
  )

  const merchantCreateNames = useMemo(
    () => readScopedImportAnswers(scopedMerchantCreateNames, getMerchantSourceScope),
    [getMerchantSourceScope, scopedMerchantCreateNames],
  )

  const setMerchantMappings: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedMerchantMappings((current) => {
      const answers = readScopedImportAnswers(current, getMerchantSourceScope)
      return writeScopedImportAnswers(
        current,
        typeof update === 'function' ? update(answers) : update,
        getMerchantSourceScope,
      )
    })
  }

  const setMerchantCreateNames: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedMerchantCreateNames((current) => {
      const answers = readScopedImportAnswers(current, getMerchantSourceScope)
      return writeScopedImportAnswers(
        current,
        typeof update === 'function' ? update(answers) : update,
        getMerchantSourceScope,
      )
    })
  }

  const {
    currencies,
    categories,
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
    allAccounts,
    accountOptions,
    currencyOptions,
    institutionOptions,
    categoryMatchOptions,
    accountById,
    categoryById,
    institutionById,
  } = useImportReferenceData()

  const supportedCurrencyCodes = useMemo(() => getSupportedCurrencyCodes(currencies), [currencies])

  // What each account source's own rows say its currency is, which is what a row creating an
  // account starts out holding
  const statedAccountCurrencies = useMemo(
    () =>
      getStatedCurrencyByAccountSource(
        files,
        columnMap.account_id,
        columnMap.currency,
        supportedCurrencyCodes,
        isRowIncluded,
      ),
    [columnMap.account_id, columnMap.currency, files, isRowIncluded, supportedCurrencyCodes],
  )

  const headers = useMemo(() => getImportHeaders(files), [files])

  const missingRequiredColumnLabels = useMemo(() => getMissingRequiredColumnLabels(columnMap), [columnMap])

  const columnTargetOptions = useMemo(
    () => buildColumnTargetOptions({ omitAccountColumn: isAccountFixed }),
    [isAccountFixed],
  )

  // Counted off the files and the merchant column alone, so the mapping step can say how many rows
  // will be filed under a merchant that ships with the app without waiting on the account and
  // category answers the payload build needs
  const rowsWithNoMerchantCount = useMemo(
    () => countRowsWithNoMerchant(files, columnMap.merchant_id, isRowIncluded),
    [columnMap.merchant_id, files, isRowIncluded],
  )

  const amountFormatScope = buildImportAmountFormatScope(columnMap, files)
  const amountFormatScan = useMemo(
    () => scanImportAmountFormatChoices(getImportAmountFormatValues(columnMap, files)),
    [columnMap, files],
  )
  const amountFormat = resolveImportFormatChoice(amountFormatChoice, amountFormatScope, amountFormatScan.automatic)
  const amountFormatAutomatic =
    amountFormatScan.automatic !== null &&
    (amountFormatChoice.scope !== amountFormatScope || amountFormatChoice.chosen === null)

  // The date column answers to a choice made outside the mapping table, so its error is worked out
  // on every render rather than kept in the stored map, which only refreshes when a mapping changes
  const dateColumnValidation = useMemo(
    () =>
      columnMap.dt
        ? validateColumnValues(files, columnMap.dt, 'dt', supportedCurrencyCodes, dateFormat, { timeZone })
        : null,
    [columnMap.dt, dateFormat, files, supportedCurrencyCodes, timeZone],
  )

  const resolvedColumnValidationErrors = useMemo(() => {
    const next = { ...columnValidationErrors }
    if (columnMap.dt && dateColumnValidation) {
      if (dateColumnValidation.valid) delete next[columnMap.dt]
      else next[columnMap.dt] = dateColumnValidation.message
    }

    for (const target of ['amount', 'amount_out', 'amount_in'] as const) {
      const header = columnMap[target]
      if (!header) continue
      const validation = validateColumnValues(files, header, target, supportedCurrencyCodes, null, { amountFormat })
      if (validation.valid) delete next[header]
      else next[header] = validation.message
    }

    return next
  }, [amountFormat, columnMap, columnValidationErrors, dateColumnValidation, files, supportedCurrencyCodes])

  const setDateFormat = (format: ImportDateFormat) => {
    setDateFormatChoice(chooseImportFormat(dateFormatScope, format))
  }

  const setAmountFormat = (format: ImportAmountFormat) => {
    setAmountFormatChoice(chooseImportFormat(amountFormatScope, format))
  }

  // Every distinct word the mapped Direction column holds in the rows the import takes, which is what
  // the panel asks about and what the commit checks has been answered. Empty where no such column is
  // mapped. Whether the column holds too many words to be a direction is still judged on every row
  const directionValues = useMemo(
    () =>
      columnMap.amount_direction ? getImportDirectionValues(files, columnMap.amount_direction, isRowIncluded) : [],
    [columnMap.amount_direction, files, isRowIncluded],
  )

  // Answers belong to the column they were given for, the way the date format choice does, so the
  // scope is that column and the staged file
  const directionAnswerScope = buildImportAnswerScope(columnMap.amount_direction, files)
  const getDirectionValueScope = useMemo(() => () => directionAnswerScope, [directionAnswerScope])

  const chosenDirectionAnswers = useMemo(
    () => readScopedImportAnswers(scopedDirectionAnswers, getDirectionValueScope),
    [getDirectionValueScope, scopedDirectionAnswers],
  )

  // What the words settle on their own, which is nothing unless they settle the whole column. Laid
  // under the user's answers rather than over them, so answering one word by hand keeps that answer
  const guessedDirectionAnswers = useMemo(
    () => guessImportDirectionAnswers(directionValues.map((value) => value.label)),
    [directionValues],
  )

  const directionAnswers = useMemo(
    () => ({ ...guessedDirectionAnswers, ...chosenDirectionAnswers }),
    [chosenDirectionAnswers, guessedDirectionAnswers],
  )

  // Glowed as filled in by the app until the user answers that word themselves
  const autoFilledDirectionValues = useMemo(
    () => new Set(Object.keys(guessedDirectionAnswers).filter((key) => !(key in chosenDirectionAnswers))),
    [chosenDirectionAnswers, guessedDirectionAnswers],
  )

  const setDirectionAnswer = (value: string, direction: ImportAmountDirection) => {
    setScopedDirectionAnswers((current) =>
      writeScopedImportAnswers(
        current,
        answerImportDirectionValue(
          readScopedImportAnswers(current, getDirectionValueScope),
          directionValues,
          value,
          direction,
        ),
        getDirectionValueScope,
      ),
    )
  }

  // Only a source no row is written to can answer that the money left the tracked accounts, so the
  // extra choice is kept off every other row's dropdown, and the same reason is why an archived or
  // read-only account is offered here and nowhere else in the flow
  const counterpartyAccountOptions = useMemo(
    () => [
      { value: OUTSIDE_ACCOUNT_VALUE, label: OUTSIDE_ACCOUNT_LABEL, group: 'Import action' },
      ...buildImportAccountOptions(allAccounts),
    ],
    [allAccounts],
  )

  // Read against the stored map rather than the emptied one, because that is the map the key was
  // written from. The scope can turn on and off without a file being staged or a column answered,
  // which is what writes the key, so comparing against the emptied map would call the key stale on
  // a scope change alone. The match would then never run and every counterparty the file names
  // would quietly record its transfer as money leaving the app
  const canInferAccountMappings =
    Boolean(accountAutoMatchKey) && accountAutoMatchKey === (storedColumnMap.account_id || FILE_ACCOUNT_MATCH_KEY)

  const { mappings: liveAccountMappings, clearedSources: clearedAccountSources } = useMemo(
    () =>
      accountsResolved
        ? dropVanishedAccountMappings(accountMappings, accountById)
        : { mappings: accountMappings, clearedSources: NO_CLEARED_SOURCES },
    [accountById, accountMappings, accountsResolved],
  )

  // A source whose account has gone still participates in collision discovery but receives no
  // automatic match, while fixed imports still answer every row source. Unanswered counterparties
  // outside collisions then default outside, and current unmatched row sources outside collisions
  // default to create
  //
  // Accounts are asked about again once an import has run, and a file's account then matches the
  // account the import created from it. A finished import's record matches without those, so the
  // account shows as created, the way it was imported
  const createdAccountIds = run.workflow.importResult?.created_account_ids
  const { matchedMappings: matchedAccountMappings, resolvedMappings: resolvedAccountMappings } = useMemo(() => {
    const created = new Set(createdAccountIds)
    const isKnownBeforeImport = (account: { id: string }) => !created.has(account.id)

    return resolveImportAccountMappings({
      sources: accountMappingSources,
      liveMappings: liveAccountMappings,
      clearedSourceIds: clearedAccountSources,
      fixedAccountId: fixedAccount?.id ?? null,
      canInfer: canInferAccountMappings,
      accountsCurrent,
      rowAccounts: selectableAccounts.filter(isKnownBeforeImport),
      counterpartyAccounts: allAccounts.filter(isKnownBeforeImport),
    })
  }, [
    accountMappingSources,
    accountsCurrent,
    allAccounts,
    canInferAccountMappings,
    clearedAccountSources,
    createdAccountIds,
    fixedAccount,
    liveAccountMappings,
    selectableAccounts,
  ])

  const resolvedAccountCreateCurrencies = useMemo(
    () =>
      resolveImportAccountCreateCurrencies(accountCreateCurrencies, resolvedAccountMappings, statedAccountCurrencies),
    [accountCreateCurrencies, resolvedAccountMappings, statedAccountCurrencies],
  )

  // The labels rather than the ids, since the notice lists them for the user, and only the sources
  // still waiting on an answer: the create-new fallback can leave a cleared row finished, and a
  // notice telling the user to answer a row they have already answered is worse than no notice
  const clearedAccountSourceLabels = useMemo(
    () =>
      accountMappingSources
        .filter((source) => {
          if (!clearedAccountSources.has(source.id)) return false

          const value = resolvedAccountMappings[source.id] ?? ''
          const account = accountById.get(value)
          return (
            getImportAccountRowState({
              value,
              isCounterpartyOnly: source.isCounterpartyOnly,
              createType: accountCreateTypes[source.id] ?? '',
              createCurrency: resolvedAccountCreateCurrencies[source.id] ?? '',
              isReadOnlyAccount: account ? !isImportableAccount(account) : false,
            }) === 'review'
          )
        })
        .map((source) => source.label),
    [
      accountById,
      accountCreateTypes,
      accountMappingSources,
      clearedAccountSources,
      resolvedAccountCreateCurrencies,
      resolvedAccountMappings,
    ],
  )

  // Read before the name match and any of the defaults are layered on, so the batch bar can tell an
  // answer the user gave from one the step filled in for them
  //
  // A source rows are written to is left out while the account is fixed. Its answer is that account
  // whatever the user picked earlier, so reporting it as theirs would offer a later reader an answer
  // the step is ignoring
  const handAnsweredAccountSources = useMemo(() => {
    const counterpartyOnly = new Set(
      accountMappingSources.filter((source) => source.isCounterpartyOnly).map((source) => source.id),
    )

    return new Set(
      Object.entries(liveAccountMappings)
        .filter(([source, choice]) => choice && !(isAccountFixed && !counterpartyOnly.has(source)))
        .map(([source]) => source),
    )
  }, [accountMappingSources, isAccountFixed, liveAccountMappings])

  // Read before the create-new fallback, which answers every row source and would therefore leave
  // this with nothing to report, dropping the notice without a word
  const archivedAccountMatches = useMemo(
    () => getArchivedAccountMatches(accountMappingSources, matchedAccountMappings, allAccounts),
    [accountMappingSources, allAccounts, matchedAccountMappings],
  )

  const autoFilledAccountSources = useMemo(
    () =>
      new Set(
        accountMappingSources
          .filter((source) => {
            // The highlight means an account was recognised from what the file says, and the account
            // an import was started from is neither recognised nor shown in a row of its own
            if (isAccountFixed && !source.isCounterpartyOnly) return false

            return isAutoFilledAccountSource(
              liveAccountMappings[source.id] ?? '',
              resolvedAccountMappings[source.id] ?? '',
              source.isCounterpartyOnly,
            )
          })
          .map((source) => source.id),
      ),
    [accountMappingSources, isAccountFixed, liveAccountMappings, resolvedAccountMappings],
  )

  const importedCategories = useMemo(
    () => getImportedCategories(files, columnMap, directionAnswers, amountFormat, isRowIncluded),
    [amountFormat, columnMap, directionAnswers, files, isRowIncluded],
  )

  const importedMerchants = useMemo(
    () => getImportedMerchants(files, columnMap.merchant_id, isRowIncluded),
    [columnMap.merchant_id, files, isRowIncluded],
  )

  const {
    matchedMerchantByKey,
    matchesLoading,
    matchesFailed,
    refetchMatches,
    merchantOptions,
    rememberPickedMerchant,
    merchantSearch,
    setMerchantSearch,
    merchantSearchLoading,
    hasMoreMerchantResults,
    loadMoreMerchantResults,
  } = useImportMerchantMatches(importedMerchants)

  const categoryTypesBySource = useMemo(
    () => getImportedCategoryTypes(files, columnMap, importedCategories, directionAnswers, amountFormat, isRowIncluded),
    [amountFormat, columnMap, directionAnswers, importedCategories, files, isRowIncluded],
  )

  const canInferCategoryMappings = categoryAutoMatchKey === (columnMap.category_id || NO_CATEGORY_COLUMN_MATCH_KEY)

  const { mappings: liveCategoryMappings, clearedSources: clearedCategorySources } = useMemo(
    () =>
      categoriesResolved
        ? dropVanishedCategoryMappings(categoryMappings, categoryById)
        : { mappings: categoryMappings, clearedSources: NO_CLEARED_SOURCES },
    [categoriesResolved, categoryById, categoryMappings],
  )

  // A finished import's record guesses without the categories it created, as for its accounts, so
  // a name it filed under an existing category is not moved to a closer one the import made
  const createdCategoryIds = run.workflow.importResult?.created_category_ids

  // What a "Create new" answer reuses is judged against these, so a finished import's record keeps
  // showing the categories it created as created rather than as ones the user already had
  const categoriesBeforeImport = useMemo(
    () => new Map([...categoryById].filter(([id]) => !createdCategoryIds?.includes(id))),
    [categoryById, createdCategoryIds],
  )
  const resolvedCategoryMappings = useMemo(() => {
    // A name whose category has gone is kept away from the guess, so it reads as unanswered
    // until the user answers it
    const answerableCategories = importedCategories.filter((category) => !clearedCategorySources.has(category))
    const created = new Set(createdCategoryIds)
    const knownBeforeImport = (categories ?? []).filter((category) => !created.has(category.id))
    const matched = canInferCategoryMappings
      ? inferCategoryMappings(answerableCategories, liveCategoryMappings, knownBeforeImport)
      : keepCurrentMatchMap(liveCategoryMappings, answerableCategories)

    // A cleared name still needs its row, just an unanswered one
    if (clearedCategorySources.size === 0) return matched

    const resolved = { ...matched }
    for (const category of importedCategories) {
      if (clearedCategorySources.has(category)) resolved[category] = ''
    }
    return resolved
  }, [
    canInferCategoryMappings,
    categories,
    clearedCategorySources,
    createdCategoryIds,
    importedCategories,
    liveCategoryMappings,
  ])

  const autoFilledCategories = useMemo(
    () =>
      new Set(
        importedCategories.filter(
          (category) => !liveCategoryMappings[category] && Boolean(resolvedCategoryMappings[category]),
        ),
      ),
    [importedCategories, liveCategoryMappings, resolvedCategoryMappings],
  )

  // Only the ones still present in the file, so a value the user has since stopped importing is not
  // listed as needing an answer
  const clearedCategorySourceLabels = useMemo(
    () => importedCategories.filter((category) => clearedCategorySources.has(category)),
    [clearedCategorySources, importedCategories],
  )

  const categoryRenames = useMemo(
    () =>
      getCsvCategoryRenames({
        importedCategories,
        mappings: resolvedCategoryMappings,
        createKinds: categoryCreateKinds,
        typesBySource: categoryTypesBySource,
        typedNames: categoryCreateNames,
        categoryById,
      }),
    [
      categoryById,
      categoryCreateKinds,
      categoryCreateNames,
      categoryTypesBySource,
      importedCategories,
      resolvedCategoryMappings,
    ],
  )

  // Which rows the import refuses, judged without the tag answers because those are about the names
  // the rows that import carry. A row refused for any reason is not written, so the tag step asks
  // about the spellings of the rows that are
  const refusedRowCells = useMemo(
    () =>
      buildTransactionImportPayload({
        accountById,
        accountCreateCurrencies: resolvedAccountCreateCurrencies,
        accountCreateInstitutions,
        accountCreateTypes,
        accountMappings: resolvedAccountMappings,
        accountSources: accountMappingSources,
        categoryById,
        categoryCreateKinds,
        categoryMappings: resolvedCategoryMappings,
        categoryRenames,
        categoryTypesBySource,
        columnMap,
        columnValidationErrors: resolvedColumnValidationErrors,
        currencies,
        dateFormat,
        timeZone,
        dateRange,
        amountFormat,
        directionAnswers,
        files,
        importedCategories,
      }).rowProblems.map((problem) => problem.cells),
    [
      accountById,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappingSources,
      amountFormat,
      categoryById,
      categoryCreateKinds,
      categoryRenames,
      categoryTypesBySource,
      columnMap,
      currencies,
      dateFormat,
      dateRange,
      directionAnswers,
      files,
      importedCategories,
      resolvedAccountCreateCurrencies,
      resolvedAccountMappings,
      resolvedCategoryMappings,
      resolvedColumnValidationErrors,
      timeZone,
    ],
  )

  const importedTags = useMemo(
    () => getImportedTags(files, columnMap.tag_ids, excludeRefusedRows(isRowIncluded, refusedRowCells)),
    [columnMap.tag_ids, files, isRowIncluded, refusedRowCells],
  )

  // Held under the spelling shown when each was given, which a date range can leave out of the rows
  // while another spelling of the same tag stays, so they are read and written under the spelling
  // the step asks about now
  const tagMappings = useMemo(
    () => alignNameAnswersWithValues(readScopedImportAnswers(scopedTagMappings, getTagSourceScope), importedTags),
    [getTagSourceScope, importedTags, scopedTagMappings],
  )

  const tagCreateNames = useMemo(
    () => alignNameAnswersWithValues(readScopedImportAnswers(scopedTagCreateNames, getTagSourceScope), importedTags),
    [getTagSourceScope, importedTags, scopedTagCreateNames],
  )

  const setTagMappings: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedTagMappings((current) => {
      const answers = alignNameAnswersWithValues(readScopedImportAnswers(current, getTagSourceScope), importedTags)
      return writeScopedImportAnswers(
        current,
        typeof update === 'function' ? update(answers) : update,
        getTagSourceScope,
      )
    })
  }

  const setTagCreateNames: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedTagCreateNames((current) => {
      const answers = alignNameAnswersWithValues(readScopedImportAnswers(current, getTagSourceScope), importedTags)
      return writeScopedImportAnswers(
        current,
        typeof update === 'function' ? update(answers) : update,
        getTagSourceScope,
      )
    })
  }

  const {
    matchedTagByKey,
    tagMatchesLoading,
    tagMatchesFailed,
    refetchTagMatches,
    tagOptions,
    rememberPickedTag,
    tagSearch,
    setTagSearch,
    tagSearchLoading,
    hasMoreTagResults,
    loadMoreTagResults,
  } = useImportTagMatches(importedTags)

  // What each tag a row can be pointed at is called, for the preview to show the tag it will carry
  const tagLabelById = useMemo(() => new Map(tagOptions.map((option) => [option.value, option.label])), [tagOptions])

  const importBuild = useMemo(
    () =>
      buildTransactionImportPayload({
        accountById,
        accountCreateCurrencies: resolvedAccountCreateCurrencies,
        accountCreateInstitutions,
        accountCreateTypes,
        accountMappings: resolvedAccountMappings,
        accountSources: accountMappingSources,
        categoryById,
        categoryCreateKinds,
        categoryMappings: resolvedCategoryMappings,
        categoryRenames,
        categoryTypesBySource,
        columnMap,
        columnValidationErrors: resolvedColumnValidationErrors,
        currencies,
        dateFormat,
        timeZone,
        dateRange,
        amountFormat,
        directionAnswers,
        files,
        importedCategories,
        merchantAnswers: {
          importedMerchants,
          matchedMerchantByKey,
          merchantMappings,
          merchantCreateNames,
        },
        tagAnswers: {
          importedTags,
          matchedTagByKey,
          tagMappings,
          tagCreateNames,
        },
      }),
    [
      accountById,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappingSources,
      categoryById,
      categoryCreateKinds,
      categoryRenames,
      categoryTypesBySource,
      currencies,
      columnMap,
      dateFormat,
      dateRange,
      amountFormat,
      directionAnswers,
      files,
      importedCategories,
      importedMerchants,
      importedTags,
      matchedMerchantByKey,
      matchedTagByKey,
      merchantCreateNames,
      merchantMappings,
      tagCreateNames,
      tagMappings,
      resolvedAccountCreateCurrencies,
      resolvedAccountMappings,
      resolvedCategoryMappings,
      resolvedColumnValidationErrors,
      timeZone,
    ],
  )

  // Built after the payload so both read one decision about which rows can be converted, rather
  // than the preview coercing an unreadable amount to zero beside the entry refusing that row
  const previewRows = useMemo<PreviewTransactionRow[]>(
    () =>
      buildImportPreviewRows({
        files,
        columnMap,
        dateFormat,
        timeZone,
        dateRange,
        amountFormat,
        directionAnswers,
        missingRequiredColumnLabels,
        currencies,
        accountById,
        accountCreateCurrencies: resolvedAccountCreateCurrencies,
        accountCreateInstitutions,
        categoryById,
        categoryCreateKinds,
        categoryRenames,
        categoryTypesBySource,
        institutionById,
        resolvedAccountMappings,
        resolvedCategoryMappings,
        rowProblems: importBuild.rowProblems,
        tagAnswers: { importedTags, matchedTagByKey, tagMappings, tagCreateNames, tagLabelById },
      }),
    [
      importedTags,
      matchedTagByKey,
      tagCreateNames,
      tagLabelById,
      tagMappings,
      accountById,
      accountCreateInstitutions,
      amountFormat,
      categoryById,
      categoryCreateKinds,
      categoryRenames,
      categoryTypesBySource,
      columnMap,
      currencies,
      dateFormat,
      dateRange,
      directionAnswers,
      files,
      importBuild.rowProblems,
      institutionById,
      missingRequiredColumnLabels,
      resolvedAccountCreateCurrencies,
      resolvedAccountMappings,
      resolvedCategoryMappings,
      timeZone,
    ],
  )

  const previewGroups = useMemo(() => groupPreviewRowsByDate(previewRows), [previewRows])

  const totalRows = files.reduce((sum, file) => sum + file.rows.length, 0)
  const importStats = getCsvImportStats({
    rowCount: totalRows,
    outsideRangeRowCount,
    importBuild,
    accountSources: accountMappingSources,
    accountMappings: resolvedAccountMappings,
    importedCategories,
    categoryMappings: resolvedCategoryMappings,
    categoryById: categoriesBeforeImport,
    categoryCreateKinds,
    categoryRenames,
    categoryTypesBySource,
  })
  const mappedFieldCount = headers.length === 0 ? 0 : Object.values(columnMap).filter(Boolean).length

  // On an account's import a file is matched against the saved layouts as it is read, so it waits for
  // them as it waits for the currencies, rather than opening with detection's settings where saved
  // ones exist. The list read when the page opens counts, and so does one an import or undo has since
  // asked to read again, once that reload is in, since the file just imported is the one most likely
  // to come next. If reading them fails, the file is read by detection alone, as if none were saved
  const uploadBlockReason =
    getImportUploadBlockReason(currencies, currenciesError) ??
    (isAccountFixed
      ? getImportLayoutsUploadBlockReason(
          importLayouts.isError || (importLayouts.isFetchedAfterMount && !importLayouts.isStale),
        )
      : null)

  const canCommitImport = run.canCommit({
    hasPayload: importBuild.payload !== null,
    isProcessingFile: isProcessingFiles,
    blockReason: dateRangeBlockReason,
  })

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
    setCategoryAutoMatchKey(nextColumnMap.category_id || NO_CATEGORY_COLUMN_MATCH_KEY)
  }

  /** Moves both format answers to the file and relevant columns being applied */
  const moveFormatChoicesTo = (nextColumnMap: ColumnMap, nextFiles: ImportFileDraft[]) => {
    setDateFormatChoice((current) =>
      moveImportFormatChoiceToScope(current, buildImportDateFormatScope(nextColumnMap, nextFiles)),
    )
    setAmountFormatChoice((current) =>
      moveImportFormatChoiceToScope(current, buildImportAmountFormatScope(nextColumnMap, nextFiles)),
    )
  }

  /**
   * Marks everything in flight as belonging to a workflow that has been replaced
   */
  const startWorkflowRun = () => {
    workflowRunRef.current += 1
    return workflowRunRef.current
  }

  const isCurrentWorkflowRun = (run: number) => workflowRunRef.current === run

  /**
   * Takes a new set of staged files, re-reading the column mapping against them
   *
   * Every setter is called with a value worked out here rather than from inside another setter, so
   * none of them has to be re-run to reach the same state
   */
  const applyStagedFiles = (
    nextFiles: ImportFileDraft[],
    { startFresh = false, remembered }: { startFresh?: boolean; remembered?: RememberedImportLayout | null } = {},
  ) => {
    // A saved layout's settings stand for every column, the ones it leaves unmapped included, so
    // nothing is guessed over them and they count as answered, as the user's own answers do
    const settings = remembered?.settings ?? null
    const decidedHeaders = settings ? new Set(nextFiles.flatMap((file) => file.headers)) : null

    // A file read again with another separator has other columns, so the column mapping and format
    // answers start over rather than carry across to headings that only share a name. The account,
    // category and merchant answers stay, since they are held by the value's text and only reapply to
    // the same values
    const isStartingOver = startFresh || settings !== null
    const baseColumnMap = settings?.columnMap ?? (startFresh ? EMPTY_COLUMN_MAP : columnMap)
    const result = inferColumnMap(
      baseColumnMap,
      nextFiles,
      supportedCurrencyCodes,
      decidedHeaders ?? (startFresh ? new Set() : decidedColumnHeaders),
      {
        omitAccountColumn: isAccountFixed,
      },
    )

    setFiles(nextFiles)
    setStoredColumnMap(result.map)
    if (isStartingOver) {
      setDecidedColumnHeaders(decidedHeaders ?? new Set())
      setDateFormatChoice(createImportFormatChoiceState(''))
      setAmountFormatChoice(createImportFormatChoiceState(''))
    }
    moveFormatChoicesTo(result.map, nextFiles)
    if (settings) {
      setDateFormatChoice(chooseImportFormat(buildImportDateFormatScope(result.map, nextFiles), settings.dateFormat))
      setAmountFormatChoice(
        chooseImportFormat(buildImportAmountFormatScope(result.map, nextFiles), settings.amountFormat),
      )
    }
    setColumnValidationErrors(result.errors)

    // Every column a saved layout mapped is shown as filled in by the app, until the user answers it
    setAutoFilledColumnHeaders((current) =>
      getNextAutoFilledColumnHeaders(
        isStartingOver ? new Set() : current,
        settings ? EMPTY_COLUMN_MAP : baseColumnMap,
        result.map,
      ),
    )
    syncAutoMatchKeys(result.map, result.errors, nextFiles)
  }

  /**
   * Reads each file chosen, in order, the way the staged files were read
   *
   * The header row and the lines left out at the end are one setting for all the files, so a file is
   * read with the first file's. The separator is left to be found, so a file using another one
   * comes out with other columns and is refused for them instead of failing to read. The first file of
   * a fresh import is also looked up among the saved layouts, so a file with saved headers sets the
   * reading the others follow
   */
  const readStagingCandidates = async (selectedFiles: File[], stagedFirst: ImportFileDraft | undefined) => {
    const candidates: StagingCandidate[] = []
    let remembered: RememberedImportLayout | null = null
    let layout = stagedFirst
    for (const source of selectedFiles) {
      const choices = layout?.reading && !layout.error ? getSharedReadingChoices(layout.reading) : {}
      const options = { requireDataRows: true, offersReadingChoices: true, ...choices }
      let draft: ImportFileDraft
      if (layout) {
        draft = await readCsvFile(source, supportedCurrencyCodes, options)
      } else {
        const read = await readCsvFileWithLayout(source, supportedCurrencyCodes, options, rememberedLayouts)
        draft = read.draft
        remembered = read.layout
      }
      candidates.push({ draft, source })
      layout ??= draft
    }
    return { candidates, remembered }
  }

  const handleFileChange = async (acquiredFiles: ImportFileAcquisition) => {
    const intake = await processImportFileIntake({
      files: acquiredFiles,
      processing: isProcessingFiles,
      unavailableReason: uploadBlockReason?.message ?? null,
      fileType: SEVERAL_CSV_IMPORT_FILE_TYPE,
      readFiles: async (selectedFiles) => {
        const workflowRun = startWorkflowRun()
        setFileIntakeError(null)
        setIsProcessingFiles(true)

        try {
          // Files uploaded over a finished import start a new one, so the record of the last import
          // gives way to them and their columns are read as on a first upload, over the whole file
          const isReplacingFinishedImport = run.workflow.importResult !== null
          const stagedFiles = isReplacingFinishedImport ? [] : files
          const [{ candidates, remembered }] = await Promise.all([
            readStagingCandidates(selectedFiles, stagedFiles[0]),
            waitForMilliseconds(CSV_PROCESSING_MIN_MS),
          ])

          // The workflow can be reset while the files are being read, and a file staged into the flow
          // that replaced it is one the user believes they discarded
          if (!isCurrentWorkflowRun(workflowRun)) return

          const staged = stagedFiles.flatMap((draft) => {
            const source = sourceFilesRef.current.get(draft.id)
            return source ? [{ draft, source }] : []
          })
          const { accepted, refusals } = stageImportFiles(staged, candidates)
          if (refusals.length > 0) setFileIntakeError(refusals.join(' '))
          if (accepted.length === 0) return

          if (isReplacingFinishedImport) {
            run.resetImportRun()
            resetDateRange()
            sourceFilesRef.current = new Map()
          }
          for (const { draft, source } of accepted) sourceFilesRef.current.set(draft.id, source)
          // A saved layout applies only when the file it was found for is the one staged first
          const isRememberedFileStaged = accepted[0]?.draft === candidates[0]?.draft
          applyStagedFiles([...stagedFiles, ...accepted.map(({ draft }) => draft)], {
            startFresh: isReplacingFinishedImport,
            remembered: isRememberedFileStaged ? remembered : null,
          })
        } finally {
          if (isCurrentWorkflowRun(workflowRun)) setIsProcessingFiles(false)
        }
      },
    })

    if (intake.status === 'refused') setFileIntakeError(intake.reason)
  }

  const removeFile = (fileId: string) => {
    // A re-read still running belongs to the file being removed, so it must not stage it again
    startWorkflowRun()
    setIsProcessingFiles(false)
    sourceFilesRef.current.delete(fileId)
    const remainingFiles = removeStagedFile(files, fileId)
    // With no file left the layout and the chosen dates are cleared, so the next file is read as on a
    // first upload and no range carries over to it
    if (remainingFiles.length === 0) resetDateRange()
    applyStagedFiles(remainingFiles, { startFresh: remainingFiles.length === 0 })
  }

  /**
   * Reads every staged file again with the reading choices given, which are one setting for all of
   * them, starting the column mapping over where the columns can have changed
   */
  const rereadFiles = async (choices: CsvReadingChoices & { delimiter?: ImportDelimiter }, startFresh: boolean) => {
    const sourceFiles = files.flatMap((file) => sourceFilesRef.current.get(file.id) ?? [])
    if (sourceFiles.length === 0 || sourceFiles.length !== files.length || isProcessingFiles) return

    const workflowRun = startWorkflowRun()
    setIsProcessingFiles(true)
    try {
      const readDrafts = await Promise.all(
        sourceFiles.map((sourceFile) =>
          readCsvFile(sourceFile, supportedCurrencyCodes, {
            requireDataRows: true,
            offersReadingChoices: true,
            ...choices,
          }),
        ),
      )
      if (!isCurrentWorkflowRun(workflowRun)) return
      // The files are checked against each other again, since the new choices can give one other
      // headings or push the total past a limit, and a file that no longer fits stays staged with
      // that as its error. Each keeps its id, which the staged list draws it by, rather than leaving
      // and returning as another file
      const restaged = restageImportFiles(
        readDrafts.map((draft, index) => ({
          draft: { ...draft, id: files[index].id, identityId: files[index].identityId },
          source: sourceFiles[index],
        })),
      )
      sourceFilesRef.current = new Map(restaged.map(({ draft, source }) => [draft.id, source]))
      applyStagedFiles(
        restaged.map(({ draft }) => draft),
        { startFresh },
      )
    } finally {
      if (isCurrentWorkflowRun(workflowRun)) setIsProcessingFiles(false)
    }
  }

  // Choosing the separator already in use keeps the answers. Another
  // separator finds the header row again, since the lines above the table split differently
  const changeDelimiter = (delimiter: ImportDelimiter) => {
    const staged = files[0]
    if (delimiter === staged?.delimiter) return
    void rereadFiles({ delimiter, skipLastRows: getChosenSkipLastRows(staged?.reading) }, true)
  }

  const changeHeaderRow = (headerRow: number) => {
    const staged = files[0]
    if (!staged?.reading || headerRow === staged.reading.headerRow) return
    void rereadFiles(
      { delimiter: staged.delimiter, headerRow, skipLastRows: getChosenSkipLastRows(staged.reading) },
      true,
    )
  }

  // Leaving out lines at the end keeps the headings, so the column answers carry over. A file read
  // without a heading row is looked at again rather than given one
  const changeSkipLastRows = (skipLastRows: number) => {
    const staged = files[0]
    if (!staged?.reading || skipLastRows === staged.reading.skipLastRows) return
    void rereadFiles(
      { delimiter: staged.delimiter, headerRow: staged.reading.headerRow ?? undefined, skipLastRows },
      false,
    )
  }

  const updateColumnTarget = (header: string, targetValue: string) => {
    const validation = targetValue
      ? validateColumnValues(files, header, targetValue as ColumnTarget, supportedCurrencyCodes)
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

    // The column the answer was about, and the one it took the field from, are both answered now
    setDecidedColumnHeaders((current) => {
      const next = new Set(current).add(header)
      if (displacedHeader) next.add(displacedHeader)
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
    setStoredColumnMap(nextColumnMap)
    moveFormatChoicesTo(nextColumnMap, files)
  }

  const handleCommitImport = async () => {
    // A click that no pointer press, key or focus came before, as an assistive technology's is, finds
    // the dates still being edited. The range on screen is taken and the commit is made from the
    // render that holds it, so the import never goes out with an earlier range or is dropped
    isCommitAfterDatesRef.current = true
    if (applyDateRange()) return
    isCommitAfterDatesRef.current = false
    const payload = importBuild.payload

    // A payload is only built once the range can be applied, so the count is known whenever there is one
    if (!payload || !canCommitImport || outsideRangeRowCount === null) return

    // Saved by the commit for the account the import was started from, so the next file with these
    // headers opens with the settings this one was imported with. An ordinary import saves none
    const csvLayout =
      isAccountFixed && files.length === 1 && dateFormat && amountFormat
        ? buildCsvImportLayout(files[0], columnMap, dateFormat, amountFormat)
        : null

    await run.startImport(importBuild.rowProblems, outsideRangeRowCount, {
      upload: (signal, onStaged) =>
        importTransactions.mutateAsync({
          payload,
          signal,
          onStaged,
          fileName: getImportFileName(labelStagedFiles(files)),
          csvLayout: csvLayout ?? undefined,
        }),
      commit: (runId, signal) => commitStagedImport.mutateAsync({ runId, signal }),
    })
  }

  // Runs after the render that took the dates, so the commit reads the build made from them
  useEffect(() => {
    if (!isCommitAfterDatesRef.current) return
    isCommitAfterDatesRef.current = false
    void handleCommitImport()
  })

  /**
   * Clears the import for a fresh start, keeping an upload an interrupted save left for the next
   * import on this screen to settle, since dropping it could not tell whether it had landed
   */
  const resetImportWorkflow = () => {
    startWorkflowRun()
    run.resetImportRun()
    setFiles([])
    sourceFilesRef.current = new Map()
    setIsProcessingFiles(false)
    setFileIntakeError(null)
    setAutoFilledColumnHeaders(new Set())
    setDecidedColumnHeaders(new Set())
    setStoredColumnMap(EMPTY_COLUMN_MAP)
    setScopedAccountMappings(emptyScopedImportAnswers)
    setAccountAutoMatchKey('')
    resetAccountCreateState()
    setColumnValidationErrors({})
    setDateFormatChoice(createImportFormatChoiceState(''))
    resetDateRange()
    setAmountFormatChoice(createImportFormatChoiceState(''))
    setScopedDirectionAnswers(emptyScopedImportAnswers)
    setScopedCategoryMappings(emptyScopedImportAnswers)
    setCategoryAutoMatchKey('')
    setScopedCategoryCreateKinds(emptyScopedImportAnswers)
    setScopedCategoryCreateNames(emptyScopedImportAnswers)
    setScopedMerchantMappings(emptyScopedImportAnswers)
    setScopedMerchantCreateNames(emptyScopedImportAnswers)
    setScopedTagMappings(emptyScopedImportAnswers)
    setScopedTagCreateNames(emptyScopedImportAnswers)
    if (inputRef.current) inputRef.current.value = ''
  }

  return {
    inputRef,
    files,
    isProcessingFiles,
    fileIntakeError,
    autoFilledColumnHeaders,
    columnMap,
    fixedAccount,
    accountMappings: resolvedAccountMappings,
    archivedAccountMatches,
    autoFilledAccountSources,
    handAnsweredAccountSources,
    accountCreateTypes,
    accountCreateCurrencies: resolvedAccountCreateCurrencies,
    accountCreateInstitutions,
    selectedAccountRows,
    batchAccountType,
    batchAccountCurrency,
    batchAccountInstitution,
    columnValidationErrors: resolvedColumnValidationErrors,
    dateFormat,
    dateFormatAutomatic,
    dateFormatScan,
    setDateFormat,
    dateRange: shownDateRange,
    isDateRangeCrossed,
    dateRangeBlockReason,
    outsideRangeRowCount,
    setDateRangeEnd,
    setIsPointerInDatePanel,
    amountFormat,
    amountFormatAutomatic,
    amountFormatScan,
    setAmountFormat,
    directionValues,
    directionAnswers,
    autoFilledDirectionValues,
    setDirectionAnswer,
    categoryMappings: resolvedCategoryMappings,
    categoryCreateKinds,
    categoryRenames,
    merchantMappings,
    merchantCreateNames,
    matchedMerchantByKey,
    merchantOptions,
    rememberPickedMerchant,
    merchantSearch,
    merchantSearchLoading,
    hasMoreMerchantResults,
    loadMoreMerchantResults,
    matchesLoading,
    matchesFailed,
    refetchMatches,
    tagMappings,
    tagCreateNames,
    matchedTagByKey,
    tagOptions,
    rememberPickedTag,
    tagSearch,
    tagSearchLoading,
    hasMoreTagResults,
    loadMoreTagResults,
    tagMatchesLoading,
    tagMatchesFailed,
    refetchTagMatches,
    ...run.workflow,
    latestStartSuggestion,
    accountsLoading,
    currenciesLoading,
    uploadBlockReason,
    accountsFailed,
    categoriesFailed,
    refetchAccounts,
    refetchCategories,
    clearedAccountSourceLabels,
    clearedCategorySourceLabels,
    institutionsLoading,
    categoriesLoading,
    accountOptions,
    counterpartyAccountOptions,
    currencyOptions,
    institutionOptions,
    categoryMatchOptions,
    accountById,
    categoryById,
    categoriesBeforeImport,
    headers,
    missingRequiredColumnLabels,
    columnTargetOptions,
    rowsWithNoMerchantCount,
    accountMappingSources,
    importedCategories,
    importedMerchants,
    categoryTypesBySource,
    importedTags,
    autoFilledCategories,
    previewRows,
    previewGroups,
    importStats,
    importBuild,
    totalRows,
    mappedFieldCount,
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
    setCategoryCreateNames,
    setMerchantMappings,
    setMerchantCreateNames,
    setMerchantSearch,
    setTagMappings,
    setTagCreateNames,
    setTagSearch,
    handleFileChange,
    changeDelimiter,
    changeHeaderRow,
    changeSkipLastRows,
    removeFile,
    updateSourceAccount,
    updateColumnTarget,
    handleCommitImport,
    resetImportWorkflow,
  }
}

export type TransactionImportWorkflow = ReturnType<typeof useTransactionImportWorkflow>
