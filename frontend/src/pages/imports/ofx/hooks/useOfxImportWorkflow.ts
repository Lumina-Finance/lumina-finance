import { useMemo, useRef, useState } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import { getImportFileName } from '@/api/import-runs'
import {
  useCommitStagedImport,
  useHeldBankTransactions,
  useImportTransactions,
  type TransactionImportResponse,
} from '@/api/transaction-imports'
import type { ImportCommitCheck } from '@/pages/imports/components'
import {
  CREATE_ACCOUNT_VALUE,
  IMPORT_SAMPLE_PREVIEW_LIMIT,
  IMPORT_TRANSFER_CATEGORY_NAME,
} from '@/pages/imports/constants'
import {
  useImportAccountCreateState,
  useImportRun,
  useProviderAccountAnswers,
  useProviderFileIntake,
  useProviderImportReferenceData,
} from '@/pages/imports/hooks'
import {
  getOfxAccountSourceScope,
  getOfxLeftOutNotice,
  getOfxMultipleStatementsReason,
  OFX_HELD_CHECK_FAILED_MESSAGE,
  OFX_HELD_CHECK_RUNNING_MESSAGE,
  OFX_IMPORT_FILE_TYPE,
  OFX_UPLOAD_LABEL,
} from '@/pages/imports/ofx/constants'
import type { OfxSkippedRow, OfxStagedFile } from '@/pages/imports/ofx/types'
import { buildOfxHeldCheck, getOfxHeldRowIds } from '@/pages/imports/ofx/utils/heldRows'
import {
  buildOfxImportPayload,
  getOfxFixedAccountMappings,
  getOfxStatementsToImport,
  type OfxImportBuild,
} from '@/pages/imports/ofx/utils/payload'
import { buildOfxPreviewRows } from '@/pages/imports/ofx/utils/preview'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { describeOfxSavedEarlier } from '@/pages/imports/ofx/utils/savedEarlier'
import { combineOfxFiles, stageOfxFiles } from '@/pages/imports/ofx/utils/stagedFiles'
import type { ImportAccountCreateDetails } from '@/pages/imports/types'
import {
  countCreatedImportSources,
  formatImportSummary,
  getImportUploadBlockReason,
  getSupportedCurrencyCodes,
  groupPreviewRowsByDate,
  labelStagedFiles,
  type ImportFileAcquisition,
} from '@/pages/imports/utils'
import { createRandomId } from '@/utils/randomId'

// Every file is a statement, so the refusals are kept under one kind
const OFX_FILE_KINDS = ['statement'] as const

/** The part of an import's answers that says which files it holds, which the run hands back untyped */
interface OfxImportAnswersSnapshot {
  stagedFiles: OfxStagedFile[]
}

const EMPTY_BUILD: OfxImportBuild = {
  errors: [],
  currencyMismatches: [],
  payload: null,
  skippedRows: [],
  writtenSources: new Set(),
}

/**
 * Drives the whole OFX import flow: reading the statement files, matching each of their
 * statements to one of the user's accounts, and saving them as one import through the same staged
 * run a CSV import uses
 *
 * The answers are given for the statements of all the files together, so files added later keep
 * them and a statement for an account an earlier file already holds joins that account's answer.
 * Removing the last file starts over, and so does choosing files once an import has finished, since
 * those files begin the next import
 *
 * @param fixedAccount - The account this import was started from, null for an ordinary import. The
 *   statement of each file goes to that account with no account step, and a file of several
 *   statements is refused
 */
