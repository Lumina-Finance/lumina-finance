import { CREATED_ACCOUNT_CREDIT_LIMIT_NOTE } from '@/pages/imports/constants'
import { ImportNotice } from '@/pages/imports/components'
import { ProviderAccountMappingStep } from '@/pages/imports/sections/ProviderAccountMappingStep'
import { ACTUAL_CREATED_ACCOUNT_EXPLANATION } from '@/pages/imports/actual/constants'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'
import { formatHundredths } from '@/pages/imports/actual/utils/normalise'

type ActualAccountMappingStepProps = Pick<
  ActualImportWorkflow,
  | 'budget'
  | 'accountSources'
  | 'closedAccountsWithBalance'
  | 'closedAccountsKeptOpen'
  | 'closedAccountsLinked'
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
  closedAccountsKeptOpen,
  closedAccountsLinked,
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

  // Only an account the import creates is archived, so one linked to yours stays as it is
  const linkedNotice = closedAccountsLinked.length > 0 && (
    <ImportNotice title="Closed accounts linked to yours" items={closedAccountsLinked.map((account) => account.label)}>
      These are closed in Actual. Their rows go to the accounts you linked them to, which stay open:
    </ImportNotice>
  )

  const balanceNotice = closedAccountsWithBalance.length > 0 && (
    <ImportNotice
      title="Closed accounts with money left"
      items={closedAccountsWithBalance.map((account) => `${account.label}: ${formatHundredths(account.balance, budget?.budgetDecimals)}`)}
    >
      These are closed in Actual, so they are created archived, with a balance adjustment bringing each to zero on the day you import:
    </ImportNotice>
  )

  // An account can't be archived while it holds rows dated after today
  const keptOpenNotice = closedAccountsKeptOpen.length > 0 && (
    <ImportNotice title="Closed accounts with upcoming transactions" items={closedAccountsKeptOpen.map((account) => account.label)}>
      These are closed in Actual but hold transactions dated after today, so they are created open. You can archive them once those dates pass:
    </ImportNotice>
  )

  return (
    <ProviderAccountMappingStep
      {...props}
      index="02"
      description="Every account in the budget, on it or off it, must map to an existing account or a new one."
      notice={<>{currencyNotice}{linkedNotice}</>}
      createdAccountNotice={{ explanation: ACTUAL_CREATED_ACCOUNT_EXPLANATION, items: [CREATED_ACCOUNT_CREDIT_LIMIT_NOTE] }}
      createNotice={<>{balanceNotice}{keptOpenNotice}</>}
      emptyState={budget
        ? { title: 'No accounts to import into', description: 'This budget has no open or closed accounts.' }
        : { title: 'No accounts detected', description: 'Upload the budget export first.' }}
      sources={accountSources}
      onAccountMappingChange={updateActualAccountMapping}
    />
  )
}
