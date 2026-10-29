import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { AnimatePresence } from 'motion/react'
import { Landmark } from 'lucide-react'
import { useNavigate } from 'react-router'
import { StartingBalanceNotSavedError, useRecordStartingBalance, type AccountsOverview } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import { useBankConnections, useBankProviders } from '@/api/bank-sync'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'
import {
  GROUP_ACCOUNT_LINK_REASON,
  LINKING_PAUSED_REASON,
  NOTHING_TO_LINK_REASON,
} from '@/components/bank-link-flow/constants'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import { Unfold } from '@/components/display/Unfold'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useAuth } from '@/hooks/useAuth'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import type { AccountDetailArrivalState } from '@/pages/accounts/detail/constants/accountDetail'
import { isOwnPersonalAccount } from '@/utils/bankSync'
import { getCurrencyExponent, toMinorUnits } from '@/utils/moneyInput'

type KeepUpToDate = 'bank' | 'manual'

const STARTING_BALANCE_INPUT_ID = 'new-account-starting-balance'

// Arriving on the account's page with this opens the link flow there
const LINK_BANK_ARRIVAL: AccountDetailArrivalState = { linkBank: true }

// A starting balance is zero or higher, so a hyphen or a true minus typed or pasted into the field
// is answered with a message rather than dropped without a word
const MINUS_SIGN = /[-−]/

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
 * Follows a new account's creation by asking how it stays up to date: linked to a bank account, which
 * continues on the account's page with the link flow open, or kept manual with an optional starting
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
  const symbol = currencies.find((currency) => currency.id === account.currency)?.symbol
  const isLiability = account.account_kind !== 'asset'
  const balanceInput = useMoneyInput({
    value: startingBalance,
    exponent,
    onChange: (value, typed) => {
      // Settling on blur reports no typed text, which leaves the message as it was
      if (typed !== undefined) setTypedMinus(MINUS_SIGN.test(typed))
      setStartingBalance(value)
      setSubmitError(null)
    },
  })
  const balanceError = typedMinus ? 'Must be zero or higher' : undefined

  // Linking is offered to a user the bank-linking check allows, on a deployment with a provider. It is
  // refused, saying why, for a group account, while bank sync isn't running, as the account page's
  // Link bank account is, and when there is no working connection to link through and no provider
  // open to a new one. A failed read leaves the account manual rather than holding the prompt back
  const offersLink = providers !== undefined && providers.may_link && providers.providers.length > 0
  const hasWorkingConnection = connections?.some((connection) => connection.status === 'active') ?? false
  const linkReason = !(user !== null && isOwnPersonalAccount(account, user.id))
    ? GROUP_ACCOUNT_LINK_REASON
    : providers?.sync_running === false
      ? LINKING_PAUSED_REASON
      : !hasWorkingConnection && !providers?.providers.some((provider) => provider.offered)
        ? NOTHING_TO_LINK_REASON
        : null
  const choice: KeepUpToDate = !offersLink ? 'manual' : (chosen ?? (linkReason ? 'manual' : 'bank'))
  const ready = !providersPending && (!offersLink || !connectionsPending)

  // Deleting in a field the refused text left empty changes no text, so no change arrives to clear
  // the message, yet it is still the person taking the minus back
  const handleBalanceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') setTypedMinus(false)
  }

  // The refused text never reached the field, so Continue takes the field as it stands, closing a
  // blank one as blank whether or not the message still shows
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

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
          aria-invalid={balanceError ? true : undefined}
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
