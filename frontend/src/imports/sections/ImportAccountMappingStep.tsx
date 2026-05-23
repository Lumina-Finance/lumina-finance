import { ACCOUNT_TYPE_OPTIONS } from '../constants'
import { AccountMappingTable, EmptyState, ImportInfoCard, ImportNotice, ImportStep } from '../components'
import type { TransactionImportWorkflow } from '../hooks'
import { getResolvedAccountChoice, getResolvedAccountCreateCurrency, getResolvedAccountCreateType } from '../utils'

type ImportAccountMappingStepProps = Pick<
  TransactionImportWorkflow,
  | 'accountMappingSources'
  | 'accountMappings'
  | 'autoFilledAccountSources'
  | 'accountById'
  | 'accountCreateTypes'
  | 'accountCreateCurrencies'
  | 'updateSourceAccount'
  | 'setAccountCreateTypes'
  | 'setAccountCreateCurrencies'
  | 'accountOptions'
  | 'currencyOptions'
  | 'accountsLoading'
  | 'currenciesLoading'
  | 'selectedAccountRows'
  | 'batchAccountType'
  | 'batchAccountCurrency'
  | 'setBatchAccountType'
  | 'setBatchAccountCurrency'
  | 'setSelectedAccountRows'
>

export function ImportAccountMappingStep({
  accountMappingSources,
  accountMappings,
  autoFilledAccountSources,
  accountById,
  accountCreateTypes,
  accountCreateCurrencies,
  updateSourceAccount,
  setAccountCreateTypes,
  setAccountCreateCurrencies,
  accountOptions,
  currencyOptions,
  accountsLoading,
  currenciesLoading,
  selectedAccountRows,
  batchAccountType,
  batchAccountCurrency,
  setBatchAccountType,
  setBatchAccountCurrency,
  setSelectedAccountRows,
}: ImportAccountMappingStepProps) {
  return (
    <ImportStep index="03" title="Account Mapping">
      <ImportNotice>
        Imported amounts are treated as raw values. During import, each amount will be assigned the base currency of the mapped account or the currency selected for a new account.
      </ImportNotice>
      <ImportInfoCard title="Linking Accounts with Institutions">
        You will be able to create and link institutions to accounts after the import is complete.
      </ImportInfoCard>
      {accountMappingSources.length === 0 ? (
        <EmptyState
          title="No account sources detected"
          description="Upload a file or check the mapped account column."
        />
      ) : (
        <AccountMappingTable
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
              createType: getResolvedAccountCreateType(sourceAccount.id, accountCreateTypes),
              createCurrency: getResolvedAccountCreateCurrency(sourceAccount.id, accountCreateCurrencies),
              onChange: (nextValue: string) => updateSourceAccount(sourceAccount.id, nextValue),
              onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [sourceAccount.id]: nextValue })),
              onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [sourceAccount.id]: nextValue })),
            }
          })}
          options={accountOptions}
          accountTypeOptions={ACCOUNT_TYPE_OPTIONS}
          currencyOptions={currencyOptions}
          disabled={accountsLoading}
          currenciesDisabled={currenciesLoading}
          selectedRowIds={selectedAccountRows}
          batchAccountType={batchAccountType}
          batchAccountCurrency={batchAccountCurrency}
          onBatchAccountTypeChange={setBatchAccountType}
          onBatchAccountCurrencyChange={setBatchAccountCurrency}
          onSelectedRowsChange={setSelectedAccountRows}
        />
      )}
    </ImportStep>
  )
}
