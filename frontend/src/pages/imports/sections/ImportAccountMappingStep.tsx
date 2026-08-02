import { useState } from 'react'
import CreateInstitutionModal from '@/components/reference-modals/CreateInstitutionModal'
import {
  ACCOUNT_TYPE_OPTIONS,
  OTHER_ACCOUNT_EXPLANATION,
  OTHER_ACCOUNT_ONLY_GROUP_TITLE,
} from '@/pages/imports/constants'
import { ImportAccountMappingTable, EmptyState, ImportNotice, ImportStep } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'

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
  | 'otherSideAccountOptions'
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

/**
 * Account mapping step of the generic CSV import flow, wrapping the shared mapping table with the
 * modal used to create an institution from a row or from the batch bar
 */
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
  otherSideAccountOptions,
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
            const value = accountMappings[sourceAccount.id] ?? ''
            const account = accountById.get(value)

            return {
              id: sourceAccount.id,
              source: sourceAccount.label,
              value,
              autoFilled: autoFilledAccountSources.has(sourceAccount.id),
              accountType: account?.account_type ?? '',
              accountCurrency: account?.currency ?? '',
              accountInstitution: account?.institution?.id ?? '',
              createType: accountCreateTypes[sourceAccount.id] ?? '',
              createCurrency: accountCreateCurrencies[sourceAccount.id] ?? '',
              createInstitution: accountCreateInstitutions[sourceAccount.id] ?? '',
              options: sourceAccount.isOtherSideOnly ? otherSideAccountOptions : undefined,
              isOtherSideOnly: sourceAccount.isOtherSideOnly,
              onChange: (nextValue: string) => updateSourceAccount(sourceAccount.id, nextValue),
              onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [sourceAccount.id]: nextValue })),
              onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [sourceAccount.id]: nextValue })),
              onCreateInstitutionChange: (nextValue: string) => setAccountCreateInstitutions((current) => ({ ...current, [sourceAccount.id]: nextValue })),
            }
          })}
          options={accountOptions}
          otherSideGroup={{
            title: OTHER_ACCOUNT_ONLY_GROUP_TITLE,
            description: OTHER_ACCOUNT_EXPLANATION,
          }}
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
