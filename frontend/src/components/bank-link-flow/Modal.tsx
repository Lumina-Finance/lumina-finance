import { useState } from 'react'
import { Landmark } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import {
  useBankProviders,
  useImportRange,
  useLinkBankAccount,
  type BankConnection,
  type ConnectionBankAccount,
} from '@/api/bank-sync'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'
import { findUncoveredUntil, listStartChoices } from '@/components/bank-link-flow/startChoices'
import DateField from '@/components/date-field/DateField'
import LoadFailure from '@/components/errors/LoadFailure'
import { InfoCallout } from '@/components/InfoCallout'
import LoadingRegion from '@/components/loading/Region'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import type { ModalLevel } from '@/components/modal/Shell'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useToast } from '@/hooks/useToast'
import { formatDateLabel } from '@/utils/date'

const LOADING_OVERLAY_CLASS = 'absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-bg)]'

// The start step's own date, kept apart from the preset choices' keys
const CUSTOM_START = 'custom'

const START_ERROR_ID = 'bank-link-start-error'

/** A bank account and the account chosen to take it, which the flow links once a start is chosen */
export interface BankLinkTarget {
  connection: BankConnection
  bankAccount: ConnectionBankAccount
  account: AccountsOverview
}

interface BankLinkFlowModalProps {
  open: boolean
  target: BankLinkTarget

  /** Stacked when opened over another modal, page level when opened over the page */
  level?: ModalLevel
  onClose: () => void

  /** Runs when the link is made, before the flow closes */
  onLinked?: () => void
  onExitComplete?: () => void
}

/**
 * Links a bank account to the account chosen for it, starting the import from a date the user chooses
 *
 * Callers remount it with a key for each opening, so a choice never carries over to another bank
 * account. None of the starts is preselected, so the import never reaches back further than the user
 * meant it to
 */
export function BankLinkFlowModal({ open, target, level = 'page', onClose, onLinked, onExitComplete }: BankLinkFlowModalProps) {
  const { connection, bankAccount, account } = target
  const { showToast } = useToast()
  const { data: providers } = useBankProviders()
  const provider = providers?.providers.find((entry) => entry.id === connection.provider)
  const { data: range, error: rangeError } = useImportRange(account.id, connection.provider, open)
  const link = useLinkBankAccount()

  const [startChoice, setStartChoice] = useState<string | null>(null)
  const [customStart, setCustomStart] = useState('')
  const [error, setError] = useState<string | null>(null)

  const choices = range ? listStartChoices(range, account.name) : []
  const chosenStart = startChoice === CUSTOM_START
    ? customStart
    : choices.find((choice) => choice.key === startChoice)?.date ?? ''
  const isDateDisabled = (iso: string) => Boolean(range && (iso < range.earliest_allowed || iso > range.latest_allowed))
  const startOutOfRange = chosenStart !== '' && isDateDisabled(chosenStart)
  const uncoveredUntil = range && chosenStart ? findUncoveredUntil(range, chosenStart) : null
  const busy = link.isPending

  const confirmLink = () => {
    if (!chosenStart || startOutOfRange) return
    setError(null)
    link.mutate(
      { account_id: account.id, connection_id: connection.id, external_account_id: bankAccount.external_id, start_date: chosenStart },
      {
        onSuccess: () => {
          showToast({ status: 'success', text: 'Linked. Importing history now.' })
          onLinked?.()
          onClose()
        },
        onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.'),
      },
    )
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      titleId="bank-link-title"
      title="Link bank account"
      eyebrow="Choose where history starts"
      RailIcon={Landmark}
      railLabel="Bank"
      level={level}
      closeDisabled={busy}
      onExitComplete={onExitComplete}
      footer={(
        <ModalFormFooter
          submitLabel="Link and import"
          submitDisabled={busy}
          submitUnavailable={!range || !chosenStart || startOutOfRange}
          submitWidthClassName="w-full sm:w-40"
          error={error}
          level={level}
          onCancel={onClose}
          onPrimary={confirmLink}
        />
      )}
    >
      {!range && rangeError
        ? <LoadFailure error={rangeError} subject="Import start" />
        : (
            <LoadingRegion loading={!range} label="Loading the import range" animateLoadingHeight overlayClassName={LOADING_OVERLAY_CLASS}>
              {/* Room for the spinner only while loading, so the step is not padded out below */}
              <div className={range ? 'space-y-4 pb-2' : 'min-h-32 pb-2'}>
                {range && (
                  <>
                    <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      {bankAccount.name} brings in transactions from the start you choose through today. Each one waits for your review first.
                    </p>
                    <div className="space-y-3" role="radiogroup" aria-label="Start">
                      {choices.map((choice) => (
                        <ChoiceCard key={choice.key} selected={startChoice === choice.key} disabled={busy} onSelect={() => setStartChoice(choice.key)}>
                          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>{choice.label}</span>
                            <span className="text-sm tabular-nums" style={{ color: 'var(--app-text)' }}>From {formatDateLabel(choice.date)}</span>
                          </span>
                          {choice.note && <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>{choice.note}</span>}
                        </ChoiceCard>
                      ))}
                      <ChoiceCard
                        selected={startChoice === CUSTOM_START}
                        disabled={busy}
                        onSelect={() => setStartChoice(CUSTOM_START)}
                        extra={(
                          // From sm up the field sits where the other choices show their date and stays in
                          // view, choosing Custom once it's pressed or typed in. Focus alone doesn't choose it,
                          // since the modal focuses its first field on opening. Narrower, it opens beneath the
                          // label once Custom is chosen, growing through its grid row rather than snapping
                          <div
                            className={`grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out sm:visible sm:w-[11.875rem] sm:shrink-0 sm:grid-rows-[1fr] sm:opacity-100 ${startChoice === CUSTOM_START ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0'}`}
                            onPointerDownCapture={() => setStartChoice(CUSTOM_START)}
                            onKeyDownCapture={(event) => {
                              if (event.key !== 'Tab' && event.key !== 'Escape') setStartChoice(CUSTOM_START)
                            }}
                          >
                            <div className="min-h-0 overflow-hidden sm:overflow-visible">
                              {/* Indented to the choice's label, past the radio and its gap, on phones */}
                              <div className="pb-3.5 pl-[2.625rem] pr-3.5 sm:py-3.5 sm:pl-0">
                                <DateField
                                  value={customStart}
                                  ariaLabel="Start date"
                                  disabled={busy}
                                  error={startOutOfRange}
                                  describedById={startOutOfRange ? START_ERROR_ID : undefined}
                                  isDateDisabled={isDateDisabled}
                                  onChange={setCustomStart}
                                />
                                {startOutOfRange && (
                                  <span id={START_ERROR_ID} className="mt-1.5 block text-xs" style={{ color: 'var(--app-negative)' }}>
                                    Outside the allowed range.
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      >
                        <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>Custom date</span>
                        <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                          Any day from {formatDateLabel(range.earliest_allowed)}
                        </span>
                      </ChoiceCard>
                    </div>
                    {provider && !provider.advertises_history && (
                      <InfoCallout>
                        You can import up to {range.provider_history_months} months from {connection.provider_name}, but it doesn't say how much history each bank keeps. Some return less.
                      </InfoCallout>
                    )}
                    {uncoveredUntil && range.ledger_floor && (
                      <InfoCallout>
                        Nothing covers {formatDateLabel(range.ledger_floor)} to {formatDateLabel(uncoveredUntil)}. Add those days by hand if you need them.
                      </InfoCallout>
                    )}
                  </>
                )}
              </div>
            </LoadingRegion>
          )}
    </ModalTitledPanel>
  )
}
