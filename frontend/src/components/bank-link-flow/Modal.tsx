import { useState } from 'react'
import { Landmark } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { AccountsOverview } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import {
  useAccountBankStatus,
  useBankConnections,
  useBankProviders,
  useDiscoveredBankAccounts,
  useImportRange,
  useLinkBankAccount,
  type BankConnection,
  type ConnectionBankAccount,
} from '@/api/bank-sync'
import { BankAccountStep } from '@/components/bank-link-flow/BankAccountStep'
import { BANK_CONNECTIONS_SETTINGS_PATH, LINKING_PAUSED_REASON } from '@/components/bank-link-flow/constants'
import { StartStep } from '@/components/bank-link-flow/StartStep'
import { useStartChoice } from '@/components/bank-link-flow/useStartChoice'
import {
  LINK_FLOW_STEP_NAMES,
  LINK_FLOW_WORDING,
  describeConnectFirst,
  findPreviousBankAccount,
  getLinkFlowMode,
  pickListedConnection,
  type LinkFlowStep,
} from '@/components/bank-link-flow/wording'
import LoadFailure from '@/components/errors/LoadFailure'
import LoadingRegion from '@/components/loading/Region'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { StepTransition } from '@/components/two-factor/StepTransition'
import { useToast } from '@/hooks/useToast'

const LOADING_OVERLAY_CLASS = 'absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-bg)]'

/** A bank account chosen in settings, and the account chosen there to take it */
export type BankLinkTarget = {
  connection: BankConnection
  bankAccount: ConnectionBankAccount
  account: AccountsOverview
}

type BankLinkFlowModalProps = {
  open: boolean

  /** One of the user's own personal accounts */
  account: AccountsOverview

  /** A bank account already chosen in settings, which starts the flow at where history starts */
  chosen?: Omit<BankLinkTarget, 'account'>
  onClose: () => void

  /** Runs when the link is made, before the flow closes */
  onLinked?: () => void
  onExitComplete?: () => void
}

/**
 * Links an account to a bank account on one of the user's connections, starting its import from a
 * date the user chooses
 *
 * Opened from the account, it chooses the bank account first, from a dropdown of connections when
 * there are several. Opened from a bank account in settings, it starts at where history starts.
 * Either way an account linked before relinks, and one waiting for its bank account to be chosen
 * again chooses it here, each worded so. Connections themselves are added in settings, since one
 * reaches every bank account the user holds with its provider. Callers remount it with a key for
 * each opening, so a choice never carries over
 *
 * It takes the stacked frame wherever it opens. Settings and the edit modal open it over a modal, and
 * the new account's page over the page itself, and one frame keeps it the same flow from each
 */
