import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
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
import { isCreatingImportAccount, isImportableAccount } from '@/pages/imports/utils'
import { ImportAccountMappingTable, EmptyState, ImportLoadFailure, ImportNotice, ImportStep } from '@/pages/imports/components'

type InstitutionModalTarget = { kind: 'batch' } | { kind: 'account'; source: string }

type RecordSetter = Dispatch<SetStateAction<Record<string, string>>>

/** Create-new answers for one source account */
interface ProviderAccountCreateDetails {
  accountType: string
  currency: string
  institutionId: string
}

export interface ProviderAccountMappingStepProps {
  index: string
  description: string

  /** Said above the table whenever the accounts have loaded, such as how amounts are read */
  notice?: ReactNode

  /** Said beside the new-accounts notice while any account is created */
  createNotice?: ReactNode
  emptyState: { title: string; description: string }
  sources: Array<{ id: string; label: string }>
  accountMappings: Record<string, string>
  autoFilledAccountSources: ReadonlySet<string>
  handAnsweredAccountSources: ReadonlySet<string>
  accountById: Map<string, AccountsOverview>
  accountCreateDetails: Record<string, ProviderAccountCreateDetails>
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
  const institutionModal = useInstitutionModal()

  // Which field asked for a new institution, so the one it creates comes back to that field
  const [institutionModalTarget, setInstitutionModalTarget] = useState<InstitutionModalTarget | null>(null)

  /** Opens institution creation for the batch controls or one account row */
  const openInstitutionModal = (query: string, target: InstitutionModalTarget) => {
    setInstitutionModalTarget(target)
    institutionModal.openForCreate(query)
  }

  /** Clears the requesting field when institution creation closes */
  const closeInstitutionModal = () => {
    setInstitutionModalTarget(null)
    institutionModal.close()
  }

  /** Assigns the created institution only to the field that opened the modal */
  const handleInstitutionSaved = (institution: { id: string }) => {
    if (institutionModalTarget?.kind === 'batch') {
      setBatchAccountInstitution(institution.id)
    } else if (institutionModalTarget) {
      setAccountCreateInstitutions((current) => ({ ...current, [institutionModalTarget.source]: institution.id }))
    }
    closeInstitutionModal()
  }

  const accountRows = sources.map(({ id: sourceAccount, label }) => {
    const value = accountMappings[sourceAccount] ?? ''
    const account = accountById.get(value)
    const createDetails = accountCreateDetails[sourceAccount]

    return {
      id: sourceAccount,
      source: label,
      value,

      // Keeps an account the dropdown has stopped offering, which here means one archived or made
      // read-only since it was chosen, visible on its row rather than reading as unanswered
      selectedOption: account ? { value, label: account.name } : undefined,

      autoFilled: autoFilledAccountSources.has(sourceAccount),

      // Every account in the export takes rows, so no source here is counterparty-only
      isCounterpartyOnly: false,

      isReadOnlyAccount: account ? !isImportableAccount(account) : false,
      isHandAnswered: handAnsweredAccountSources.has(sourceAccount),
      accountType: account?.account_type ?? '',
      accountCurrency: account?.currency ?? '',
      accountInstitution: account?.institution?.id ?? '',
      createType: createDetails?.accountType ?? '',
      createCurrency: createDetails?.currency ?? '',
      createInstitution: createDetails?.institutionId ?? '',
      onChange: (nextValue: string) => onAccountMappingChange(sourceAccount, nextValue),
      onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [sourceAccount]: nextValue })),
      onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [sourceAccount]: nextValue })),
      onCreateInstitutionChange: (nextValue: string) => setAccountCreateInstitutions((current) => ({ ...current, [sourceAccount]: nextValue })),
    }
  })

  // Held back until the account list has landed, since every tracked name resolves to create until
  // it does, which would show the notice and then drop it once the names match
  const isCreatingAccount = !accountsLoading && isCreatingImportAccount(accountRows)

  return (
    <ImportStep index={index} title="Account Mapping" description={description}>
      {!accountsFailed && notice}
      {accountsFailed ? (
        <ImportLoadFailure
          title={ACCOUNTS_LOAD_FAILURE_TITLE}
          description={ACCOUNTS_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchAccounts}
        />
      ) : sources.length === 0 ? (
        <EmptyState title={emptyState.title} description={emptyState.description} />
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
            onCreateInstitution={(query, rowId) => openInstitutionModal(query, { kind: 'account', source: rowId })}
            onBatchCreateInstitution={(query) => openInstitutionModal(query, { kind: 'batch' })}
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
