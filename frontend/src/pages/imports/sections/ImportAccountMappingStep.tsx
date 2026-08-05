import { useState } from 'react'
import CreateInstitutionModal from '@/components/reference-modals/CreateInstitutionModal'
import {
  ACCOUNTS_LOAD_FAILURE_EXPLANATION,
  ACCOUNTS_LOAD_FAILURE_TITLE,
  ACCOUNT_TYPE_OPTIONS,
  ARCHIVED_ACCOUNT_MATCH_EXPLANATION,
  CLEARED_ACCOUNT_SOURCES_EXPLANATION,
  CLEARED_ACCOUNT_SOURCES_TITLE,
  COUNTERPARTY_ONLY_EXPLANATION,
  COUNTERPARTY_ONLY_TABLE_TITLE,
  UNSET_BATCH_INSTITUTION,
} from '@/pages/imports/constants'
import type { ImportAccountSource } from '@/pages/imports/types'
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
 */
export function ImportAccountMappingStep({
  accountMappingSources,
  accountMappings,
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
  const [institutionModalName, setInstitutionModalName] = useState('')
  const [institutionModalTarget, setInstitutionModalTarget] = useState<BatchTarget | string>('')
  const [institutionModalKey, setInstitutionModalKey] = useState(0)
  const institutionModalOpen = Boolean(institutionModalTarget)

  // The counterparty table carries its own batch bar, so typing into one bar leaves the other alone
  const [counterpartyBatchType, setCounterpartyBatchType] = useState('')
  const [counterpartyBatchCurrency, setCounterpartyBatchCurrency] = useState('')
  const [counterpartyBatchInstitution, setCounterpartyBatchInstitution] = useState(UNSET_BATCH_INSTITUTION)

  const openInstitutionModal = (query: string, target: BatchTarget | string) => {
    setInstitutionModalName(query)
    setInstitutionModalTarget(target)
    setInstitutionModalKey((current) => current + 1)
  }

  const handleInstitutionCreated = (institution: { id: string }) => {
    if (institutionModalTarget === IMPORTED_BATCH_TARGET) {
      setBatchAccountInstitution(institution.id)
    } else if (institutionModalTarget === COUNTERPARTY_BATCH_TARGET) {
      setCounterpartyBatchInstitution(institution.id)
    } else if (institutionModalTarget) {
      setAccountCreateInstitutions((current) => ({ ...current, [institutionModalTarget]: institution.id }))
    }
    setInstitutionModalTarget('')
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

  return (
    <ImportStep index="03" title="Account Mapping">
      {!accountsFailed && (
        <ImportNotice title="Currency Handling">
          Imported amounts are treated as raw values. During import, each amount will be assigned the base currency of the mapped account or the currency selected for a new account.
        </ImportNotice>
      )}
      {accountsFailed ? (
        <ImportLoadFailure
          title={ACCOUNTS_LOAD_FAILURE_TITLE}
          description={ACCOUNTS_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchAccounts}
        />
      ) : accountMappingSources.length === 0 ? (
        <EmptyState
          title="No account sources detected"
          description="Upload a file or check the mapped account column."
        />
      ) : (
        <>
          {clearedAccountSourceLabels.length > 0 && (
            <ImportNotice title={CLEARED_ACCOUNT_SOURCES_TITLE}>
              {`${CLEARED_ACCOUNT_SOURCES_EXPLANATION} ${clearedAccountSourceLabels.join(', ')}`}
            </ImportNotice>
          )}
          {archivedAccountMatches.length > 0 && (
            <ImportNotice title="Archived Accounts">
              {`${ARCHIVED_ACCOUNT_MATCH_EXPLANATION} ${archivedAccountMatches.join(', ')}`}
            </ImportNotice>
          )}
          <ImportAccountMappingTable
            rows={buildRows(importedSources)}
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
          {counterpartySources.length > 0 && (
            <div className="space-y-3 pt-8">
              <div className="space-y-1">
                <p className="text-sm font-semibold">{COUNTERPARTY_ONLY_TABLE_TITLE}</p>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {COUNTERPARTY_ONLY_EXPLANATION}
                </p>
              </div>
              <ImportAccountMappingTable
                rows={buildRows(counterpartySources)}
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
      <CreateInstitutionModal
        key={institutionModalKey}
        open={institutionModalOpen}
        initialName={institutionModalName}
        onClose={() => setInstitutionModalTarget('')}
        onCreated={handleInstitutionCreated}
      />
    </ImportStep>
  )
}
