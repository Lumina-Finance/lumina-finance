import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import {
  discardStagedRun,
  useCommitStagedImport,
  useImportTransactions,
  type TransactionImportResponse,
} from '@/api/transaction-imports'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_LABEL, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, ImportCategoryKind, ImportFileDraft, ImportOverlayPhase, PreviewTransactionRow } from '@/pages/imports/types'
import {
  applyCreateAccountFallback,
  buildColumnTargetOptions,
  buildImportAnswerScope,
  buildImportAccountMappingSources,
  buildImportAccountOptions,
  buildTransactionImportPayload,
  buildImportPreviewRows,
  countRowsWithNoPayee,
  formatImportSummary,
  getArchivedAccountMatches,
  dropVanishedAccountMappings,
  dropVanishedCategoryMappings,
  getImportedCategoryTypes,
  getImportedCategories,
  getImportedMerchants,
  getImportedTags,
  getImportAccountRowState,
  getImportHeaders,
  getStatedCurrencyByAccountSource,
  getColumnValues,
  getMissingRequiredColumnLabels,
  getNextAutoFilledColumnHeaders,
  getNextColumnMap,
  getImportCommitFailure,
  getImportUploadBlockReason,
  getNextColumnValidationErrors,
  getSupportedCurrencyCodes,
  inferAccountMappings,
  inferCategoryMappings,
  isAutoFilledAccountSource,
  isColumnMappingComplete,
  groupPreviewRowsByDate,
  inferColumnMap,
  type ImportDateFormat,
  keepCurrentMatchMap,
  readCsvFile,
  readScopedImportAnswers,
  resolveImportAccountCreateCurrencies,
  scanImportDateFormats,
  validateColumnValues,
  writeScopedImportAnswers,
  emptyScopedImportAnswers,
  type ScopedImportAnswers,
} from '@/pages/imports/utils'
import { waitForMilliseconds } from '@/utils/timing'
import { useImportAccountCreateState } from './useImportAccountCreateState'
import { useImportMerchantMatches } from './useImportMerchantMatches'
import { useImportReferenceData } from './useImportReferenceData'

/**
 * A date format the user picked, tagged with the column and files it was picked for
 */
interface DateFormatChoice {
  scope: string
  format: ImportDateFormat
}

const FILE_ACCOUNT_MATCH_KEY = '__file_account__'

