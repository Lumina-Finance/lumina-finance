import { useState } from 'react'
import CreateInstitutionModal from '@/components/CreateInstitutionModal'
import { ACCOUNT_TYPE_OPTIONS } from '../constants'
import { ImportAccountMappingTable, EmptyState, ImportNotice, ImportStep } from '../components'
import type { TransactionImportWorkflow } from '../hooks'
import { getResolvedAccountChoice, getResolvedAccountCreateCurrency, getResolvedAccountCreateInstitution, getResolvedAccountCreateType } from '../utils'

type ImportAccountMappingStepProps = Pick<
  TransactionImportWorkflow,
  | 'accountMappingSources'
  | 'accountMappings'
  | 'autoFilledAccountSources'
  | 'accountById'
  | 'accountCreateTypes'
  | 'accountCreateCurrencies'
  | 'accountCreateInstitutions'
  | 'updateSourceAccount'
  | 'setAccountCreateTypes'
  | 'setAccountCreateCurrencies'
  | 'setAccountCreateInstitutions'
  | 'accountOptions'
  | 'currencyOptions'
  | 'institutionOptions'
  | 'accountsLoading'
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

export function ImportAccountMappingStep({
  accountMappingSources,
  accountMappings,
  autoFilledAccountSources,
  accountById,
  accountCreateTypes,
  accountCreateCurrencies,
  accountCreateInstitutions,
  updateSourceAccount,
  setAccountCreateTypes,
  setAccountCreateCurrencies,
  setAccountCreateInstitutions,
  accountOptions,
  currencyOptions,
  institutionOptions,
  accountsLoading,
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
  const [institutionModalTarget, setInstitutionModalTarget] = useState<'batch' | string>('')
  const [institutionModalKey, setInstitutionModalKey] = useState(0)
  const institutionModalOpen = Boolean(institutionModalTarget)

  const openInstitutionModal = (query: string, target: 'batch' | string) => {
    setInstitutionModalName(query)
    setInstitutionModalTarget(target)
    setInstitutionModalKey((current) => current + 1)
  }

  const handleInstitutionCreated = (institution: { id: string }) => {
    if (institutionModalTarget === 'batch') {
      setBatchAccountInstitution(institution.id)
    } else if (institutionModalTarget) {
      setAccountCreateInstitutions((current) => ({ ...current, [institutionModalTarget]: institution.id }))
    }
    setInstitutionModalTarget('')
  }

  return (
    <ImportStep index="03" title="Account Mapping">
      <ImportNotice>
        Imported amounts are treated as raw values. During import, each amount will be assigned the base currency of the mapped account or the currency selected for a new account.
      </ImportNotice>
      {accountMappingSources.length === 0 ? (
        <EmptyState
          title="No account sources detected"
          description="Upload a file or check the mapped account column."
        />
      ) : (
        <ImportAccountMappingTable
          rows={accountMappingSources.map((sourceAccount) => {
            const value = getResolvedAccountChoice(accountMappings[sourceAccount.id])
            const account = accountById.get(value)

            return {
              id: sourceAccount.id,
              source: sourceAccount.label,
              value,
              autoFilled: autoFilledAccountSources.has(sourceAccount.id),
              accountType: account?.account_type ?? '',
              accountCurrency: account?.currency ?? '',
              accountInstitution: account?.institution?.id ?? '',
              createType: getResolvedAccountCreateType(sourceAccount.id, accountCreateTypes),
              createCurrency: getResolvedAccountCreateCurrency(sourceAccount.id, accountCreateCurrencies),
              createInstitution: getResolvedAccountCreateInstitution(sourceAccount.id, accountCreateInstitutions),
              onChange: (nextValue: string) => updateSourceAccount(sourceAccount.id, nextValue),
              onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [sourceAccount.id]: nextValue })),
              onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [sourceAccount.id]: nextValue })),
              onCreateInstitutionChange: (nextValue: string) => setAccountCreateInstitutions((current) => ({ ...current, [sourceAccount.id]: nextValue })),
            }
          })}
          options={accountOptions}
          accountTypeOptions={ACCOUNT_TYPE_OPTIONS}
          currencyOptions={currencyOptions}
          institutionOptions={institutionOptions}
          disabled={accountsLoading}
          currenciesDisabled={currenciesLoading}
          institutionsDisabled={institutionsLoading}
          selectedRowIds={selectedAccountRows}
          batchAccountType={batchAccountType}
          batchAccountCurrency={batchAccountCurrency}
          batchAccountInstitution={batchAccountInstitution}
          onBatchAccountTypeChange={setBatchAccountType}
          onBatchAccountCurrencyChange={setBatchAccountCurrency}
          onBatchAccountInstitutionChange={setBatchAccountInstitution}
          onSelectedRowsChange={setSelectedAccountRows}
          onCreateInstitution={(query, rowId) => openInstitutionModal(query, rowId)}
          onBatchCreateInstitution={(query) => openInstitutionModal(query, 'batch')}
        />
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
