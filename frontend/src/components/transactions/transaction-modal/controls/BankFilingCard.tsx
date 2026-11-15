import type { ReactNode } from 'react'
import type { BankAccountLink, BankReviewItem } from '@/api/bank-sync'
import { FILING_TAB_CLASS, FILING_TAB_STYLE } from '@/components/transactions/transaction-modal/controls/filingCardTab'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { REVIEW_KIND_LABELS, getReviewItemAmount } from '@/components/transactions/utils/bankReview'
import { DATE_FORMATS, formatDate, formatDateLabel } from '@/utils/date'

// What a row shows for a value the provider didn't send, so every card has the same rows. The dash
// the bank review comparison shows for a missing value, since a hyphen reads as a stray mark
const MISSING_VALUE = '—'

type BankFilingCardProps = {
  item: BankReviewItem

  /** The link of the item's account, naming its institution and bank account, absent while unknown */
  link: Pick<BankAccountLink, 'institution_name' | 'external_account_name'> | undefined

  /** The name of the item's account in the app, heading the card when there is no link to name */
  accountName: string

  /** The currency of the item's account, the one the amount is in */
  currency: string

  /** The user's profile timezone, the one the time the item arrived is told in */
  timeZone: string | undefined
}

/**
 * One ruled line of the card. Every line is exactly one rule high, and a value too long for its line
 * wraps onto the next rule rather than between them
 */
function Field({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt
        className="shrink-0 text-xs leading-7 uppercase tracking-wider"
        style={{ color: 'var(--app-filing-card-muted)' }}
      >
        {label}
      </dt>
      <dd
        className={`min-w-0 break-words text-right ${strong ? 'font-semibold' : ''}`}
        style={{ color: 'var(--app-text)' }}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * A field the provider writes in full, closing the card as one section: its label on the first line and
 * its value below, justified across the card's whole width on as many lines as it needs. No rule runs
 * between its lines, and one rule closes it
 */
function SectionField({ label, value }: { label: string; value: string }) {
  return (
    <div className="app-filing-card-section">
      <dt className="text-xs leading-7 uppercase tracking-wider" style={{ color: 'var(--app-filing-card-muted)' }}>
        {label}
      </dt>
      <dd className="break-words text-justify" style={{ color: 'var(--app-text)' }}>
        {value}
      </dd>
    </div>
  )
}

/**
 * A bank item waiting for review, typed up as the provider's filing card: exactly what the bank sent,
 * read-only. The form beside it turns it into a ledger entry. It hangs beside the modal on wide
 * screens and heads the form on narrower ones
 *
 * The card is ruled every 1.75rem, and every line written on it is that high, so the text sits on the
 * rules
 */
export default function BankFilingCard({ item, link, accountName, currency, timeZone }: BankFilingCardProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  const amount = getReviewItemAmount(item, currency, formatMovedCurrency)

  return (
    <FilingCardSheet
      providerName={item.provider_name}
      heading={link?.institution_name ?? accountName}
      kindLabel={REVIEW_KIND_LABELS[item.kind]}
      bankAccountName={link?.external_account_name}
      merchant={item.bank.merchant}
      note={item.bank.note}
      amountText={amount.text}
      date={item.bank.date}
      receivedText={formatDate(new Date(item.received_at), DATE_FORMATS.monthDayTime, timeZone)}
    />
  )
}

type FilingCardSheetProps = {
  providerName: string

  /** The institution, or the account's own name where the link isn't known */
  heading: string

  /** What kind of item the card is about, left out by a card for a transaction already in the ledger */
  kindLabel?: string
  bankAccountName: string | undefined

  /** The merchant or payee the provider names, null when it named none */
  merchant: string | null

  /** The provider's own note or memo about the payment, null when it sent none */
  note: string | null
  amountText: string

  /** The bank's date, as "YYYY-MM-DD" */
  date: string

  /** When the item arrived */
  receivedText: string

  /** Whether the provider's name stands above the card as its tab, left out where the caller draws the tab itself */
  showTab?: boolean

  /** Squares the card's top corners, for a tab that spans its whole top edge */
  flushTop?: boolean
}

/**
 * The provider's filing card itself, typed up from what the bank sent. The review step hangs it
 * beside the modal, and a transaction in the ledger keeps it closed under its From line
 */
export function FilingCardSheet({
  providerName,
  heading,
  kindLabel,
  bankAccountName,
  merchant,
  note,
  amountText,
  date,
  receivedText,
  showTab = true,
  flushTop = false,
}: FilingCardSheetProps) {
  return (
    <div className="relative">
      {/* The tab stands above the card's top edge, flush with its left side, so it carries the same stock but
          none of the shadow, and the card's corner under it is square */}
      {showTab && (
        <span data-testid="filing-card-tab" className={`inline-block ${FILING_TAB_CLASS}`} style={FILING_TAB_STYLE}>
          <span className="normal-case">{providerName}</span>
        </span>
      )}
      <div
        role="region"
        aria-label={`${providerName} filing card`}
        className={`app-filing-card relative font-mono text-sm leading-7 ${flushTop ? 'rounded-b-md' : showTab ? 'rounded-md rounded-tl-none' : 'rounded-md'}`}
      >
        <div className="px-5 pt-4">
          <div className="pb-2" style={{ borderBottom: '2px solid var(--app-filing-card-red)' }}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 break-words font-semibold" style={{ color: 'var(--app-text)' }}>
                {heading}
              </p>
              {kindLabel && (
                <p className="shrink-0 text-xs uppercase tracking-wider" style={{ color: 'var(--app-warning-text)' }}>
                  {kindLabel}
                </p>
              )}
            </div>
            {bankAccountName && (
              <p className="break-words text-xs leading-5" style={{ color: 'var(--app-filing-card-muted)' }}>
                {bankAccountName}
              </p>
            )}
          </div>
        </div>

        <div className="app-filing-card-ruled px-5 pb-7">
          <dl>
            <Field label="Merchant" value={merchant ?? MISSING_VALUE} />
            <Field label="Amount" value={<span className="font-financial">{amountText}</span>} strong />
            <Field label="Date" value={formatDateLabel(date)} />
            <Field label="Received" value={receivedText} />
            <SectionField label="Note" value={note ?? MISSING_VALUE} />
          </dl>
        </div>
      </div>
    </div>
  )
}
