import { useState } from 'react'
import CreateInstitutionModal from '@/components/reference-modals/CreateInstitutionModal'
import { ACCOUNT_TYPE_OPTIONS } from '@/pages/imports/constants'
import { ImportAccountMappingTable, EmptyState, ImportNotice, ImportStep } from '@/pages/imports/components'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'

type FireflyAccountMappingStepProps = Pick<
  FireflyImportWorkflow,
  | 'trackedAccountNames'
  | 'accountMappings'
  | 'autoFilledAccountSources'
  | 'handAnsweredAccountSources'
  | 'accountById'
  | 'accountCreateDetails'
  | 'updateFireflyAccountMapping'
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

/**
 * Account mapping step of the Firefly III import flow, wrapping the shared mapping table with the
 * modal used to create an institution from a row or from the batch bar
 */
export function FireflyAccountMappingStep({
  trackedAccountNames,
  accountMappings,
  autoFilledAccountSources,
  handAnsweredAccountSources,
  accountById,
  accountCreateDetails,
  updateFireflyAccountMapping,
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
}: FireflyAccountMappingStepProps) {
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
    <ImportStep
      index="02"
      title="Account Mapping"
      description="Asset and liability accounts from the export must map to an existing account or a new one."
    >
      <ImportNotice title="Currency Handling">
        Amounts are written in each mapped account&apos;s currency. Rows without an amount in that currency are skipped and reported after the import.
      </ImportNotice>
      {trackedAccountNames.length === 0 ? (
        <EmptyState
          title="No account names detected"
          description="Upload the transactions CSV first."
        />
      ) : (
        <ImportAccountMappingTable
          rows={trackedAccountNames.map((sourceAccount) => {
            const value = accountMappings[sourceAccount] ?? ''
            const account = accountById.get(value)
            const createDetails = accountCreateDetails[sourceAccount]

            return {
              id: sourceAccount,
              source: sourceAccount,
              value,
              autoFilled: autoFilledAccountSources.has(sourceAccount),

              // Both sides of a Firefly transfer take rows, so no source here is counterparty-only
              isCounterpartyOnly: false,

              isArchivedAccount: account?.is_archived ?? false,
              isHandAnswered: handAnsweredAccountSources.has(sourceAccount),
              accountType: account?.account_type ?? '',
              accountCurrency: account?.currency ?? '',
              accountInstitution: account?.institution?.id ?? '',
              createType: createDetails?.accountType ?? '',
              createCurrency: createDetails?.currency ?? '',
              createInstitution: createDetails?.institutionId ?? '',
              onChange: (nextValue: string) => updateFireflyAccountMapping(sourceAccount, nextValue),
              onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [sourceAccount]: nextValue })),
              onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [sourceAccount]: nextValue })),
              onCreateInstitutionChange: (nextValue: string) => setAccountCreateInstitutions((current) => ({ ...current, [sourceAccount]: nextValue })),
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
