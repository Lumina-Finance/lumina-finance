import { useId, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ModalContentPanel } from '@/components/modal/ContentPanel'
import InstitutionModal from '@/components/reference-modals/InstitutionModal'
import {
  ACCOUNT_TYPE_OPTIONS,
  ARCHIVED_ACCOUNT_MATCH_EXPLANATION,
  CLEARED_ACCOUNT_SOURCES_EXPLANATION,
  CLEARED_ACCOUNT_SOURCES_TITLE,
  COUNTERPARTY_ONLY_EXPLANATION,
  COUNTERPARTY_ONLY_TABLE_TITLE,
  FIXED_ACCOUNT_WARNING_LINK_LABEL,
  FIXED_ACCOUNT_WARNING_TITLE,
  UNSET_BATCH_INSTITUTION,
  getFixedAccountWarning,
} from '@/pages/imports/constants'
import type { ImportAccountSource } from '@/pages/imports/types'
import { buildImportAccountMappingRows, isCreatingImportAccount } from '@/pages/imports/utils'
import {
  EmptyState,
  ImportAccountMappingTable,
  ImportAccountStepBody,
  ImportCreatedAccountsNotice,
  ImportNotice,
  ImportStep,
} from '@/pages/imports/components'
import { useImportInstitutionModal, type TransactionImportWorkflow } from '@/pages/imports/hooks'

// Which batch bar asked for a new institution, since each table has one and a row id can be neither
const IMPORTED_BATCH_TARGET = '__imported_batch__'
const COUNTERPARTY_BATCH_TARGET = '__counterparty_batch__'
type ImportAccountMappingStepProps = Pick<
  TransactionImportWorkflow,
  | 'accountMappingSources'
  | 'accountMappings'
  | 'fixedAccount'
  | 'archivedAccountMatches'
  | 'autoFilledAccountSources'
  | 'handAnsweredAccountSources'
  | 'accountById'
  | 'accountCreateTypes'
  | 'accountCreateCurrencies'
  | 'accountCreateInstitutions'
  | 'updateSourceAccount'
  | 'setAccountCreateTypes'
  | 'setAccountCreateCurrencies'
  | 'setAccountCreateInstitutions'
  | 'accountOptions'
  | 'counterpartyAccountOptions'
  | 'currencyOptions'
  | 'institutionOptions'
  | 'accountsLoading'
  | 'accountsFailed'
  | 'refetchAccounts'
  | 'clearedAccountSourceLabels'
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
 * Account mapping step of the generic CSV import flow, wrapping the shared mapping table with the
 * modal used to create an institution from a row or from the batch bar
 *
 * An import started from an account has no imported-account table at all: every row goes to that
 * account, so the step says so and warns about the one file this page is wrong for. The counterparty
 * table is unaffected, since a transfer still has to say where its money came from or went to
 */
