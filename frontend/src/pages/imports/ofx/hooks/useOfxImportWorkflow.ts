import { useMemo, useState } from 'react'
import { useCommitStagedImport, useImportTransactions, type TransactionImportResponse } from '@/api/transaction-imports'
import { CREATE_ACCOUNT_VALUE, IMPORT_SAMPLE_PREVIEW_LIMIT, IMPORT_TRANSFER_CATEGORY_NAME } from '@/pages/imports/constants'
import {
  useImportAccountCreateState,
  useImportRun,
  useProviderAccountAnswers,
  useProviderFileIntake,
  useProviderImportReferenceData,
} from '@/pages/imports/hooks'
import {
  getOfxAccountSourceScope,
  OFX_IMPORT_FILE_TYPE,
  OFX_UPLOAD_LABEL,
} from '@/pages/imports/ofx/constants'
import type { OfxFile, OfxSkippedRow } from '@/pages/imports/ofx/types'
import { buildOfxImportPayload, getOfxStatementsToImport, type OfxImportBuild } from '@/pages/imports/ofx/utils/payload'
import { buildOfxPreviewRows } from '@/pages/imports/ofx/utils/preview'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import type { ImportAccountCreateDetails } from '@/pages/imports/types'
import {
  countCreatedImportSources,
  formatImportSummary,
  getImportUploadBlockReason,
  getSupportedCurrencyCodes,
  groupPreviewRowsByDate,
  type ImportFileAcquisition,
} from '@/pages/imports/utils'

/** The statement file the flow has read, as the files step lists it */
export interface OfxStagedFile {
  id: string
  name: string
  size: number
  statementCount: number
  transactionCount: number
}

// An OFX import reads one file, so its one refusal is kept under one kind
const OFX_FILE_KINDS = ['statement'] as const

const EMPTY_BUILD: OfxImportBuild = {
  errors: [],
  currencyMismatches: [],
  payload: null,
  skippedRows: [],
  writtenSources: new Set(),
}

/**
 * Drives the whole OFX import flow: reading the statement file, matching each of its
 * statements to one of the user's accounts, and saving it through the same staged run a CSV import
 * uses
 *
 * Staging a different file resets every answer and any prior result, since the answers were given
 * for the statements of the one before
 */
