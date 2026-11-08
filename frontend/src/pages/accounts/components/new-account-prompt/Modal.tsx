import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { AnimatePresence } from 'motion/react'
import { Landmark } from 'lucide-react'
import { useNavigate } from 'react-router'
import { StartingBalanceNotSavedError, useRecordStartingBalance, type AccountsOverview } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import { useBankConnections, useBankProviders } from '@/api/bank-sync'
import { BankConnectionsLink } from '@/components/bank-link-flow/BankSyncNotSetUp'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'
import {
  BANK_SYNC_NOT_SET_UP_REASON,
  GROUP_ACCOUNT_LINK_REASON,
  NOTHING_TO_LINK_REASON,
} from '@/components/bank-link-flow/constants'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import { Unfold } from '@/components/display/Unfold'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useAuth } from '@/hooks/useAuth'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import {
  getStartingBalanceProblems,
  MUST_BE_ZERO_OR_HIGHER_MESSAGE,
  STARTING_BALANCE_CONTROL_IDS,
  STARTING_BALANCE_ERROR_ID,
  STARTING_BALANCE_FIELDS,
  STARTING_BALANCE_INPUT_ID,
} from '@/pages/accounts/components/new-account-prompt/startingBalance'
import type { AccountDetailArrivalState } from '@/pages/accounts/detail/constants/accountDetail'
import { isOwnPersonalAccount } from '@/utils/bankSync'
import { formatCurrencySymbol, getSymbolInputStyle } from '@/utils/formatCurrency'
import { getCurrencyExponent, holdsMinus, toMinorUnits } from '@/utils/moneyInput'

type KeepUpToDate = 'bank' | 'manual'

// Arriving on the account's page with this opens the link flow there
const LINK_BANK_ARRIVAL: AccountDetailArrivalState = { linkBank: true }

// A save that ended with no answer is settled by reading the account, and closes as saved when it
// landed. These answer the other two outcomes, keeping the prompt and the typed balance, since the
// page behind is out of reach and nothing records a starting balance once the prompt is gone. A
// save sent again after one that landed unseen also closes as saved
const NOT_SAVED_MESSAGE = "Your starting balance wasn't saved. Continue again to save it."
const UNSETTLED_SAVE_MESSAGE =
  "The connection was lost. Continue again once you're back online, and your starting balance won't be saved twice."

type NewAccountPromptModalProps = {
  open: boolean
  account: AccountsOverview
  onClose: () => void
  onExitComplete: () => void
}

/**
 * Follows a new account's creation by asking how it stays up to date: linked to a bank account and
 * continuing on the account's page with the link flow open, or kept manual with an optional starting
 * balance, recorded as a balance adjustment dated today. The account is already saved, so deciding
 * later leaves it manual at a zero balance
 *
 * A user the deployment lets link nothing is asked only for the starting balance. The prompt waits
 * for the bank reads before it opens, so its choices never change under the user
 */
