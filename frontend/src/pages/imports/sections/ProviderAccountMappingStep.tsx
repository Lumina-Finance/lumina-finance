import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import InstitutionModal from '@/components/reference-modals/InstitutionModal'
import { ACCOUNT_TYPE_OPTIONS } from '@/pages/imports/constants'
import { useImportInstitutionModal } from '@/pages/imports/hooks'
import type { ImportAccountCreateDetails } from '@/pages/imports/types'
import { buildImportAccountMappingRows, isCreatingImportAccount } from '@/pages/imports/utils'
import {
  EmptyState,
  ImportAccountMappingTable,
  ImportAccountStepBody,
  ImportCreatedAccountsNotice,
  ImportStep,
} from '@/pages/imports/components'

// Names the batch bar as the field asking for a new institution, since a row is named by its source
const BATCH_INSTITUTION_TARGET = '__batch__'

type RecordSetter = Dispatch<SetStateAction<Record<string, string>>>

export interface ProviderAccountMappingStepProps {
  index: string
  description: string

  /** Said above the table whenever the accounts have loaded, such as how amounts are read */
  notice?: ReactNode

  /** Said beside the new-accounts notice while any account is created */
  createNotice?: ReactNode

  /** Replaces the new-accounts notice's wording, for an export whose accounts bring their own starting balances */
  createdAccountNotice?: { explanation: string; items: string[] }
  emptyState: { title: string; description: string }
  sources: Array<{ id: string; label: string }>
  accountMappings: Record<string, string>
  autoFilledAccountSources: ReadonlySet<string>
  handAnsweredAccountSources: ReadonlySet<string>
  accountById: Map<string, AccountsOverview>
  accountCreateDetails: Record<string, ImportAccountCreateDetails>
  onAccountMappingChange: (source: string, value: string) => void
  setAccountCreateTypes: RecordSetter
  setAccountCreateCurrencies: RecordSetter
  setAccountCreateInstitutions: RecordSetter
  accountOptions: DropdownOption[]
  currencyOptions: DropdownOption[]
  institutionOptions: DropdownOption[]
  accountsLoading: boolean
  accountsFailed: boolean
  refetchAccounts: () => unknown
  currenciesLoading: boolean
  institutionsLoading: boolean
  selectedAccountRows: Set<string>
  batchAccountType: string
  batchAccountCurrency: string
  batchAccountInstitution: string
  setBatchAccountType: (value: string) => void
  setBatchAccountCurrency: (value: string) => void
  setBatchAccountInstitution: (value: string) => void
  setSelectedAccountRows: Dispatch<SetStateAction<Set<string>>>
}

/**
 * Account mapping step of the provider import flows, where every account in the export takes rows,
 * wrapping the shared mapping table with the modal used to create an institution from a row or from
 * the batch bar
 */
export function ProviderAccountMappingStep({
  index,
  description,
  notice,
  createNotice,
  createdAccountNotice,
  emptyState,
  sources,
  accountMappings,
  autoFilledAccountSources,
  handAnsweredAccountSources,
  accountById,
  accountCreateDetails,
  onAccountMappingChange,
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
}: ProviderAccountMappingStepProps) {
  const { openInstitutionModal, institutionModalKey, institutionModalProps } = useImportInstitutionModal((target, institutionId) => {
    if (target === BATCH_INSTITUTION_TARGET) {
      setBatchAccountInstitution(institutionId)
    } else {
      setAccountCreateInstitutions((current) => ({ ...current, [target]: institutionId }))
    }
  })

  // Every account in the export takes rows, so no source here is counterparty-only
  const accountRows = buildImportAccountMappingRows(sources, {
    accountMappings,
    accountById,
    autoFilledAccountSources,
    handAnsweredAccountSources,
    getCreateDetails: (source) => accountCreateDetails[source],
    onAccountMappingChange,
    setAccountCreateTypes,
    setAccountCreateCurrencies,
    setAccountCreateInstitutions,
  })

  // Held back until the account list has landed, since every tracked name resolves to create until
  // it does, which would show the notice and then drop it once the names match
  const isCreatingAccount = !accountsLoading && isCreatingImportAccount(accountRows)

  return (
    <ImportStep index={index} title="Account Mapping" description={description}>
      {!accountsFailed && notice}
      <ImportAccountStepBody
        accountsFailed={accountsFailed}
        refetchAccounts={refetchAccounts}
        isEmpty={sources.length === 0}
        empty={<EmptyState title={emptyState.title} description={emptyState.description} />}
      >
        <>
          {isCreatingAccount && <ImportCreatedAccountsNotice {...createdAccountNotice} />}
          {createNotice}
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
            onBatchCreateInstitution={(query) => openInstitutionModal(query, BATCH_INSTITUTION_TARGET)}
          />
        </>
      </ImportAccountStepBody>
      <InstitutionModal key={institutionModalKey} {...institutionModalProps} />
    </ImportStep>
  )
}
