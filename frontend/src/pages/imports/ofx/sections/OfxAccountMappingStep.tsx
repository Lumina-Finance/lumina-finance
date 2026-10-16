import { OfxCurrencyMismatchNotice } from '@/pages/imports/ofx/components/OfxCurrencyMismatchNotice'
import type { OfxImportWorkflow } from '@/pages/imports/ofx/hooks'
import { ProviderAccountMappingStep } from '@/pages/imports/sections/ProviderAccountMappingStep'

type OfxAccountMappingStepProps = Pick<
  OfxImportWorkflow,
  | 'ofxFile'
  | 'accountSources'
  | 'importBuild'
  | 'accountMappings'
  | 'autoFilledAccountSources'
  | 'handAnsweredAccountSources'
  | 'accountById'
  | 'accountCreateDetails'
  | 'updateOfxAccountMapping'
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
 * Account mapping step of the OFX import flow, where each statement in the file maps to an
 * existing account or a new one in the statement's currency
 */
export function OfxAccountMappingStep({ ofxFile, accountSources, importBuild, updateOfxAccountMapping, ...props }: OfxAccountMappingStepProps) {
  return (
    <ProviderAccountMappingStep
      {...props}
      index="02"
      description="Every statement in the file must map to an existing account or a new one."
      notice={<OfxCurrencyMismatchNotice mismatches={importBuild.currencyMismatches} />}
      emptyState={ofxFile
        ? { title: 'No accounts to import into', description: 'None of the statements in this file has transactions.' }
        : { title: 'No statements detected', description: 'Upload the statement file first.' }}
      sources={accountSources}
      onAccountMappingChange={updateOfxAccountMapping}
    />
  )
}
