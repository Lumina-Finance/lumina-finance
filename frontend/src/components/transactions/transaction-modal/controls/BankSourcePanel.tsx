import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, Landmark } from 'lucide-react'
import type { BankValues } from '@/api/bank-sync'
import { REVIEW_MOTION } from '@/components/transactions/constants/bankReview'
import { FilingCardSheet } from '@/components/transactions/transaction-modal/controls/BankFilingCard'
import { formatRawAmount } from '@/components/transactions/utils/bankReview'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { DATE_FORMATS, formatDate } from '@/utils/date'

type BankSourcePanelProps = {
  providerName: string

  /** What the bank last sent for the transaction */
  bankValues: BankValues

  /** When the app received the bank's record, as the API sent it */
  receivedAt: string

  /** The user's profile timezone, which the time the record arrived is told in */
  timeZone: string | undefined

  /** The institution the transaction's account is linked to, or the account's own name where the link isn't known */
  heading: string

  /** The bank account's name at the institution, absent where the link isn't known */
  bankAccountName: string | undefined

  /** The currency of the transaction's account, which the amount is in */
  currency: string

  /** Starts opened, for a test of the opened card, where the person starts it closed */
  defaultOpen?: boolean
}

/**
 * Heads the form of a bank-imported transaction with the provider it came from, closed to that line
 * alone. Opened, it shows what the bank sent as the provider's filing card, as the review step did,
 * and always read-only, since the ledger has no description field and only the bank changes it
 *
 * The labels take the muted colour, which keeps them above 4.5:1 on the panel in both themes
 */
export default function TransactionBankSourcePanel({
  providerName,
  bankValues,
  receivedAt,
  timeZone,
  heading,
  bankAccountName,
  currency,
  defaultOpen = false,
}: BankSourcePanelProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  const prefersReducedMotion = useReducedMotion()
  const { collapsed, enterTransition, leave } = REVIEW_MOTION[prefersReducedMotion ? 'reduced' : 'full']
  const [open, setOpen] = useState(defaultOpen)
  const cardId = useId()
  const amountText =
    bankValues.amount === null
      ? formatRawAmount(bankValues.raw_amount ?? '', currency).text
      : formatMovedCurrency(bankValues.amount, currency)

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded-lg px-1 py-2 text-left text-xs font-semibold uppercase text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)] motion-reduce:transition-none"
      >
        <Landmark size={13} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1">From {providerName}</span>
        <motion.span
          aria-hidden
          className="inline-flex shrink-0"
          animate={{ rotate: open ? 180 : 0 }}
          transition={enterTransition}
        >
          <ChevronDown size={16} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="card"
            id={cardId}
            className="-mx-6 -mb-4 overflow-hidden px-6"
            initial={collapsed}
            animate={{ height: 'auto', opacity: 1 }}
            exit={leave}
            transition={enterTransition}
          >
            {/* The room around the card is for its shadow, which the unfolding clip would otherwise cut off */}
            <div className="pb-7 pt-1">
              <FilingCardSheet
                showTab={false}
                providerName={providerName}
                heading={heading}
                bankAccountName={bankAccountName}
                description={bankValues.description}
                amountText={amountText}
                date={bankValues.date}
                receivedText={formatDate(new Date(receivedAt), DATE_FORMATS.monthDayTime, timeZone)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
