import { OfxCurrencyMismatchNotice } from '@/pages/imports/ofx/components/OfxCurrencyMismatchNotice'
import { getOfxMappingWording } from '@/pages/imports/ofx/constants'
import type { OfxImportWorkflow } from '@/pages/imports/ofx/hooks'
import { ProviderAccountMappingStep } from '@/pages/imports/sections/ProviderAccountMappingStep'

type OfxAccountMappingStepProps = Pick<
  OfxImportWorkflow,
  | 'format'
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
 * Account mapping step of the OFX and QIF import flows, where each statement in the files maps to
 * an existing account or a new one, worded with the format's own noun for a statement
 */
export function OfxAccountMappingStep({
  format,
  ofxFile,
  accountSources,
  importBuild,
  updateOfxAccountMapping,
  ...props
}: OfxAccountMappingStepProps) {
  const { description, emptyState } = getOfxMappingWording(format.files.statementNoun, Boolean(ofxFile))

  return (
    <ProviderAccountMappingStep
      {...props}
      index="02"
      description={description}
      notice={<OfxCurrencyMismatchNotice mismatches={importBuild.currencyMismatches} />}
      emptyState={emptyState}
      sources={accountSources}
      onAccountMappingChange={updateOfxAccountMapping}
    />
  )
}
