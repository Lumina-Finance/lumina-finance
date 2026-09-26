import { ImportNotice } from '@/pages/imports/components'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'
import { ProviderAccountMappingStep } from '@/pages/imports/sections/ProviderAccountMappingStep'

type FireflyAccountMappingStepProps = Pick<
  FireflyImportWorkflow,
  | 'transactionsFile'
  | 'trackedAccounts'
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
 * Account mapping step of the Firefly III import flow, where the asset and liability accounts of the
 * export map to an existing account or a new one
 */
export function FireflyAccountMappingStep({
  transactionsFile,
  trackedAccounts,
  updateFireflyAccountMapping,
  ...props
}: FireflyAccountMappingStepProps) {
  return (
    <ProviderAccountMappingStep
      {...props}
      index="02"
      description="Asset and liability accounts from the export must map to an existing account or a new one."
      notice={(
        <ImportNotice title="How currencies are read">
          Amounts are written in each mapped account&apos;s currency. Rows without an amount in that currency are skipped and reported after the import.
        </ImportNotice>
      )}
      emptyState={transactionsFile
        ? {
          title: 'No accounts to import into',
          description: 'No row in this export can be imported into an asset or liability account. The preview lists why each row is skipped.',
        }
        : { title: 'No account names detected', description: 'Upload the transactions CSV first.' }}
      sources={trackedAccounts}
      onAccountMappingChange={updateFireflyAccountMapping}
    />
  )
}
