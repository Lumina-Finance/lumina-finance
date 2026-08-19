import { useState } from 'react'
import { Link } from 'react-router'
import InstitutionModal from '@/components/reference-modals/InstitutionModal'
import { useInstitutionModal } from '@/hooks/useInstitutionModal'
import {
  ACCOUNTS_LOAD_FAILURE_EXPLANATION,
  ACCOUNTS_LOAD_FAILURE_TITLE,
  ACCOUNT_TYPE_OPTIONS,
  ARCHIVED_ACCOUNT_MATCH_EXPLANATION,
  CLEARED_ACCOUNT_SOURCES_EXPLANATION,
  CLEARED_ACCOUNT_SOURCES_TITLE,
  COUNTERPARTY_ONLY_EXPLANATION,
  COUNTERPARTY_ONLY_TABLE_TITLE,
  CREATED_ACCOUNT_BALANCE_NOTE,
  CREATED_ACCOUNT_CREDIT_LIMIT_NOTE,
  CREATED_ACCOUNT_EXPLANATION,
  CREATED_ACCOUNT_TITLE,
  FIXED_ACCOUNT_WARNING_LINK_LABEL,
  FIXED_ACCOUNT_WARNING_TITLE,
  UNSET_BATCH_INSTITUTION,
  getFixedAccountWarning,
} from '@/pages/imports/constants'
import type { ImportAccountSource } from '@/pages/imports/types'
import { isCreatingImportAccount } from '@/pages/imports/utils'
import { ImportAccountMappingTable, EmptyState, ImportLoadFailure, ImportNotice, ImportStep } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

// Which batch bar asked for a new institution, since each table has one and a row id can be neither
const IMPORTED_BATCH_TARGET = '__imported_batch__'
const COUNTERPARTY_BATCH_TARGET = '__counterparty_batch__'
type BatchTarget = typeof IMPORTED_BATCH_TARGET | typeof COUNTERPARTY_BATCH_TARGET

type ImportAccountMappingStepProps = Pick<
  TransactionImportWorkflow,
  | 'accountMappingSources'
  | 'accountMappings'
  | 'fixedAccount'
  | 'archivedAccountMatches'
  | 'autoFilledAccountSources'
  | 'handAnsweredAccountSources'
  | 'accountById'
  | 'accountCreateTypes'
  | 'accountCreateCurrencies'
  | 'accountCreateInstitutions'
  | 'updateSourceAccount'
  | 'setAccountCreateTypes'
  | 'setAccountCreateCurrencies'
  | 'setAccountCreateInstitutions'
  | 'accountOptions'
  | 'counterpartyAccountOptions'
  | 'currencyOptions'
  | 'institutionOptions'
  | 'accountsLoading'
  | 'accountsFailed'
  | 'refetchAccounts'
  | 'clearedAccountSourceLabels'
  | 'currenciesLoading'
  | 'institutionsLoading'
  | 'selectedAccountRows'
  | 'batchAccountType'
  | 'batchAccountCurrency'
  | 'batchAccountInstitution'
  | 'setBatchAccountType'
  | 'setBatchAccountCurrency'
  | 'setBatchAccountInstitution'
  | 'setSelectedAccountRows'
>

/**
 * Account mapping step of the generic CSV import flow, wrapping the shared mapping table with the
 * modal used to create an institution from a row or from the batch bar
 *
 * An import started from an account has no imported-account table at all: every row goes to that
 * account, so the step says so and warns about the one file this page is wrong for. The counterparty
 * table is unaffected, since a transfer still has to say where its money came from or went to
 */
