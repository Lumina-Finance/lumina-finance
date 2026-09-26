import { ImportNotice } from '@/pages/imports/components'
import { ProviderAccountMappingStep } from '@/pages/imports/sections/ProviderAccountMappingStep'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'
import { formatHundredths } from '@/pages/imports/actual/utils/normalise'

type ActualAccountMappingStepProps = Pick<
  ActualImportWorkflow,
  | 'budget'
  | 'accountSources'
  | 'closedAccountsWithBalance'
  | 'accountMappings'
  | 'autoFilledAccountSources'
  | 'handAnsweredAccountSources'
  | 'accountById'
  | 'accountCreateDetails'
  | 'updateActualAccountMapping'
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
 * Account mapping step of the Actual Budget import flow, where every account in the budget, on it
 * or off it, maps to an existing account or a new one in the budget's one currency
 */
export function ActualAccountMappingStep({
  budget,
  accountSources,
  closedAccountsWithBalance,
  updateActualAccountMapping,
  ...props
}: ActualAccountMappingStepProps) {
  // Actual only records a currency when its currency feature is on, so otherwise the user says it
  const currencyNotice = budget && (
    <ImportNotice title="One currency">
      {budget.currencyCode
        ? `This budget is in ${budget.currencyCode}, so every account it maps to must be in ${budget.currencyCode} too.`
        : "Actual doesn't record which currency this budget is in, so choose it for each new account. Every account must share one currency."}
    </ImportNotice>
  )

  return (
    <ProviderAccountMappingStep
      {...props}
      index="02"
      description="Every account in the budget, on it or off it, must map to an existing account or a new one."
      notice={currencyNotice}
      createNotice={closedAccountsWithBalance.length > 0 && (
        <ImportNotice
          title="Closed accounts with money left"
          items={closedAccountsWithBalance.map((account) => `${account.label}: ${formatHundredths(account.balance)}`)}
        >
          These are closed in Actual, so they are created archived, with a balance adjustment bringing each to zero on the day you import:
        </ImportNotice>
      )}
      emptyState={budget
        ? { title: 'No accounts to import into', description: 'This budget has no open or closed accounts.' }
        : { title: 'No accounts detected', description: 'Upload the budget export first.' }}
      sources={accountSources}
      onAccountMappingChange={updateActualAccountMapping}
    />
  )
}