export function ImportAccountMappingStep({
  accountMappingSources,
  accountMappings,
  fixedAccount,
  archivedAccountMatches,
  autoFilledAccountSources,
  handAnsweredAccountSources,
  accountById,
  accountCreateTypes,
  accountCreateCurrencies,
  accountCreateInstitutions,
  updateSourceAccount,
  setAccountCreateTypes,
  setAccountCreateCurrencies,
  setAccountCreateInstitutions,
  accountOptions,
  counterpartyAccountOptions,
  currencyOptions,
  institutionOptions,
  accountsLoading,
  accountsFailed,
  refetchAccounts,
  clearedAccountSourceLabels,
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
}: ImportAccountMappingStepProps) {
  const navigate = useNavigate()
  const leaveImportTitleId = useId()
  const [pendingAccountDestination, setPendingAccountDestination] = useState<string | null>(null)

  // The counterparty table carries its own batch bar, so typing into one bar leaves the other alone
  const [counterpartyBatchType, setCounterpartyBatchType] = useState('')
  const [counterpartyBatchCurrency, setCounterpartyBatchCurrency] = useState('')
  const [counterpartyBatchInstitution, setCounterpartyBatchInstitution] = useState(UNSET_BATCH_INSTITUTION)

  /** Holds same-tab archived-account navigation until the user confirms leaving */
  const handleArchivedAccountLinkClick = (
    event: MouseEvent<HTMLAnchorElement>,
    destination: string,
  ) => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return

    event.preventDefault()
    setPendingAccountDestination(destination)
  }

  const cancelLeaveImport = () => setPendingAccountDestination(null)

  /** Leaves for the one archived account held by the open confirmation */
  const confirmLeaveImport = () => {
    const destination = pendingAccountDestination
    setPendingAccountDestination(null)
    if (!destination) return
    navigate(destination, { state: { editAccount: true } })
  }

  const { openInstitutionModal, institutionModalKey, institutionModalProps } = useImportInstitutionModal((target, institutionId) => {
    if (target === IMPORTED_BATCH_TARGET) {
      setBatchAccountInstitution(institutionId)
    } else if (target === COUNTERPARTY_BATCH_TARGET) {
      setCounterpartyBatchInstitution(institutionId)
    } else {
      setAccountCreateInstitutions((current) => ({ ...current, [target]: institutionId }))
    }
  })

  /**
   * Builds the table rows for a set of sources, keeping both tables identical apart from the
   * outside answer that only a counterparty source is offered
   */
  const buildRows = (sources: ImportAccountSource[]) => buildImportAccountMappingRows(sources, {
    accountMappings,
    accountById,
    autoFilledAccountSources,
    handAnsweredAccountSources,
    getCreateDetails: (source) => ({
      accountType: accountCreateTypes[source],
      currency: accountCreateCurrencies[source],
      institutionId: accountCreateInstitutions[source],
    }),
    onAccountMappingChange: updateSourceAccount,
    setAccountCreateTypes,
    setAccountCreateCurrencies,
    setAccountCreateInstitutions,
  })

  const sharedTableProps = {
    accountTypeOptions: ACCOUNT_TYPE_OPTIONS,
    currencyOptions,
    institutionOptions,
    disabled: accountsLoading,
    currenciesDisabled: currenciesLoading,
    institutionsDisabled: institutionsLoading,
    selectedRowIds: selectedAccountRows,
    onSelectedRowsChange: setSelectedAccountRows,
    onCreateInstitution: (query: string, rowId: string) => openInstitutionModal(query, rowId),
  }

  const importedSources = accountMappingSources.filter((source) => !source.isCounterpartyOnly)
  const counterpartySources = accountMappingSources.filter((source) => source.isCounterpartyOnly)
  const importedRows = buildRows(importedSources)
  const counterpartyRows = buildRows(counterpartySources)

  // Both tables create accounts, so one notice covers them and reads every row of the step. Held
  // back until the account list has landed, since rows rest on create until it does
  const isCreatingAccount = !accountsLoading && isCreatingImportAccount([...importedRows, ...counterpartyRows])

  return (
    <ImportStep index="03" title="Account Mapping">
      {/* Says what this page will do with a file whether or not one is staged, since a file covering
          more than one account has to be sent elsewhere before it is uploaded rather than after */}
      {fixedAccount && (
        <ImportNotice tone="danger" title={FIXED_ACCOUNT_WARNING_TITLE}>
          {getFixedAccountWarning(fixedAccount.name)}
          {' '}
          <Link
            to="/settings/imports"
            className="font-medium underline underline-offset-2 transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ color: 'var(--app-accent)' }}
          >
            {FIXED_ACCOUNT_WARNING_LINK_LABEL}
          </Link>
        </ImportNotice>
      )}
      <ImportAccountStepBody
        accountsFailed={accountsFailed}
        refetchAccounts={refetchAccounts}
        isEmpty={accountMappingSources.length === 0}

        // A fixed account has already been told what will happen, by the notice above, so nothing
        // asks it for a file a second time
        empty={fixedAccount ? null : (
          <EmptyState
            title="No accounts yet"
            description="Upload a file, or check which column is mapped as the account."
          />
        )}
      >
        <>
          {clearedAccountSourceLabels.length > 0 && (
            <ImportNotice title={CLEARED_ACCOUNT_SOURCES_TITLE} items={clearedAccountSourceLabels}>
              {CLEARED_ACCOUNT_SOURCES_EXPLANATION}
            </ImportNotice>
          )}
          {archivedAccountMatches.length > 0 && (
            <ImportNotice
              title="Archived accounts"
              items={archivedAccountMatches.map((match) => (
                // The visible text is the account name, so the label is what says where following
                // it goes, which is all a screen reader's list of links would otherwise show
                <Link
                  key={match.id}
                  to={`/accounts/${match.id}`}
                  state={{ editAccount: true }}
                  aria-label={`Open ${match.name} to unarchive it`}
                  onClick={(event) => handleArchivedAccountLinkClick(event, `/accounts/${match.id}`)}
                  className="font-medium underline underline-offset-2 transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ color: 'var(--app-accent)' }}
                >
                  {match.name}
                </Link>
              ))}
            >
              {ARCHIVED_ACCOUNT_MATCH_EXPLANATION}
            </ImportNotice>
          )}
          {isCreatingAccount && <ImportCreatedAccountsNotice />}
          {/* The scope answers every source rows are written to, so there is no table to show for
              them. The counterparty table below still asks about a transfer's other side */}
          {fixedAccount ? null : (
            <ImportAccountMappingTable
              rows={importedRows}
              options={accountOptions}
              batchAccountType={batchAccountType}
              batchAccountCurrency={batchAccountCurrency}
              batchAccountInstitution={batchAccountInstitution}
              onBatchAccountTypeChange={setBatchAccountType}
              onBatchAccountCurrencyChange={setBatchAccountCurrency}
              onBatchAccountInstitutionChange={setBatchAccountInstitution}
              onBatchCreateInstitution={(query) => openInstitutionModal(query, IMPORTED_BATCH_TARGET)}
              {...sharedTableProps}
            />
          )}
          {counterpartySources.length > 0 && (
            <div className="space-y-3 pt-8">
              <div className="space-y-1">
                <p className="text-sm font-semibold">{COUNTERPARTY_ONLY_TABLE_TITLE}</p>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {COUNTERPARTY_ONLY_EXPLANATION}
                </p>
              </div>
              <ImportAccountMappingTable
                rows={counterpartyRows}
                options={counterpartyAccountOptions}
                batchAccountType={counterpartyBatchType}
                batchAccountCurrency={counterpartyBatchCurrency}
                batchAccountInstitution={counterpartyBatchInstitution}
                onBatchAccountTypeChange={setCounterpartyBatchType}
                onBatchAccountCurrencyChange={setCounterpartyBatchCurrency}
                onBatchAccountInstitutionChange={setCounterpartyBatchInstitution}
                onBatchCreateInstitution={(query) => openInstitutionModal(query, COUNTERPARTY_BATCH_TARGET)}
                {...sharedTableProps}
              />
            </div>
          )}
        </>
      </ImportAccountStepBody>
      <InstitutionModal key={institutionModalKey} {...institutionModalProps} />
      <ModalContentPanel
        open={pendingAccountDestination !== null}
        onClose={cancelLeaveImport}
        titleId={leaveImportTitleId}
      >
        <div className="space-y-1">
          <h3 id={leaveImportTitleId} className="text-base font-semibold">Leave the import page?</h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Opening the account will discard any progress you made in the imports page. You may need to start from the beginning again after you unarchive your account.
          </p>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={cancelLeaveImport}
            className="app-primary-button w-full"
            data-modal-field-tab-stop="true"
          >
            Stay on the import page
          </button>
          <button
            type="button"
            onClick={confirmLeaveImport}
            className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
            style={{ color: 'var(--app-text-muted)' }}
          >
            Leave the import page
          </button>
        </div>
      </ModalContentPanel>
    </ImportStep>
  )
}