export function ImportAccountMappingStep({
  accountMappingSources,
  accountMappings,
  fixedAccount,
  archivedAccountMatches,
  autoFilledAccountSources,
  handAnsweredAccountSources,
  accountById,
  accountCreateTypes,
  accountCreateCurrencies,
  accountCreateInstitutions,
  updateSourceAccount,
  setAccountCreateTypes,
  setAccountCreateCurrencies,
  setAccountCreateInstitutions,
  accountOptions,
  counterpartyAccountOptions,
  currencyOptions,
  institutionOptions,
  accountsLoading,
  accountsFailed,
  refetchAccounts,
  clearedAccountSourceLabels,
  currenciesLoading,
  institutionsLoading,
  selectedAccountRows,
  batchAccountType,
  batchAccountCurrency,
  batchAccountInstitution,
  setBatchAccountType,
  setBatchAccountCurrency,
  setBatchAccountInstitution,
  setSelectedAccountRows,
}: ImportAccountMappingStepProps) {
  const institutionModal = useInstitutionModal()

  // Which field asked for a new institution, so the one it creates comes back to that field
  const [institutionModalTarget, setInstitutionModalTarget] = useState<BatchTarget | string>('')

  // The counterparty table carries its own batch bar, so typing into one bar leaves the other alone
  const [counterpartyBatchType, setCounterpartyBatchType] = useState('')
  const [counterpartyBatchCurrency, setCounterpartyBatchCurrency] = useState('')
  const [counterpartyBatchInstitution, setCounterpartyBatchInstitution] = useState(UNSET_BATCH_INSTITUTION)

  const openInstitutionModal = (query: string, target: BatchTarget | string) => {
    setInstitutionModalTarget(target)
    institutionModal.openForCreate(query)
  }

  const closeInstitutionModal = () => {
    setInstitutionModalTarget('')
    institutionModal.close()
  }

  const handleInstitutionSaved = (institution: { id: string }) => {

    // A correction changes an institution rather than which one a field answers with, so it
    // comes back to no field and leaves every answer as it was
    if (institutionModalTarget === IMPORTED_BATCH_TARGET) {
      setBatchAccountInstitution(institution.id)
    } else if (institutionModalTarget === COUNTERPARTY_BATCH_TARGET) {
      setCounterpartyBatchInstitution(institution.id)
    } else if (institutionModalTarget) {
      setAccountCreateInstitutions((current) => ({ ...current, [institutionModalTarget]: institution.id }))
    }
    closeInstitutionModal()
  }

  /**
   * Builds the table rows for a set of sources, keeping both tables identical apart from the
   * outside answer that only a counterparty source is offered
   */
  const buildRows = (sources: ImportAccountSource[]) => sources.map((sourceAccount) => {
    const value = accountMappings[sourceAccount.id] ?? ''
    const account = accountById.get(value)

    return {
      id: sourceAccount.id,
      source: sourceAccount.label,
      value,
      selectedOption: account ? { value, label: account.name } : undefined,
      autoFilled: autoFilledAccountSources.has(sourceAccount.id),
      isCounterpartyOnly: sourceAccount.isCounterpartyOnly,
      isArchivedAccount: account?.is_archived ?? false,
      isHandAnswered: handAnsweredAccountSources.has(sourceAccount.id),
      accountType: account?.account_type ?? '',
      accountCurrency: account?.currency ?? '',
      accountInstitution: account?.institution?.id ?? '',
      createType: accountCreateTypes[sourceAccount.id] ?? '',
      createCurrency: accountCreateCurrencies[sourceAccount.id] ?? '',
      createInstitution: accountCreateInstitutions[sourceAccount.id] ?? '',
      onChange: (nextValue: string) => updateSourceAccount(sourceAccount.id, nextValue),
      onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [sourceAccount.id]: nextValue })),
      onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [sourceAccount.id]: nextValue })),
      onCreateInstitutionChange: (nextValue: string) => setAccountCreateInstitutions((current) => ({ ...current, [sourceAccount.id]: nextValue })),
    }
  })

  const sharedTableProps = {
    accountTypeOptions: ACCOUNT_TYPE_OPTIONS,
    currencyOptions,
    institutionOptions,
    disabled: accountsLoading,
    currenciesDisabled: currenciesLoading,
    institutionsDisabled: institutionsLoading,
    selectedRowIds: selectedAccountRows,
    onSelectedRowsChange: setSelectedAccountRows,
    onCreateInstitution: (query: string, rowId: string) => openInstitutionModal(query, rowId),
  }

  const importedSources = accountMappingSources.filter((source) => !source.isCounterpartyOnly)
  const counterpartySources = accountMappingSources.filter((source) => source.isCounterpartyOnly)
  const importedRows = buildRows(importedSources)
  const counterpartyRows = buildRows(counterpartySources)

  // Both tables create accounts, so one notice covers them and reads every row of the step. Held
  // back until the account list has landed, since rows rest on create until it does
  const isCreatingAccount = !accountsLoading && isCreatingImportAccount([...importedRows, ...counterpartyRows])

  return (
    <ImportStep index="03" title="Account Mapping">
      {/* Says what this page will do with a file whether or not one is staged, since a file covering
          more than one account has to be sent elsewhere before it is uploaded rather than after */}
      {fixedAccount && (
        <ImportNotice tone="danger" title={FIXED_ACCOUNT_WARNING_TITLE}>
          {getFixedAccountWarning(fixedAccount.name)}
          {' '}
          <Link
            to="/settings/imports"
            className="font-medium underline underline-offset-2 transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ color: 'var(--app-accent)' }}
          >
            {FIXED_ACCOUNT_WARNING_LINK_LABEL}
          </Link>
        </ImportNotice>
      )}
      {accountsFailed ? (
        <ImportLoadFailure
          title={ACCOUNTS_LOAD_FAILURE_TITLE}
          description={ACCOUNTS_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchAccounts}
        />
      ) : accountMappingSources.length === 0 ? (
        // A fixed account has already been told what will happen, by the notice above, so nothing
        // asks it for a file a second time
        fixedAccount ? null : (
          <EmptyState
            title="No accounts yet"
            description="Upload a file, or check which column is mapped as the account."
          />
        )
      ) : (
        <>
          {clearedAccountSourceLabels.length > 0 && (
            <ImportNotice title={CLEARED_ACCOUNT_SOURCES_TITLE} items={clearedAccountSourceLabels}>
              {CLEARED_ACCOUNT_SOURCES_EXPLANATION}
            </ImportNotice>
          )}
          {archivedAccountMatches.length > 0 && (
            <ImportNotice
              title="Archived accounts"
              items={archivedAccountMatches.map((match) => (
                // The visible text is the account name, so the label is what says where following
                // it goes, which is all a screen reader's list of links would otherwise show
                <Link
                  key={match.id}
                  to={`/accounts/${match.id}`}
                  state={{ editAccount: true }}
                  aria-label={`Open ${match.name} to unarchive it`}
                  className="font-medium underline underline-offset-2 transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ color: 'var(--app-accent)' }}
                >
                  {match.name}
                </Link>
              ))}
            >
              {ARCHIVED_ACCOUNT_MATCH_EXPLANATION}
            </ImportNotice>
          )}
          {isCreatingAccount && (
            <ImportNotice
              title={CREATED_ACCOUNT_TITLE}
              items={[CREATED_ACCOUNT_BALANCE_NOTE, CREATED_ACCOUNT_CREDIT_LIMIT_NOTE]}
            >
              {CREATED_ACCOUNT_EXPLANATION}
            </ImportNotice>
          )}
          {/* The scope answers every source rows are written to, so there is no table to show for
              them. The counterparty table below still asks about a transfer's other side */}
          {fixedAccount ? null : (
            <ImportAccountMappingTable
              rows={importedRows}
              options={accountOptions}
              batchAccountType={batchAccountType}
              batchAccountCurrency={batchAccountCurrency}
              batchAccountInstitution={batchAccountInstitution}
              onBatchAccountTypeChange={setBatchAccountType}
              onBatchAccountCurrencyChange={setBatchAccountCurrency}
              onBatchAccountInstitutionChange={setBatchAccountInstitution}
              onBatchCreateInstitution={(query) => openInstitutionModal(query, IMPORTED_BATCH_TARGET)}
              {...sharedTableProps}
            />
          )}
          {counterpartySources.length > 0 && (
            <div className="space-y-3 pt-8">
              <div className="space-y-1">
                <p className="text-sm font-semibold">{COUNTERPARTY_ONLY_TABLE_TITLE}</p>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {COUNTERPARTY_ONLY_EXPLANATION}
                </p>
              </div>
              <ImportAccountMappingTable
                rows={counterpartyRows}
                options={counterpartyAccountOptions}
                batchAccountType={counterpartyBatchType}
                batchAccountCurrency={counterpartyBatchCurrency}
                batchAccountInstitution={counterpartyBatchInstitution}
                onBatchAccountTypeChange={setCounterpartyBatchType}
                onBatchAccountCurrencyChange={setCounterpartyBatchCurrency}
                onBatchAccountInstitutionChange={setCounterpartyBatchInstitution}
                onBatchCreateInstitution={(query) => openInstitutionModal(query, COUNTERPARTY_BATCH_TARGET)}
                {...sharedTableProps}
              />
            </div>
          )}
        </>
      )}
      <InstitutionModal
        key={institutionModal.key}
        open={institutionModal.open}
        initialName={institutionModal.name}
        institution={institutionModal.institution}
        onClose={closeInstitutionModal}
        onSaved={handleInstitutionSaved}
      />
    </ImportStep>
  )
}
