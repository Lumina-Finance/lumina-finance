import type { ReactNode } from 'react'
import type { BankAccountLink, BankReviewItem } from '@/api/bank-sync'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { REVIEW_KIND_LABELS, getReviewItemAmount } from '@/components/transactions/utils/bankReview'
import { DATE_FORMATS, formatDate, formatDateLabel } from '@/utils/date'

// What the card shows for a value the provider didn't send

type BankFilingCardProps = {
  item: BankReviewItem

  /** The link of the item's account, which names its institution and bank account, absent while unknown */
  link: Pick<BankAccountLink, 'institution_name' | 'external_account_name'> | undefined

  /** The name of the item's account in the app, which heads the card when there is no link to name */
  accountName: string

  /** The currency of the item's account, which the amount is in */
  currency: string

  /** The user's profile timezone, which the time the item arrived is told in */
  timeZone: string | undefined
}

/**
 * One ruled line of the card. Every line is exactly one rule high, and a value too long for its line
 * wraps onto the next rule rather than between them
 */
function Field({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs leading-7 uppercase tracking-wider" style={{ color: 'var(--app-filing-card-muted)' }}>
        {label}
      </dt>
      <dd className={`min-w-0 break-words text-right ${strong ? 'font-semibold' : ''}`} style={{ color: 'var(--app-text)' }}>
        {value}
      </dd>
    </div>
  )
}

/**
 * A bank item waiting for review, typed up as the provider's filing card: exactly what the bank sent,
 * read-only, which the form beside it turns into a ledger entry. It hangs beside the modal on wide
 * screens and heads the form on narrower ones
 *
 * The card is ruled every 1.75rem, and every line written on it is that high, so the text sits on the
 * rules
 */
export default function BankFilingCard({
  item,
  link,
  accountName,
  currency,
  timeZone,
}: BankFilingCardProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  const amount = getReviewItemAmount(item, currency, formatMovedCurrency)

  return (
    <div className="relative">
      {/* The tab stands above the card's top edge, flush with its left side, so it carries the same stock but
          none of the shadow, and the card's corner under it is square */}
      <span
        className="inline-block rounded-t-md px-3 pt-1 font-mono text-xs font-semibold uppercase leading-5 tracking-[0.2em]"
        style={{ background: 'var(--app-filing-card)', color: 'var(--app-filing-card-muted)' }}
      >
        {item.provider_name}
      </span>
      <div
        role="region"
        aria-label={`${item.provider_name} filing card`}
        className="app-filing-card relative rounded-md rounded-tl-none font-mono text-sm leading-7"
      >
        <div className="px-5 pt-4">
          <div className="pb-2" style={{ borderBottom: '2px solid var(--app-filing-card-red)' }}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 break-words font-semibold" style={{ color: 'var(--app-text)' }}>
                {link?.institution_name ?? accountName}
              </p>
              <p className="shrink-0 text-xs uppercase tracking-wider" style={{ color: 'var(--app-warning-text)' }}>
                {REVIEW_KIND_LABELS[item.kind]}
              </p>
            </div>
            {link && (
              <p className="break-words text-xs leading-5" style={{ color: 'var(--app-filing-card-muted)' }}>
                {link.external_account_name}
              </p>
            )}
          </div>
        </div>

        <div className="app-filing-card-ruled px-5 pb-7">
          {/* The description is the one field the provider writes in full, so it gets its own heading and
              as many rules as it needs rather than sharing a line with a label */}
          <p className="text-xs leading-7 uppercase tracking-wider" style={{ color: 'var(--app-filing-card-muted)' }}>
            Description from {item.provider_name}
          </p>
          <p className="break-words font-semibold" style={{ color: 'var(--app-text)' }}>{item.bank.description}</p>
          <dl>
            <Field label="Amount" value={<span className="font-financial">{amount.text}</span>} strong />
            <Field label="Date" value={formatDateLabel(item.bank.date)} />
            <Field label="Received" value={formatDate(new Date(item.received_at), DATE_FORMATS.monthDayTime, timeZone)} />
          </dl>
        </div>
      </div>
    </div>
  )
}
