import { useId } from 'react'
import type { BankAccountLink, BankHold } from '@/api/bank-sync'
import { ModalShell } from '@/components/modal/Shell'
import { FilingCardSheet } from '@/components/transactions/transaction-modal/controls/BankFilingCard'
import { formatBankAmount } from '@/components/transactions/utils/bankReview'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { DATE_FORMATS, formatDate } from '@/utils/date'

// A hold is a record of no amount, so its card says so in the account's currency
const NO_AMOUNT = { amount: 0, raw_amount: null }

type BankHoldCardDialogueProps = {
  /** The hold the card is about, kept while the dialogue closes so the card doesn't empty as it leaves */
  hold: BankHold | null
  open: boolean
  onClose: () => void

  /** The link of the hold's account, naming its institution and bank account, absent while unknown */
  link: Pick<BankAccountLink, 'institution_name' | 'external_account_name'> | undefined

  /** The name of the hold's account in the app, heading the card when there is no link to name */
  accountName: string

  /** The currency of the hold's account, the one its $0.00 is written in */
  currency: string

  /** The user's profile timezone, the one the time the hold arrived is told in */
  timeZone: string | undefined
}

/**
 * A bank hold's filing card, opened from its row in the holds strip: the provider's fields for it,
 * read-only, as a bank item waiting for review shows beside its form
 *
 * The card floats on the backdrop alone, with no panel or visible title around it. The title is there
 * for screen readers only, and a tap beside the card or Escape closes it
 */
export function BankHoldCardDialogue({
  hold,
  open,
  onClose,
  link,
  accountName,
  currency,
  timeZone,
}: BankHoldCardDialogueProps) {
  const titleId = useId()
  const { formatMovedCurrency } = useMoneyFormatters()

  return (
    <ModalShell open={open} onClose={onClose} titleId={titleId} panelClassName="w-72 max-w-full" bare>
      <h3 id={titleId} className="sr-only">
        Bank hold
      </h3>
      {hold && (
        <FilingCardSheet
          providerName={hold.provider_name}
          heading={link?.institution_name ?? accountName}
          kindLabel="Hold"
          bankAccountName={link?.external_account_name}
          merchant={hold.merchant}
          note={hold.note}
          amountText={formatBankAmount(NO_AMOUNT, currency, formatMovedCurrency)}
          date={hold.date}
          receivedText={formatDate(new Date(hold.observed_at), DATE_FORMATS.monthDayTime, timeZone)}
        />
      )}
    </ModalShell>
  )
}