export function useOfxImportWorkflow(fixedAccount: AccountsOverview | null = null) {
  const [stagedFiles, setStagedFiles] = useState<OfxStagedFile[]>([])
  const ofxFile = useMemo(
    () => (stagedFiles.length > 0 ? combineOfxFiles(stagedFiles.map(({ file }) => file)) : null),
    [stagedFiles],
  )
  const leftOutNotice = ofxFile && getOfxLeftOutNotice(ofxFile.leftOut, stagedFiles.length)
  // Counts the changes to the staged files, so files read for a list that has since changed are dropped
  const stagedFilesVersionRef = useRef(0)
  const fileIntake = useProviderFileIntake(OFX_FILE_KINDS)
  const isProcessingFile = fileIntake.processingKind !== null
  const fileIntakeError = fileIntake.intakeErrors.statement
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
    updateAccountMapping: updateOfxAccountMapping,
    resetAccountCreateState,
  } = useImportAccountCreateState(setAccountMappings, getOfxAccountSourceScope)

  // Every answer the user gives about the import, as one value that changes only when one of them
  // does. The staged files are among them, since a kept upload holds the files it was sent with
  const importAnswers = useMemo(
    () => ({ stagedFiles, accountMappings, accountCreateTypes, accountCreateCurrencies, accountCreateInstitutions }),
    [accountCreateCurrencies, accountCreateInstitutions, accountCreateTypes, accountMappings, stagedFiles],
  )

  const importTransactions = useImportTransactions()
  const commitStagedImport = useCommitStagedImport()
  const run = useImportRun<TransactionImportResponse, OfxSkippedRow>({
    answers: importAnswers,
    uploadLabel: OFX_UPLOAD_LABEL,
    mutations: [importTransactions, commitStagedImport],
    formatSummary: ({ result, skippedRowsAtCommit, outsideRangeCountAtCommit }) =>
      formatImportSummary(result, skippedRowsAtCommit.length, outsideRangeCountAtCommit),
    formatSavedEarlier: ({ answers }) =>
      describeOfxSavedEarlier((answers as OfxImportAnswersSnapshot).stagedFiles, stagedFiles),
  })

  const {
    categories,
    currencies,
    accountsLoading,
    currenciesLoading,
    currenciesError,
    accountsFailed,
    accountsResolved,
    accountsCurrent,
    refetchAccounts,
    institutionsLoading,
    selectableAccounts,
    accountOptions,
    currencyOptions,
    institutionOptions,
    accountById,
    institutionById,
  } = useProviderImportReferenceData({ transferCategoryName: IMPORT_TRANSFER_CATEGORY_NAME })

  const statements = useMemo(() => (ofxFile ? getOfxStatementsToImport(ofxFile) : []), [ofxFile])
  const supportedCurrencyCodes = useMemo(() => getSupportedCurrencyCodes(currencies), [currencies])

  // A statement carries no account name, so a name can only point at an account when it is exactly
  // the name this import gave one, and a looser match would file a statement in an unrelated account
  const matchableAccounts = useMemo(() => {
    const statementNames = new Set(statements.map((statement) => statement.name.toLowerCase()))
    return selectableAccounts.filter((account) => statementNames.has(account.name.trim().toLowerCase()))
  }, [selectableAccounts, statements])

  const accountSources = useMemo(
    () =>
      statements.map((statement) => ({
        id: statement.id,
        label: statement.label,
        matchText: statement.name,
        isCounterpartyOnly: false,
      })),
    [statements],
  )

  const {
    resolvedAccountMappings: pickedAccountMappings,
    autoFilledAccountSources,
    handAnsweredAccountSources,
  } = useProviderAccountAnswers({
    sources: accountSources,
    accountMappings,
    reference: { accountsResolved, accountsCurrent, accountById, selectableAccounts: matchableAccounts },
  })
  const resolvedAccountMappings = useMemo(
    () => (fixedAccount ? getOfxFixedAccountMappings(statements, fixedAccount) : pickedAccountMappings),
    [fixedAccount, pickedAccountMappings, statements],
  )

  // A new account is proposed in the statement's own currency, which the user can change. One this
  // app does not support is left for the user to choose, since the account could not be created in it
  const resolvedAccountCreateDetails = useMemo(() => {
    const details: Record<string, ImportAccountCreateDetails> = {}
    for (const statement of statements) {
      details[statement.id] = {
        accountType: accountCreateTypes[statement.id] ?? statement.proposedType,
        currency:
          accountCreateCurrencies[statement.id] ??
          (supportedCurrencyCodes.has(statement.currency) ? statement.currency : ''),
        institutionId: accountCreateInstitutions[statement.id] ?? '',
      }
    }
    return details
  }, [accountCreateCurrencies, accountCreateInstitutions, accountCreateTypes, statements, supportedCurrencyCodes])

  // The server alone can say which transactions an account already holds, since it keeps only hashes
  // of the bank IDs. Rows bound for a new account are never asked about
  const heldCheck = useMemo(
    () =>
      ofxFile
        ? buildOfxHeldCheck(
            ofxFile,
            stagedFiles.map(({ id }) => id),
            resolvedAccountMappings,
            accountById,
          )
        : null,
    [accountById, ofxFile, resolvedAccountMappings, stagedFiles],
  )
  // Not asked from the moment an import starts until it is reopened or replaced, so the rows it just
  // saved are never read back as already held. The run state turns on as the import starts, before
  // anything is saved, and undoing the import reopens it, which asks again
  const isHeldCheckPaused =
    run.workflow.importOverlayOpen || run.workflow.isImportInFlight || run.workflow.importResult !== null
  const heldQuery = useHeldBankTransactions(heldCheck?.scope ?? null, heldCheck?.items ?? [], isHeldCheckPaused)
  const isHeldCheckAsked = heldCheck?.scope != null && !isHeldCheckPaused
  const heldRowIds = useMemo(
    () => (heldCheck && heldQuery.data ? getOfxHeldRowIds(heldCheck, heldQuery.data.held) : undefined),
    [heldCheck, heldQuery.data],
  )

  // Commit stays off from the moment an answer is wanted until it arrives, and again if it fails or
  // the app data is refreshed and the answer is read afresh, since a held row let through as new
  // would be saved on a stale answer
  const heldCheckState: ImportCommitCheck['state'] | null = !isHeldCheckAsked
    ? null
    : heldQuery.isFetching || heldQuery.isPending
      ? 'running'
      : heldQuery.isError
        ? 'failed'
        : null
  const heldCheckNotice: ImportCommitCheck | null =
    heldCheckState === null
      ? null
      : {
          state: heldCheckState,
          message: heldCheckState === 'running' ? OFX_HELD_CHECK_RUNNING_MESSAGE : OFX_HELD_CHECK_FAILED_MESSAGE,
          onRetry: () => {
            void heldQuery.refetch()
          },
        }

  const importBuild = useMemo(
    () =>
      ofxFile
        ? buildOfxImportPayload(ofxFile, {
            accountMappings: resolvedAccountMappings,
            accountCreateDetails: resolvedAccountCreateDetails,
            accountById,
            fixedAccount,
            categories,
            currencies,
            heldRowIds,
          })
        : EMPTY_BUILD,
    [
      accountById,
      categories,
      currencies,
      fixedAccount,
      heldRowIds,
      ofxFile,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
    ],
  )

  const skippedRowIds = useMemo(() => new Set(importBuild.skippedRows.map((row) => row.id)), [importBuild.skippedRows])

  const previewGroups = useMemo(
    () =>
      groupPreviewRowsByDate(
        ofxFile
          ? buildOfxPreviewRows(
              ofxFile,
              {
                accountMappings: resolvedAccountMappings,
                accountCreateDetails: resolvedAccountCreateDetails,
                accountById,
                institutionById,
                categories,
                currencies,
                skippedRowIds,
              },
              IMPORT_SAMPLE_PREVIEW_LIMIT,
            )
          : [],
      ),
    [
      accountById,
      categories,
      currencies,
      institutionById,
      ofxFile,
      resolvedAccountCreateDetails,
      resolvedAccountMappings,
      skippedRowIds,
    ],
  )

  const transactionCount = statements.reduce((total, statement) => total + statement.transactions.length, 0)
  // Rows counts every transaction in the files, as in the other importers, and only Will create leaves
  // out the ones the import skips
  const importEstimate = {
    rowCount: transactionCount,
    transactionEstimate: transactionCount - importBuild.skippedRows.length,
  }

  // A source answered create is counted only while the import sends it
  const newAccountCount = countCreatedImportSources(
    statements.map((statement) => statement.id),
    resolvedAccountMappings,
    CREATE_ACCOUNT_VALUE,
    importBuild.writtenSources,
  )

  const canCommitImport = run.canCommit({
    hasPayload: importBuild.payload !== null,
    isProcessingFile,
    blockReason: heldCheckNotice?.message ?? null,
  })
  const uploadBlockReason = getImportUploadBlockReason(currencies, currenciesError)

  const resetAnswers = () => {
    setAccountMappings({})
    resetAccountCreateState()
    run.resetImportRun()
  }

  const handleOfxFileChange = async (acquiredFiles: ImportFileAcquisition) => {
    const version = stagedFilesVersionRef.current
    const intake = await fileIntake.readImportFiles('statement', {
      files: acquiredFiles,
      unavailableReason: uploadBlockReason?.message ?? null,
      fileType: OFX_IMPORT_FILE_TYPE,
      read: (files) =>
        Promise.all(
          files.map(async (source) => {
            const id = createRandomId()
            return {
              id,
              name: source.name,
              size: source.size,
              lastModified: source.lastModified,
              read: await readOfxFile(source, id),
            }
          }),
        ),
    })

    // A file removed while these were being read changed the list they were checked against
    if (intake.status !== 'accepted' || version !== stagedFilesVersionRef.current) return

    // Files chosen over a finished import start a new one, so the record of the last import gives
    // way to them and their statements are answered afresh
    const isReplacingFinishedImport = run.workflow.importResult !== null
    const held = isReplacingFinishedImport ? [] : stagedFiles
    // An account's page takes one statement from each file, so a file of several is refused
    const candidates = intake.result.map((candidate): typeof candidate => {
      if (!fixedAccount || candidate.read.status !== 'read') return candidate
      const statementCount = getOfxStatementsToImport(candidate.read.file).length
      return statementCount > 1
        ? { ...candidate, read: { status: 'refused', reason: getOfxMultipleStatementsReason(statementCount) } }
        : candidate
    })
    const { accepted, refusals } = stageOfxFiles(held, candidates)
    if (refusals.length > 0) fileIntake.setIntakeError('statement', refusals.join(' '))
    if (accepted.length === 0) return

    if (isReplacingFinishedImport) resetAnswers()
    setStagedFiles([...held, ...accepted])
  }

  const removeOfxFile = (fileId: string) => {
    stagedFilesVersionRef.current += 1
    const remaining = stagedFiles.filter((file) => file.id !== fileId)
    setStagedFiles(remaining)
    if (remaining.length > 0) return

    fileIntake.setIntakeError('statement', null)
    resetAnswers()
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || !canCommitImport) return

    await run.startImport(importBuild.skippedRows, 0, {
      upload: (signal, onStaged) =>
        importTransactions.mutateAsync({
          payload,
          signal,
          onStaged,
          fileName: getImportFileName(labelStagedFiles(stagedFiles)),
          source: 'ofx',
        }),
      commit: (runId, signal) => commitStagedImport.mutateAsync({ runId, signal }),
    })
  }

  const resetOfxWorkflow = () => {
    stagedFilesVersionRef.current += 1
    setStagedFiles([])
    resetAnswers()
    fileIntake.resetFileIntake()
  }

  return {
    ...run.workflow,
    stagedFiles,
    ofxFile,
    leftOutNotice,
    fixedAccount,
    isProcessingFile,
    fileIntakeError,
    accountSources,
    accountMappings: resolvedAccountMappings,
    autoFilledAccountSources,
    handAnsweredAccountSources,
    accountCreateDetails: resolvedAccountCreateDetails,
    accountsFailed,
    refetchAccounts,
    selectedAccountRows,
    batchAccountType,
    batchAccountCurrency,
    batchAccountInstitution,
    importEstimate,
    previewGroups,
    predictedSkippedRows: importBuild.skippedRows,
    newAccountCount,
    importBuild,
    heldCheckNotice,
    canCommitImport,
    accountsLoading,
    currenciesLoading,
    uploadBlockReason,
    institutionsLoading,
    accountOptions,
    currencyOptions,
    institutionOptions,
    accountById,
    setAccountCreateTypes,
    setAccountCreateCurrencies,
    setAccountCreateInstitutions,
    setSelectedAccountRows,
    setBatchAccountType,
    setBatchAccountCurrency,
    setBatchAccountInstitution,
    handleOfxFileChange,
    removeOfxFile,
    updateOfxAccountMapping,
    handleCommitImport,
    resetOfxWorkflow,
  }
}

export type OfxImportWorkflow = ReturnType<typeof useOfxImportWorkflow>