// Stands in while a reference list has not arrived, so nothing is treated as cleared and the memos
// below keep the same identity from render to render
const NO_CLEARED_SOURCES: Set<string> = new Set()
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

  // Columns the user has answered for, so replacing the file with one carrying the same headings
  // leaves their answers alone instead of guessing over them. A column set to Do not import counts
  // as answered, which is the case an empty mapping cannot tell apart on its own
  const [decidedColumnHeaders, setDecidedColumnHeaders] = useState<Set<string>>(() => new Set())
  const [columnMap, setColumnMap] = useState<ColumnMap>(EMPTY_COLUMN_MAP)

  const [scopedAccountMappings, setScopedAccountMappings] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [accountAutoMatchKey, setAccountAutoMatchKey] = useState('')

  const accountMappingSources = useMemo(
    () => buildImportAccountMappingSources(files, columnMap.account_id, columnMap.counterparty_account_id),
    [columnMap.account_id, columnMap.counterparty_account_id, files],
  )

  // The account sources come from two columns, so an answer is about whichever of them supplied it
  // and survives the other one changing. The date format choice answers to its own column the same
  // way, and this is that idea for a set of sources that has more than one origin
  const rowAccountAnswerScope = buildImportAnswerScope(columnMap.account_id, files)
  const counterpartyAnswerScope = buildImportAnswerScope(columnMap.counterparty_account_id, files)
  const categoryAnswerScope = buildImportAnswerScope(columnMap.category_id, files)
  const merchantAnswerScope = buildImportAnswerScope(columnMap.merchant_id, files)

  const counterpartyOnlySourceIds = useMemo(
    () => new Set(accountMappingSources.filter((source) => source.isCounterpartyOnly).map((source) => source.id)),
    [accountMappingSources],
  )

  // Both resolvers are held steady, since the answers read through them reach the commit payload
  // and the preview, and a new function each render would rebuild those on every keystroke
  const getAccountSourceScope = useMemo(
    () => (sourceId: string) => (
      counterpartyOnlySourceIds.has(sourceId) ? counterpartyAnswerScope : rowAccountAnswerScope
    ),
    [counterpartyAnswerScope, counterpartyOnlySourceIds, rowAccountAnswerScope],
  )

  const getCategorySourceScope = useMemo(() => () => categoryAnswerScope, [categoryAnswerScope])
  const getMerchantSourceScope = useMemo(() => () => merchantAnswerScope, [merchantAnswerScope])

  const accountMappings = useMemo(
    () => readScopedImportAnswers(scopedAccountMappings, getAccountSourceScope),
    [getAccountSourceScope, scopedAccountMappings],
  )

  const setAccountMappings: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedAccountMappings((current) => {
      const answers = readScopedImportAnswers(current, getAccountSourceScope)
      return writeScopedImportAnswers(current, typeof update === 'function' ? update(answers) : update, getAccountSourceScope)
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
  const [merchantHandlingOpen, setMerchantHandlingOpen] = useState(true)
  const [tagHandlingOpen, setTagHandlingOpen] = useState(true)
  const [columnValidationErrors, setColumnValidationErrors] = useState<ColumnValidationErrors>({})

  const [dateFormatChoice, setDateFormatChoice] = useState<DateFormatChoice | null>(null)
  const [scopedCategoryMappings, setScopedCategoryMappings] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [categoryAutoMatchKey, setCategoryAutoMatchKey] = useState('')
  const [scopedCategoryCreateKinds, setScopedCategoryCreateKinds] = useState<ScopedImportAnswers<ImportCategoryKind>>(emptyScopedImportAnswers)

  // What the user answered for each payee value, and the name they wrote for one being created.
  // Scoped like every other answer, so a second file's payees start unanswered
  const [scopedMerchantMappings, setScopedMerchantMappings] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [scopedMerchantCreateNames, setScopedMerchantCreateNames] = useState<ScopedImportAnswers<string>>(emptyScopedImportAnswers)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<TransactionImportResponse | null>(null)
  const [importOverlayPhase, setImportOverlayPhase] = useState<ImportOverlayPhase>('idle')

  // Read by the actions rather than the phase itself, for the same reason as the staged run below:
  // the overlay holds a finished phase on screen while it hands over to the next one, and a button
  // pressed in that moment carries a guard that was true when it was rendered
  const importOverlayPhaseRef = useRef<ImportOverlayPhase>('idle')

  // A commit that stopped for a reason committing again could clear leaves the file staged, and
  // this is what the second attempt runs against
  const [stagedRunId, setStagedRunId] = useState<string | null>(null)

  // The overlay keeps its buttons on screen while it fades out, and each one carries the handler
  // from the render before it closed, so an action reads the run from here rather than from what
  // its own render captured. Without this, Try again pressed inside the fade commits a run that
  // Back to import has already dropped
  const stagedRunIdRef = useRef<string | null>(null)
  const commitAbortRef = useRef<AbortController | null>(null)

  // Whether the request can still be given up on, which stops being true the moment it settles
  // while the overlay is still held open for the rest of its minimum
  const [canStopImport, setCanStopImport] = useState(false)

  // Tells a finished file read or commit whether the workflow it started in is still the one on
  // screen, so a reset in between drops its result instead of writing into what replaced it
  const workflowRunRef = useRef(0)
  const importTransactions = useImportTransactions()
  const commitStagedImport = useCommitStagedImport()

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
      return writeScopedImportAnswers(current, typeof update === 'function' ? update(answers) : update, getCategorySourceScope)
    })
  }

  const setCategoryCreateKinds: Dispatch<SetStateAction<Record<string, ImportCategoryKind>>> = (update) => {
    setScopedCategoryCreateKinds((current) => {
      const answers = readScopedImportAnswers(current, getCategorySourceScope)
      return writeScopedImportAnswers(current, typeof update === 'function' ? update(answers) : update, getCategorySourceScope)
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
      return writeScopedImportAnswers(current, typeof update === 'function' ? update(answers) : update, getMerchantSourceScope)
    })
  }

  const setMerchantCreateNames: Dispatch<SetStateAction<Record<string, string>>> = (update) => {
    setScopedMerchantCreateNames((current) => {
      const answers = readScopedImportAnswers(current, getMerchantSourceScope)
      return writeScopedImportAnswers(current, typeof update === 'function' ? update(answers) : update, getMerchantSourceScope)
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

  const supportedCurrencyCodes = useMemo(
    () => getSupportedCurrencyCodes(currencies),
    [currencies],
  )

  // What each account source's own rows say its currency is, which is what a row creating an
  // account starts out holding
  const statedAccountCurrencies = useMemo(
    () => getStatedCurrencyByAccountSource(files, columnMap.account_id, columnMap.currency, supportedCurrencyCodes),
    [columnMap.account_id, columnMap.currency, files, supportedCurrencyCodes],
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

  // Counted off the files and the merchant column alone, so the mapping step can say how many rows
  // will be filed under a merchant that ships with the app without waiting on the account and
  // category answers the payload build needs
  const rowsWithNoPayeeCount = useMemo(
    () => countRowsWithNoPayee(files, columnMap.merchant_id),
    [columnMap.merchant_id, files],
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
    () => (columnMap.dt ? validateColumnValues(files, columnMap.dt, 'dt', supportedCurrencyCodes, dateFormat) : null),
    [columnMap.dt, dateFormat, files, supportedCurrencyCodes],
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

  // Only a source no row is written to can answer that the money left the tracked accounts, so the
  // extra choice is kept off every other row's dropdown, and the same reason is why an archived
  // account is offered here and nowhere else in the flow
  const counterpartyAccountOptions = useMemo(
    () => [
      { value: OUTSIDE_ACCOUNT_VALUE, label: OUTSIDE_ACCOUNT_LABEL, group: 'Import Action' },
      ...buildImportAccountOptions(allAccounts),
    ],
    [allAccounts],
  )

  const canInferAccountMappings = Boolean(accountAutoMatchKey)
    && accountAutoMatchKey === (columnMap.account_id || FILE_ACCOUNT_MATCH_KEY)

  const { mappings: liveAccountMappings, clearedSources: clearedAccountSources } = useMemo(
    () => (accountsResolved
      ? dropVanishedAccountMappings(accountMappings, accountById)
      : { mappings: accountMappings, clearedSources: NO_CLEARED_SOURCES }),
    [accountById, accountMappings, accountsResolved],
  )

  const matchedAccountMappings = useMemo(
    () => {
      // A source whose account has gone is kept away from the name match, so it can never come back
      // holding a different account of the user's. The create-new fallback below does cover it,
      // since the worst that answer can do is offer a new account the user still has to fill in
      const answerableSources = accountMappingSources.filter((source) => !clearedAccountSources.has(source.id))

      const resolved = canInferAccountMappings
        ? inferAccountMappings(answerableSources, liveAccountMappings, {
          rowAccounts: selectableAccounts,
          counterpartyAccounts: allAccounts,
        })
        : { ...liveAccountMappings }

      // No row is written to these, so the import creates nothing for them unless the user asks for
      // an account by hand, and the transfers pointing at them say the money left the app
      for (const source of answerableSources) {
        if (source.isCounterpartyOnly && !resolved[source.id]) resolved[source.id] = OUTSIDE_ACCOUNT_VALUE
      }
      return resolved
    },
    [accountMappingSources, allAccounts, canInferAccountMappings, clearedAccountSources, liveAccountMappings, selectableAccounts],
  )

  // Every row source the match could not place rests on creating an account, so the step asks for
  // its type rather than for all three answers. Both conditions keep a row from answering itself
  // and then changing its mind: it only ever fires alongside the name match, which is what
  // `canInferAccountMappings` says has run, and only against an accounts list that is current, so
  // a list still being refreshed cannot turn a row from creating an account into one of the user's
  const resolvedAccountMappings = useMemo(
    () => (accountsCurrent && canInferAccountMappings
      ? applyCreateAccountFallback(accountMappingSources, matchedAccountMappings)
      : matchedAccountMappings),
    [accountMappingSources, accountsCurrent, canInferAccountMappings, matchedAccountMappings],
  )

  const resolvedAccountCreateCurrencies = useMemo(
    () => resolveImportAccountCreateCurrencies(accountCreateCurrencies, resolvedAccountMappings, statedAccountCurrencies),
    [accountCreateCurrencies, resolvedAccountMappings, statedAccountCurrencies],
  )

  // The labels rather than the ids, since the notice lists them for the user, and only the sources
  // still waiting on an answer: the create-new fallback can leave a cleared row finished, and a
  // notice telling the user to answer a row they have already answered is worse than no notice
  const clearedAccountSourceLabels = useMemo(
    () => accountMappingSources
      .filter((source) => {
        if (!clearedAccountSources.has(source.id)) return false

        const value = resolvedAccountMappings[source.id] ?? ''
        return getImportAccountRowState({
          value,
          isCounterpartyOnly: source.isCounterpartyOnly,
          createType: accountCreateTypes[source.id] ?? '',
          createCurrency: resolvedAccountCreateCurrencies[source.id] ?? '',
          isArchivedAccount: accountById.get(value)?.is_archived ?? false,
        }) === 'review'
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
  const handAnsweredAccountSources = useMemo(
    () => new Set(Object.entries(liveAccountMappings).filter(([, choice]) => choice).map(([source]) => source)),
    [liveAccountMappings],
  )

  // Read before the create-new fallback, which answers every row source and would therefore leave
  // this with nothing to report, dropping the notice without a word
  const archivedAccountMatches = useMemo(
    () => getArchivedAccountMatches(accountMappingSources, matchedAccountMappings, allAccounts),
    [accountMappingSources, allAccounts, matchedAccountMappings],
  )

  const autoFilledAccountSources = useMemo(
    () => new Set(
      accountMappingSources
        .filter((source) => isAutoFilledAccountSource(
          liveAccountMappings[source.id] ?? '',
          resolvedAccountMappings[source.id] ?? '',
          source.isCounterpartyOnly,
        ))
        .map((source) => source.id),
    ),
    [accountMappingSources, liveAccountMappings, resolvedAccountMappings],
  )

  const importedCategories = useMemo(
    () => getImportedCategories(files, columnMap.category_id),
    [columnMap.category_id, files],
  )

  const importedMerchants = useMemo(
    () => getImportedMerchants(files, columnMap.merchant_id),
    [columnMap.merchant_id, files],
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
    () => getImportedCategoryTypes(files, columnMap.category_id, columnMap.amount, importedCategories),
    [columnMap.amount, columnMap.category_id, importedCategories, files],
  )

  const importedTags = useMemo(
    () => getImportedTags(files, columnMap.tag_ids),
    [columnMap.tag_ids, files],
  )

  const canInferCategoryMappings = Boolean(columnMap.category_id)
    && categoryAutoMatchKey === columnMap.category_id

  const { mappings: liveCategoryMappings, clearedSources: clearedCategorySources } = useMemo(
    () => (categoriesResolved
      ? dropVanishedCategoryMappings(categoryMappings, categoryById)
      : { mappings: categoryMappings, clearedSources: NO_CLEARED_SOURCES }),
    [categoriesResolved, categoryById, categoryMappings],
  )

  const resolvedCategoryMappings = useMemo(
    () => {
      // A name whose category has gone is kept away from the guess, so it reads as unanswered
      // until the user answers it
      const answerableCategories = importedCategories.filter((category) => !clearedCategorySources.has(category))
      const matched = canInferCategoryMappings
        ? inferCategoryMappings(answerableCategories, liveCategoryMappings, categories ?? [])
        : keepCurrentMatchMap(liveCategoryMappings, answerableCategories)

      // A cleared name still needs its row, just an unanswered one
      if (clearedCategorySources.size === 0) return matched

      const resolved = { ...matched }
      for (const category of importedCategories) {
        if (clearedCategorySources.has(category)) resolved[category] = ''
      }
      return resolved
    },
    [canInferCategoryMappings, categories, clearedCategorySources, importedCategories, liveCategoryMappings],
  )

  const autoFilledCategories = useMemo(
    () => new Set(
      importedCategories.filter((category) => !liveCategoryMappings[category] && Boolean(resolvedCategoryMappings[category])),
    ),
    [importedCategories, liveCategoryMappings, resolvedCategoryMappings],
  )

  // Only the ones still present in the file, so a value the user has since stopped importing is not
  // listed as needing an answer
  const clearedCategorySourceLabels = useMemo(
    () => importedCategories.filter((category) => clearedCategorySources.has(category)),
    [clearedCategorySources, importedCategories],
  )

  const importBuild = useMemo(
    () => buildTransactionImportPayload({
      accountById,
      accountCreateCurrencies: resolvedAccountCreateCurrencies,
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
      currencies,
      dateFormat,
      files,
      importedCategories,
      merchantAnswers: {
        importedMerchants,
        matchedMerchantByKey,
        merchantMappings,
        merchantCreateNames,
      },
    }),
    [
      accountById,
      accountCreateInstitutions,
      accountCreateTypes,
      accountMappingSources,
      categoryById,
      categoryCreateKinds,
      categoryTypesBySource,
      currencies,
      columnMap,
      dateFormat,
      files,
      importedCategories,
      importedMerchants,
      matchedMerchantByKey,
      merchantCreateNames,
      merchantMappings,
      resolvedAccountCreateCurrencies,
      resolvedAccountMappings,
      resolvedCategoryMappings,
      resolvedColumnValidationErrors,
    ],
  )

  // Built after the payload so both read one decision about which rows can be converted, rather
  // than the preview coercing an unreadable amount to zero beside the entry refusing that row
  const previewRows = useMemo<PreviewTransactionRow[]>(
    () => buildImportPreviewRows({
      files,
      columnMap,
      dateFormat,
      missingRequiredColumnLabels,
      currencies,
      accountById,
      accountCreateCurrencies: resolvedAccountCreateCurrencies,
      accountCreateInstitutions,
      categoryById,
      categoryCreateKinds,
      categoryTypesBySource,
      institutionById,
      resolvedAccountMappings,
      resolvedCategoryMappings,
      rowProblems: importBuild.rowProblems,
    }),
    [accountById, accountCreateInstitutions, categoryById, categoryCreateKinds, categoryTypesBySource, columnMap, currencies, dateFormat, files, importBuild.rowProblems, institutionById, missingRequiredColumnLabels, resolvedAccountCreateCurrencies, resolvedAccountMappings, resolvedCategoryMappings],
  )

  const previewGroups = useMemo(
    () => groupPreviewRowsByDate(previewRows),
    [previewRows],
  )

  const totalRows = files.reduce((sum, file) => sum + file.rows.length, 0)
  const mappedFieldCount = headers.length === 0 ? 0 : Object.values(columnMap).filter(Boolean).length
  const importSummary = importResult ? formatImportSummary(importResult) : ''
  const importOverlayOpen = importOverlayPhase !== 'idle'
  const isImportInFlight = importTransactions.isPending || commitStagedImport.isPending
  const canCommitImport = Boolean(importBuild.payload) && !importOverlayOpen && !isImportInFlight && !importResult

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
  const applyStagedFiles = (nextFiles: ImportFileDraft[]) => {
    const result = inferColumnMap(columnMap, nextFiles, supportedCurrencyCodes, decidedColumnHeaders)

    setFiles(nextFiles)
    setColumnMap(result.map)
    setColumnValidationErrors(result.errors)
    setAutoFilledColumnHeaders((current) => getNextAutoFilledColumnHeaders(current, columnMap, result.map))
    syncAutoMatchKeys(result.map, result.errors, nextFiles)

    // The staged file is what the last refusal was about, so it stops being true here
    setImportError(null)
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const selectedFiles = Array.from(event.target.files ?? [])
    if (selectedFiles.length === 0) return

    const workflowRun = startWorkflowRun()
    setIsProcessingFiles(true)

    try {
      const [drafts] = await Promise.all([
        Promise.all(selectedFiles.map((selectedFile) => (
          readCsvFile(selectedFile, supportedCurrencyCodes, { requireDataRows: true })
        ))),
        waitForMilliseconds(CSV_PROCESSING_MIN_MS),
      ])

      // The workflow can be reset while the file is being read, and a file staged into the flow
      // that replaced it is one the user believes they discarded
      if (!isCurrentWorkflowRun(workflowRun)) return
      applyStagedFiles(drafts.slice(0, 1))
    } finally {
      if (isCurrentWorkflowRun(workflowRun)) setIsProcessingFiles(false)
      input.value = ''
    }
  }

  const removeFile = (fileId: string) => {
    applyStagedFiles(files.filter((file) => file.id !== fileId))
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
    setColumnMap(nextColumnMap)

    // The mapping the last refusal was about has changed, so the message stops being true
    setImportError(null)
  }

  /**
   * Records the staged file a second attempt would run against, for the screen and for the actions
   */
  const setStagedRun = (runId: string | null) => {
    stagedRunIdRef.current = runId
    setStagedRunId(runId)
  }

  /**
   * Moves the overlay to a phase, for the screen and for the actions
   */
  const setOverlayPhase = (phase: ImportOverlayPhase) => {
    importOverlayPhaseRef.current = phase
    setImportOverlayPhase(phase)
  }

  /**
   * Reports a commit that stopped, keeping the run when committing it again could still work
   */
  const reportFailedCommit = (error: unknown, cancelled: boolean) => {
    const failure = getImportCommitFailure(error, cancelled)

    if (failure.discardableRunId) void discardStagedRun(failure.discardableRunId)
    setStagedRun(failure.retryableRunId)
    setImportError(failure.message)
    setOverlayPhase(cancelled ? 'cancelled' : 'error')
  }

  /**
   * Runs one attempt at writing the staged file, whether it is the first or a repeat
   */
  const runImportAttempt = async (attempt: (signal: AbortSignal) => Promise<TransactionImportResponse>) => {
    const workflowRun = startWorkflowRun()
    const controller = new AbortController()
    commitAbortRef.current = controller
    setImportError(null)
    setImportResult(null)
    setStagedRun(null)
    setCanStopImport(true)
    setOverlayPhase('importing')
    const minimumOverlay = waitForMilliseconds(IMPORT_OVERLAY_MIN_MS)

    try {
      const result = await attempt(controller.signal).finally(() => setCanStopImport(false))
      await minimumOverlay
      if (!isCurrentWorkflowRun(workflowRun)) return
      setImportResult(result)
      setOverlayPhase('success')
    } catch (error) {
      // Stopping is a decision the user has just taken, so the overlay answers it rather than
      // sitting out the rest of a minimum it was holding for an import nobody interrupted
      if (!controller.signal.aborted) await minimumOverlay
      if (!isCurrentWorkflowRun(workflowRun)) return
      reportFailedCommit(error, controller.signal.aborted)
    } finally {
      if (commitAbortRef.current === controller) commitAbortRef.current = null
    }
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || importOverlayOpen || isImportInFlight) return

    await runImportAttempt((signal) => importTransactions.mutateAsync({ payload, signal }))
  }

  const retryImportCommit = async () => {
    const runId = stagedRunIdRef.current
    if (!runId || importTransactions.isPending || commitStagedImport.isPending) return

    await runImportAttempt((signal) => commitStagedImport.mutateAsync({ runId, signal }))
  }

  /**
   * Stops an import the user no longer wants, which drops the staged file when it has not been
   * written yet, and only stops waiting once the write is under way
   */
  const cancelImport = () => {
    commitAbortRef.current?.abort()
  }

  const dismissImportOverlay = () => {
    const phase = importOverlayPhaseRef.current
    if (phase !== 'error' && phase !== 'cancelled') return

    // Leaving the import behind means giving up on the staged file as well
    if (stagedRunIdRef.current) void discardStagedRun(stagedRunIdRef.current)
    setStagedRun(null)
    setImportError(null)
    setOverlayPhase('idle')
  }

  const resetImportWorkflow = () => {
    startWorkflowRun()
    commitAbortRef.current?.abort()
    if (stagedRunIdRef.current) void discardStagedRun(stagedRunIdRef.current)
    setStagedRun(null)
    setCanStopImport(false)
    setFiles([])
    setIsProcessingFiles(false)
    setAutoFilledColumnHeaders(new Set())
    setDecidedColumnHeaders(new Set())
    setColumnMap(EMPTY_COLUMN_MAP)
    setScopedAccountMappings(emptyScopedImportAnswers)
    setAccountAutoMatchKey('')
    resetAccountCreateState()
    setMerchantHandlingOpen(true)
    setTagHandlingOpen(true)
    setColumnValidationErrors({})
    setDateFormatChoice(null)
    setScopedCategoryMappings(emptyScopedImportAnswers)
    setCategoryAutoMatchKey('')
    setScopedCategoryCreateKinds(emptyScopedImportAnswers)
    setScopedMerchantMappings(emptyScopedImportAnswers)
    setScopedMerchantCreateNames(emptyScopedImportAnswers)
    setImportError(null)
    setImportResult(null)
    setOverlayPhase('idle')
    importTransactions.reset()
    commitStagedImport.reset()
    if (inputRef.current) inputRef.current.value = ''
  }

  // Leaving the page abandons the import: before the commit that drops the staged file, and during
  // it that only stops waiting, since the write is the server's to finish
  useEffect(() => () => commitAbortRef.current?.abort(), [])

  return {
    inputRef,
    files,
    isProcessingFiles,
    autoFilledColumnHeaders,
    columnMap,
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
    merchantHandlingOpen,
    tagHandlingOpen,
    columnValidationErrors: resolvedColumnValidationErrors,
    dateFormat,
    dateFormatScan,
    setDateFormat,
    categoryMappings: resolvedCategoryMappings,
    categoryCreateKinds,
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
    importError,
    importResult,
    importOverlayPhase,
    importOverlayOpen,
    isImportInFlight,
    canStopImport,
    canRetryImportCommit: stagedRunId !== null,
    accountsLoading,
    currenciesLoading,
    uploadBlockReason: getImportUploadBlockReason(currencies, currenciesError),
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
    headers,
    missingRequiredColumnLabels,
    columnTargetOptions,
    rowsWithNoPayeeCount,
    accountMappingSources,
    importedCategories,
    importedMerchants,
    categoryTypesBySource,
    importedTags,
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
    setMerchantMappings,
    setMerchantCreateNames,
    setMerchantSearch,
    setMerchantHandlingOpen,
    setTagHandlingOpen,
    handleFileChange,
    removeFile,
    updateSourceAccount,
    updateColumnTarget,
    handleCommitImport,
    retryImportCommit,
    cancelImport,
    dismissImportOverlay,
    resetImportWorkflow,
  }
}

export type TransactionImportWorkflow = ReturnType<typeof useTransactionImportWorkflow>
