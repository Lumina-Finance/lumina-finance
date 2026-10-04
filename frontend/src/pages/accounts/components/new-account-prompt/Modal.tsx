import { useState, type FormEvent } from 'react'
import { Landmark } from 'lucide-react'
import { useRecordStartingBalance, type AccountsOverview } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { getCurrencyExponent, toMinorUnits } from '@/utils/moneyInput'

const STARTING_BALANCE_INPUT_ID = 'new-account-starting-balance'

// A starting balance is zero or higher, so a hyphen or a true minus typed or pasted into the field
// is answered with a message rather than dropped without a word
const MINUS_SIGN = /[-−]/

// A save that ended with no answer may have landed. The account is read again behind the prompt, and
// a second save is refused once one has landed, so checking the balance first tells the user which
const INTERRUPTED_SAVE_MESSAGE = 'The connection was lost before the balance was confirmed. Check the account\'s balance before trying again.'

type NewAccountPromptModalProps = {
  open: boolean
  account: AccountsOverview
  onClose: () => void
  onExitComplete: () => void
}

/**
 * Follows a new account's creation with its optional starting balance, recorded as a balance
 * adjustment dated today. The account is already saved, so skipping leaves it at a zero balance
 */
export default function NewAccountPromptModal({ open, account, onClose, onExitComplete }: NewAccountPromptModalProps) {
  const { currencies } = useMoneyFormatters()
  const recordStartingBalance = useRecordStartingBalance()
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (typedMinus) return

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
          setSubmitError(error instanceof ApiError ? error.message : INTERRUPTED_SAVE_MESSAGE)
        },
      },
    )
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      onSubmit={handleSubmit}
      titleId="new-account-prompt-title"
      title="Add a starting balance"
      eyebrow={`${account.name} created`}
      RailIcon={Landmark}
      railLabel="Account"
      closeDisabled={recordStartingBalance.isPending}
      footer={(
        <ModalFormFooter
          submitLabel="Continue"
          submitDisabled={recordStartingBalance.isPending}
          submitWidthClassName="w-full sm:w-32"
          error={submitError}
          onCancel={onClose}
          cancelLabel="Skip"
        />
      )}
    >
      <div className="pb-2">
        <CreateModalFieldLabelRow
          htmlFor={STARTING_BALANCE_INPUT_ID}
          label={isLiability ? 'Starting amount owed' : 'Starting balance'}
          error={balanceError}
        />
        <div className="relative">
          {symbol && (
            <span
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--app-text-subtle)' }}
              aria-hidden
            >
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
          />
        </div>
        <p className="mt-1.5 text-xs italic" style={{ color: 'var(--app-text-subtle)' }}>
          Recorded as a balance adjustment dated today.
        </p>
      </div>
    </ModalTitledPanel>
  )
}