export function BankLinkFlowModal({
  open,
  account,
  chosen,
  onClose,
  onLinked,
  onExitComplete,
}: BankLinkFlowModalProps) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { data: status, error: statusError } = useAccountBankStatus(account.id, open)
  const { data: providers, error: providersError } = useBankProviders()
  const { data: connections, error: connectionsError } = useBankConnections()
  const link = useLinkBankAccount()

  const [chosenStep, setChosenStep] = useState<LinkFlowStep | null>(null)
  const [chosenConnectionId, setChosenConnectionId] = useState<string | null>(null)
  const [externalId, setExternalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workingConnections = (connections ?? []).filter((connection) => connection.status === 'active')
  const mode = status ? getLinkFlowMode(status) : 'link'
  const previous = status ? findPreviousBankAccount(status) : null
  const wording = LINK_FLOW_WORDING[mode]

  const connection = chosen?.connection ?? pickListedConnection(workingConnections, chosenConnectionId, status)

  // The flow waits on the account's link for its wording and, opened from the account, on the
  // connections and providers, which decide whether there is anything to choose from
  const ready = status !== undefined && (chosen !== undefined || (connections !== undefined && providers !== undefined))
  const loadError = statusError ?? (chosen ? null : (connectionsError ?? providersError))
  const step: LinkFlowStep | null = !ready
    ? null
    : (chosenStep ?? (chosen ? 'start' : connection ? 'account' : 'connect-first'))

  // Listed only while open, since a closed flow stays mounted beside an account that may be linked or
  // archived, which the server refuses a listing for
  const choosesBankAccount = open && !chosen && (step === 'account' || step === 'start')

  const { data: discovered, error: discoveredError } = useDiscoveredBankAccounts(
    choosesBankAccount ? (connection?.id ?? null) : null,
    account.id,
  )
  const bankAccountName =
    chosen?.bankAccount.name ?? discovered?.accounts.find((entry) => entry.external_id === externalId)?.name ?? ''
  const chosenBankAccount = discovered?.accounts.find((entry) => entry.external_id === externalId)
  const provider = providers?.providers.find((entry) => entry.id === connection?.provider)
  const { data: range, error: rangeError } = useImportRange(
    account.id,
    connection?.provider ?? null,
    open && (step === 'account' || step === 'start'),
  )
  const startChoice = useStartChoice(range, account.name)

  const busy = link.isPending

  // Linking waits for the worker that imports the history, so it pauses while the worker is down
  const linkingPaused = providers !== undefined && !providers.sync_running

  const goTo = (next: LinkFlowStep) => {
    setError(null)
    setChosenStep(next)
  }

  const openSettings = () => {
    onClose()
    navigate(BANK_CONNECTIONS_SETTINGS_PATH)
  }

  const confirmLink = () => {
    const externalAccountId = chosen?.bankAccount.external_id ?? externalId
    if (!connection || !externalAccountId || !startChoice.start || startChoice.outOfRange || linkingPaused) return
    setError(null)
    link.mutate(
      {
        account_id: account.id,
        connection_id: connection.id,
        external_account_id: externalAccountId,
        start_date: startChoice.start,
      },
      {
        onSuccess: () => {
          showToast({ status: 'success', text: wording.confirmation })
          onLinked?.()
          onClose()
        },
        onError: (cause) =>
          setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.'),
      },
    )
  }

  const connectFirst =
    step === 'connect-first' && connections && providers ? describeConnectFirst(connections, providers) : null
  const primary =
    step === 'connect-first'
      ? {
          label: connectFirst?.canOpenSettings ? 'Open settings' : 'Close',
          unavailable: false,
          onPrimary: connectFirst?.canOpenSettings ? openSettings : onClose,
        }
      : step === 'account'
        ? { label: 'Continue', unavailable: !chosenBankAccount?.linkable, onPrimary: () => goTo('start') }
        : {
            label: wording.submitLabel,
            unavailable: step === null || !range || !startChoice.start || startChoice.outOfRange,
            onPrimary: confirmLink,
          }
  const backsToAccount = step === 'start' && !chosen

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      titleId="bank-link-title"
      title={wording.title}
      eyebrow={LINK_FLOW_STEP_NAMES[step ?? (chosen ? 'start' : 'account')]}
      RailIcon={Landmark}
      railLabel="Bank"
      level="stacked"
      closeDisabled={busy}
      onExitComplete={onExitComplete}
      footer={
        <ModalFormFooter
          submitLabel={primary.label}
          submitDisabled={busy}
          submitUnavailable={primary.unavailable}
          submitReason={step === 'start' && linkingPaused ? LINKING_PAUSED_REASON : null}
          submitWidthClassName="w-full sm:w-40"
          error={error}
          level="stacked"
          onCancel={backsToAccount ? () => goTo('account') : onClose}
          cancelLabel={backsToAccount ? 'Back' : 'Cancel'}
          onPrimary={primary.onPrimary}
        />
      }
    >
      {loadError && !ready ? (
        <LoadFailure error={loadError} subject="Bank link" />
      ) : (
        <LoadingRegion
          loading={step === null}
          label="Loading bank link"
          animateLoadingHeight
          overlayClassName={LOADING_OVERLAY_CLASS}
        >
          {/* Room for the spinner only while loading, so a short step is not padded out below */}
          <div className={step === null ? 'min-h-32 pb-2' : 'pb-2'}>
            <StepTransition stepKey={step ?? 'loading'}>
              {connectFirst && (
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {connectFirst.message}
                </p>
              )}
              {step === 'account' && connection && (
                <BankAccountStep
                  account={account}
                  mode={mode}
                  previous={previous}
                  connections={workingConnections}
                  connection={connection}
                  onConnectionChange={(connectionId) => {
                    setChosenConnectionId(connectionId)
                    setExternalId(null)
                    startChoice.reset()
                  }}
                  discovered={discovered}
                  discoveredError={discoveredError}
                  chosenId={externalId}
                  onChoose={setExternalId}
                  disabled={busy}
                  onOpenSettings={openSettings}
                />
              )}
              {step === 'start' &&
                (!range && rangeError ? (
                  <LoadFailure error={rangeError} subject="Import start" />
                ) : (
                  <LoadingRegion
                    loading={!range}
                    label="Loading the import range"
                    animateLoadingHeight
                    overlayClassName={LOADING_OVERLAY_CLASS}
                  >
                    {range ? (
                      <StartStep
                        range={range}
                        bankAccountName={bankAccountName}
                        providerName={connection?.provider_name ?? ''}
                        advertisesHistory={provider?.advertises_history ?? true}
                        startChoice={startChoice}
                        disabled={busy}
                      />
                    ) : (
                      <div className="min-h-32" />
                    )}
                  </LoadingRegion>
                ))}
            </StepTransition>
          </div>
        </LoadingRegion>
      )}
    </ModalTitledPanel>
  )
}
