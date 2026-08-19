import { useState } from 'react'
import InstitutionModal from '@/components/reference-modals/InstitutionModal'
import { useInstitutionModal } from '@/hooks/useInstitutionModal'
import {
  ACCOUNTS_LOAD_FAILURE_EXPLANATION,
  ACCOUNTS_LOAD_FAILURE_TITLE,
  ACCOUNT_TYPE_OPTIONS,
  CREATED_ACCOUNT_BALANCE_NOTE,
  CREATED_ACCOUNT_CREDIT_LIMIT_NOTE,
  CREATED_ACCOUNT_EXPLANATION,
  CREATED_ACCOUNT_TITLE,
} from '@/pages/imports/constants'
import { isCreatingImportAccount } from '@/pages/imports/utils'
import { ImportAccountMappingTable, EmptyState, ImportLoadFailure, ImportNotice, ImportStep } from '@/pages/imports/components'
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
  | 'accountsFailed'
  | 'refetchAccounts'
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
  accountsFailed,
  refetchAccounts,
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
  const institutionModal = useInstitutionModal()

  // Which field asked for a new institution, so the one it creates comes back to that field
  const [institutionModalTarget, setInstitutionModalTarget] = useState<'batch' | string>('')

  const openInstitutionModal = (query: string, target: 'batch' | string) => {
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
    if (institutionModalTarget === 'batch') {
      setBatchAccountInstitution(institution.id)
    } else if (institutionModalTarget) {
      setAccountCreateInstitutions((current) => ({ ...current, [institutionModalTarget]: institution.id }))
    }
    closeInstitutionModal()
  }

  const accountRows = trackedAccountNames.map((sourceAccount) => {
    const value = accountMappings[sourceAccount] ?? ''
    const account = accountById.get(value)
    const createDetails = accountCreateDetails[sourceAccount]

    return {
      id: sourceAccount,
      source: sourceAccount,
      value,

      // Keeps an account the dropdown has stopped offering, which here means one archived
      // since it was chosen, visible on its row rather than reading as unanswered
      selectedOption: account ? { value, label: account.name } : undefined,

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
  })

  // Held back until the account list has landed, since every tracked name resolves to create until
  // it does, which would show the notice and then drop it once the names match
  const isCreatingAccount = !accountsLoading && isCreatingImportAccount(accountRows)

  return (
    <ImportStep
      index="02"
      title="Account Mapping"
      description="Asset and liability accounts from the export must map to an existing account or a new one."
    >
      {!accountsFailed && (
        <ImportNotice title="How currencies are read">
          Amounts are written in each mapped account&apos;s currency. Rows without an amount in that currency are skipped and reported after the import.
        </ImportNotice>
      )}
      {accountsFailed ? (
        <ImportLoadFailure
          title={ACCOUNTS_LOAD_FAILURE_TITLE}
          description={ACCOUNTS_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchAccounts}
        />
      ) : trackedAccountNames.length === 0 ? (
        <EmptyState
          title="No account names detected"
          description="Upload the transactions CSV first."
        />
      ) : (
        <>
          {isCreatingAccount && (
            <ImportNotice
              title={CREATED_ACCOUNT_TITLE}
              items={[CREATED_ACCOUNT_BALANCE_NOTE, CREATED_ACCOUNT_CREDIT_LIMIT_NOTE]}
            >
              {CREATED_ACCOUNT_EXPLANATION}
            </ImportNotice>
          )}
          <ImportAccountMappingTable
            rows={accountRows}
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