export default function NewAccountPromptModal({ open, account, onClose, onExitComplete }: NewAccountPromptModalProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { currencies } = useMoneyFormatters()
  const recordStartingBalance = useRecordStartingBalance()
  const { data: providers, isPending: providersPending } = useBankProviders()
  const { data: connections, isPending: connectionsPending } = useBankConnections()
  const [chosen, setChosen] = useState<KeepUpToDate | null>(null)
  const [startingBalance, setStartingBalance] = useState('')

  // The field refuses text holding a minus and keeps its value, so the refused text is read to say why
  const [typedMinus, setTypedMinus] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const exponent = getCurrencyExponent(currencies, account.currency)
  // Written the way the rest of the app writes it, in the reader's own language
  const symbol = currencies.some((currency) => currency.id === account.currency)
    ? formatCurrencySymbol(account.currency)
    : ''
  const isLiability = account.account_kind !== 'asset'
  const balanceInput = useMoneyInput({
    value: startingBalance,
    exponent,
    onChange: (value, typed) => {
      // Settling on blur reports no typed text and leaves the message as it was
      if (typed !== undefined) setTypedMinus(holdsMinus(typed))
      setStartingBalance(value)
      setSubmitError(null)
    },
  })
  const balanceError = typedMinus ? MUST_BE_ZERO_OR_HIGHER_MESSAGE : undefined

  // Linking is offered to a user the bank-linking check allows, on a deployment with a provider. It is
  // refused, saying why, for a group account, while bank sync isn't set up, as the account page's
  // Link bank account is, and when there is no working connection to link through and no provider
  // open to a new one. A failed read leaves the account manual rather than holding the prompt back
  const offersLink = providers !== undefined && providers.may_link && providers.providers.length > 0
  const hasWorkingConnection = connections?.some((connection) => connection.status === 'active') ?? false
  const linkReason = !(user !== null && isOwnPersonalAccount(account, user.id))
    ? GROUP_ACCOUNT_LINK_REASON
    : providers?.sync_running === false
      ? BANK_SYNC_NOT_SET_UP_REASON
      : !hasWorkingConnection && !providers?.providers.some((provider) => provider.offered)
        ? NOTHING_TO_LINK_REASON
        : null
  const choice: KeepUpToDate = !offersLink ? 'manual' : (chosen ?? (linkReason ? 'manual' : 'bank'))
  const ready = !providersPending && (!offersLink || !connectionsPending)

  // The message shows as soon as the minus is refused, so this only holds Continue and brings the field into view
  const refusal = useRefusedSubmit(
    getStartingBalanceProblems(choice === 'manual', typedMinus),
    STARTING_BALANCE_FIELDS,
    STARTING_BALANCE_CONTROL_IDS,
  )

  // Deleting in a field the refused text left empty changes no text, so no change arrives to clear
  // the message, yet it is still the person taking the minus back
  const handleBalanceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') setTypedMinus(false)
  }

  // The refused text never reached the field, so while its message shows Continue refuses, fading with
  // the reason and focusing the field, rather than record what the field held before
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!refusal.guard()) return

    if (choice === 'bank') {
      onClose()
      navigate(`/accounts/${account.id}`, { state: LINK_BANK_ARRIVAL })
      return
    }

    // A blank or zero balance is the balance the account already has, so there is nothing to record
    const amount = toMinorUnits(startingBalance, exponent)
    if (!amount) {
      onClose()
      return
    }

    recordStartingBalance.mutate(
      { accountId: account.id, payload: { amount } },
      {
        onSuccess: onClose,
        onError: (error) => {
          if (error instanceof StartingBalanceNotSavedError) setSubmitError(NOT_SAVED_MESSAGE)
          else setSubmitError(error instanceof ApiError ? error.message : UNSETTLED_SAVE_MESSAGE)
        },
      },
    )
  }

  const startingBalanceField = (
    <>
      <CreateModalFieldLabelRow
        htmlFor={STARTING_BALANCE_INPUT_ID}
        label={isLiability ? 'Starting amount owed' : 'Starting balance'}
        error={balanceError}
        errorId={STARTING_BALANCE_ERROR_ID}
      />
      <div className="relative">
        {symbol && (
          <span className="app-input-prefix pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" aria-hidden>
            {symbol}
          </span>
        )}
        <input
          id={STARTING_BALANCE_INPUT_ID}
          className={`app-input ${symbol ? 'pl-8' : ''} ${balanceError ? 'app-input-error' : ''}`}
          style={getSymbolInputStyle(symbol)}
          aria-invalid={balanceError ? true : undefined}
          aria-describedby={balanceError ? STARTING_BALANCE_ERROR_ID : undefined}
          placeholder="Optional"
          disabled={recordStartingBalance.isPending}
          {...balanceInput}
          onKeyDown={handleBalanceKeyDown}
        />
      </div>
      <p className="mt-1.5 text-xs italic" style={{ color: 'var(--app-text-muted)' }}>
        Your starting balance is recorded as a balance adjustment dated today.
      </p>
    </>
  )

  return (
    <ModalTitledPanel
      open={open && ready}
      onClose={onClose}
      onExitComplete={onExitComplete}
      onSubmit={handleSubmit}
      titleId="new-account-prompt-title"
      title={offersLink ? 'Keep it up to date' : 'Add a starting balance'}
      eyebrow={`${account.name} created`}
      RailIcon={Landmark}
      railLabel="Account"
      closeDisabled={recordStartingBalance.isPending}
      footer={
        <ModalFormFooter
          submitLabel="Continue"
          submitDisabled={recordStartingBalance.isPending}
          submitBlockedReason={refusal.blockedReason}
          submitWidthClassName="w-full sm:w-32"
          error={submitError}
          onCancel={onClose}
          cancelLabel={offersLink ? 'Decide later' : 'Skip'}
        />
      }
    >
      {offersLink ? (
        <div className="pb-2">
          <div className="space-y-3" role="radiogroup" aria-label="How this account stays up to date">
            <div>
              <ChoiceCard
                selected={choice === 'bank'}
                disabled={linkReason !== null || recordStartingBalance.isPending}
                onSelect={() => setChosen('bank')}
              >
                <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                  Link a bank account
                </span>
                <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                  {linkReason ??
                    'Choose one of the bank accounts on your connections. Transactions arrive from the bank and wait for your review, and once the import is reviewed the app offers to line up the opening balance.'}
                </span>
              </ChoiceCard>
              {/* Outside the card, since a link can't sit inside its button. The card prints the reason,
                  and the link starts where the card's text does, under the radio mark */}
              {linkReason === BANK_SYNC_NOT_SET_UP_REASON && (
                <p className="mt-1.5 pl-[2.625rem] text-xs">
                  <BankConnectionsLink onNavigate={onClose} />
                </p>
              )}
            </div>
            <ChoiceCard
              selected={choice === 'manual'}
              disabled={recordStartingBalance.isPending}
              onSelect={() => setChosen('manual')}
            >
              <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                Keep it manual
              </span>
              <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Add transactions yourself or import files. You can link a bank later.
              </span>
            </ChoiceCard>
          </div>
          <AnimatePresence initial={false}>
            {choice === 'manual' && <Unfold key="starting-balance">{startingBalanceField}</Unfold>}
          </AnimatePresence>
        </div>
      ) : (
        <div className="pb-2">{startingBalanceField}</div>
      )}
    </ModalTitledPanel>
  )
}
