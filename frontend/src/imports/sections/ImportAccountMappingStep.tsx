import { ACCOUNT_TYPE_OPTIONS } from '../constants'
import { AccountMappingTable, EmptyState, ImportInfoCard, ImportNotice, ImportStep } from '../components'
import type { TransactionImportWorkflow } from '../hooks'
import { getResolvedAccountChoice, getResolvedAccountCreateCurrency, getResolvedAccountCreateType } from '../utils'

type ImportAccountMappingStepProps = Pick<
  TransactionImportWorkflow,
  | 'mode'
  | 'sourceAccounts'
  | 'accountMappings'
  | 'autoFilledAccountSources'
  | 'autoFilledFileAccountIds'
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
  | 'files'
  | 'updateFileAccount'
>

export function ImportAccountMappingStep({
  mode,
  sourceAccounts,
  accountMappings,
  autoFilledAccountSources,
  autoFilledFileAccountIds,
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
  files,
  updateFileAccount,
}: ImportAccountMappingStepProps) {
  return (
    <ImportStep index="03" title="Account Mapping">
      <ImportNotice>
        Imported amounts are treated as raw values. During import, each amount will be assigned the base currency of the mapped account or the currency selected for a new account.
      </ImportNotice>
      <ImportInfoCard title="Linking Accounts with Institutions">
        You will be able to create and link institutions to accounts after the import is complete.
      </ImportInfoCard>
      {mode === 'single-file' ? (
        sourceAccounts.length === 0 ? (
          <EmptyState
            title="No source accounts detected"
            description="Map an account column first."
          />
        ) : (
          <AccountMappingTable
            rows={sourceAccounts.map((sourceAccount) => {
              const value = getResolvedAccountChoice(accountMappings[sourceAccount])
              const account = accountById.get(value)

              return {
                id: sourceAccount,
                source: sourceAccount,
                value,
                autoFilled: autoFilledAccountSources.has(sourceAccount),
                accountType: account?.account_type ?? '',
                accountCurrency: account?.currency ?? '',
                createType: getResolvedAccountCreateType(sourceAccount, accountCreateTypes),
                createCurrency: getResolvedAccountCreateCurrency(sourceAccount, accountCreateCurrencies),
                onChange: (nextValue: string) => updateSourceAccount(sourceAccount, nextValue),
                onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [sourceAccount]: nextValue })),
                onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [sourceAccount]: nextValue })),
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
        )
      ) : files.length === 0 ? (
        <EmptyState
          title="No files staged"
          description="Upload CSV files to assign accounts."
        />
      ) : (
        <AccountMappingTable
          rows={files.map((file) => {
            const value = getResolvedAccountChoice(file.accountId)
            const account = accountById.get(value)

            return {
              id: file.id,
              source: file.name,
              value,
              autoFilled: autoFilledFileAccountIds.has(file.id),
              accountType: account?.account_type ?? '',
              accountCurrency: account?.currency ?? '',
              createType: getResolvedAccountCreateType(file.id, accountCreateTypes),
              createCurrency: getResolvedAccountCreateCurrency(file.id, accountCreateCurrencies),
              onChange: (nextValue: string) => updateFileAccount(file.id, nextValue),
              onCreateTypeChange: (nextValue: string) => setAccountCreateTypes((current) => ({ ...current, [file.id]: nextValue })),
              onCreateCurrencyChange: (nextValue: string) => setAccountCreateCurrencies((current) => ({ ...current, [file.id]: nextValue })),
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