export function useOfxImportWorkflow() {
  const [stagedFile, setStagedFile] = useState<OfxStagedFile | null>(null)
  const [ofxFile, setOfxFile] = useState<OfxFile | null>(null)
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

  // Every answer the user gives about the import, as one value that changes only when one of them does
  const importAnswers = useMemo(
    () => ({ accountMappings, accountCreateTypes, accountCreateCurrencies, accountCreateInstitutions }),
    [accountCreateCurrencies, accountCreateInstitutions, accountCreateTypes, accountMappings],
  )

  const importTransactions = useImportTransactions()
  const commitStagedImport = useCommitStagedImport()
  const run = useImportRun<TransactionImportResponse, OfxSkippedRow>({
    answers: importAnswers,
    uploadLabel: OFX_UPLOAD_LABEL,
    mutations: [importTransactions, commitStagedImport],
    formatSummary: ({ result, skippedRowsAtCommit, outsideRangeCountAtCommit }) => (
      formatImportSummary(result, skippedRowsAtCommit.length, outsideRangeCountAtCommit)
    ),
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
    () => statements.map((statement) => ({ id: statement.id, label: statement.label, matchText: statement.name, isCounterpartyOnly: false })),
    [statements],
  )

  const { resolvedAccountMappings, autoFilledAccountSources, handAnsweredAccountSources } = useProviderAccountAnswers({
    sources: accountSources,
    accountMappings,
    reference: { accountsResolved, accountsCurrent, accountById, selectableAccounts: matchableAccounts },
  })

  // A new account is proposed in the statement's own currency, which the user can change. One this
  // app does not support is left for the user to choose, since the account could not be created in it
  const resolvedAccountCreateDetails = useMemo(
    () => {
      const details: Record<string, ImportAccountCreateDetails> = {}
      for (const statement of statements) {
        details[statement.id] = {
          accountType: accountCreateTypes[statement.id] ?? statement.proposedType,
          currency: accountCreateCurrencies[statement.id] ?? (supportedCurrencyCodes.has(statement.currency) ? statement.currency : ''),
          institutionId: accountCreateInstitutions[statement.id] ?? '',
        }
      }
      return details
    },
    [accountCreateCurrencies, accountCreateInstitutions, accountCreateTypes, statements, supportedCurrencyCodes],
  )

  const importBuild = useMemo(
    () => (ofxFile
      ? buildOfxImportPayload(ofxFile, {
        accountMappings: resolvedAccountMappings,
        accountCreateDetails: resolvedAccountCreateDetails,
        accountById,
        categories,
        currencies,
      })
      : EMPTY_BUILD),
    [accountById, categories, currencies, ofxFile, resolvedAccountCreateDetails, resolvedAccountMappings],
  )

  const skippedRowIds = useMemo(() => new Set(importBuild.skippedRows.map((row) => row.id)), [importBuild.skippedRows])

  const previewGroups = useMemo(
    () => groupPreviewRowsByDate(ofxFile
      ? buildOfxPreviewRows(ofxFile, {
        accountMappings: resolvedAccountMappings,
        accountCreateDetails: resolvedAccountCreateDetails,
        accountById,
        institutionById,
        categories,
        currencies,
        skippedRowIds,
      }, IMPORT_SAMPLE_PREVIEW_LIMIT)
      : []),
    [accountById, categories, currencies, institutionById, ofxFile, resolvedAccountCreateDetails, resolvedAccountMappings, skippedRowIds],
  )

  const transactionCount = statements.reduce((total, statement) => total + statement.transactions.length, 0)
  const importEstimate = {
    rowCount: transactionCount - importBuild.skippedRows.length,
    transactionEstimate: transactionCount - importBuild.skippedRows.length,
  }

  // A source answered create is counted only while the import sends it
  const newAccountCount = countCreatedImportSources(
    statements.map((statement) => statement.id),
    resolvedAccountMappings,
    CREATE_ACCOUNT_VALUE,
    importBuild.writtenSources,
  )

  const canCommitImport = run.canCommit({ hasPayload: importBuild.payload !== null, isProcessingFile })
  const uploadBlockReason = getImportUploadBlockReason(currencies, currenciesError)

  const resetAnswers = () => {
    setAccountMappings({})
    resetAccountCreateState()
    run.resetImportRun()
  }

  const handleOfxFileChange = async (acquiredFiles: ImportFileAcquisition) => {
    const intake = await fileIntake.readImportFile('statement', {
      files: acquiredFiles,
      unavailableReason: uploadBlockReason?.message ?? null,
      fileType: OFX_IMPORT_FILE_TYPE,
      read: async (file) => ({ file, read: await readOfxFile(file) }),
    })

    if (intake.status !== 'accepted') return

    const { file, read } = intake.result
    if (read.status === 'refused') {
      fileIntake.setIntakeError('statement', read.reason)
      return
    }

    setOfxFile(read.file)
    setStagedFile({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      statementCount: read.file.statements.length,
      transactionCount: read.file.statements.reduce((total, statement) => total + statement.transactions.length, 0),
    })
    resetAnswers()
  }

  const removeOfxFile = () => {
    setOfxFile(null)
    setStagedFile(null)
    fileIntake.setIntakeError('statement', null)
    resetAnswers()
  }

  const handleCommitImport = async () => {
    const payload = importBuild.payload
    if (!payload || !canCommitImport) return

    await run.startImport(importBuild.skippedRows, 0, {
      upload: (signal, onStaged) => importTransactions.mutateAsync({
        payload,
        signal,
        onStaged,
        fileName: stagedFile?.name,
        source: 'ofx',
      }),
      commit: (runId, signal) => commitStagedImport.mutateAsync({ runId, signal }),
    })
  }

  const resetOfxWorkflow = () => {
    removeOfxFile()
    fileIntake.resetFileIntake()
  }

  return {
    ...run.workflow,
    stagedFile,
    ofxFile,
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
