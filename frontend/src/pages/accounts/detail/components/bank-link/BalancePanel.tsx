import type { ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import type { BankBalance } from '@/api/bank-sync'
import { Unfold } from '@/components/display/Unfold'
import { LabelWithHint } from '@/components/tooltips/LabelWithHint'
import { useAuth } from '@/hooks/useAuth'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { DATE_FORMATS, formatDate } from '@/utils/date'

type BalanceFactProps = {
  label: string
  value: string
  color: string

  /** Why the value reads as it does, shown after the label, and the name of the button that opens it */
  hint?: { label: string; text: ReactNode }
}

/**
 * One balance, labelled like the facts above it in the bank link section, or as a statement line on
 * phones. A value never breaks across lines, so a figure reads whole with its sign, and one too wide
 * to sit beside its label on a phone goes under it instead. Beside the others it takes an equal share
 * of the row, and never less than its own width
 */
function BalanceFact({ label, value, color, hint }: BalanceFactProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 sm:block sm:min-w-max sm:flex-1">
      <dt
        className="flex shrink-0 items-center gap-1 text-xs font-medium uppercase"
        style={{ color: 'var(--app-text-subtle)' }}
      >
        <LabelWithHint label={label} hint={hint?.text} hintLabel={hint?.label} hintPlacement="top" />
      </dt>
      <dd
        className="ml-auto whitespace-nowrap text-right font-financial text-lg font-semibold tabular-nums sm:mt-0.5 sm:text-left"
        style={{ color }}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * A part of the caption after its date, kept on one line with the dot that introduces it, so a
 * caption that wraps never leaves a dot at the end of a line
 */
function CaptionPart({ children }: { children: ReactNode }) {
  return (
    <>
      {' '}
      <span className="inline-flex items-center gap-1">· {children}</span>
    </>
  )
}

const GAP_HINT = {
  label: 'Why the balances differ',
  text: "Most gaps come from items still waiting for review, or from transactions the bank hasn't posted yet.",
}

type BalancePanelProps = {
  balance: BankBalance
  currency: string
  providerName: string

  /** What the balances ask of the user, under a hairline at the panel's foot. It unfolds as it comes and goes */
  footer?: ReactNode
}

/**
 * The bank's balance beside the ledger's at the end of the bank's balance date, and the ledger against
 * the bank, so a gap shows without anything correcting it. A bank balance that can't be read exactly
 * in the account's currency shows as unavailable, with nothing to compare, and an available balance
 * that can't is marked unavailable in the caption rather than left out. On phones each balance takes
 * a row, label on the left and amount on the right. On wider screens the balances share a row in
 * equal columns, and those too long to fit side by side move to another row. An explanation beside a
 * balance is about the comparison, so it opens above all the balances, or below them where there is
 * no room above, and covers none of them. A footer, such as the balance match offer, sits under
 * the caption with no box of its own
 */
export function BalancePanel({ balance, currency, providerName, footer }: BalancePanelProps) {
  const { formatCurrency, formatMovedCurrency } = useMoneyFormatters()
  const { user } = useAuth()
  const { amount, difference } = balance
  const asOf = formatDate(new Date(balance.balance_date), DATE_FORMATS.monthDayTime, user?.tz)

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--app-surface-soft)' }}>
      <dl className="flex flex-col gap-y-2 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-3" data-tooltip-subject>
        {amount === null ? (
          <BalanceFact
            label={providerName}
            value="Unavailable"
            color="var(--app-text-muted)"
            hint={{
              label: 'Why the balance is unavailable',
              text: `${providerName}'s balance for this account can't be read exactly in ${currency}, so it isn't compared with your ledger.`,
            }}
          />
        ) : (
          <BalanceFact label={providerName} value={formatCurrency(amount, currency)} color="var(--app-text)" />
        )}
        <BalanceFact label="Ledger" value={formatCurrency(balance.ledger_balance, currency)} color="var(--app-text)" />
        {difference !== null &&
          (difference === 0 ? (
            <BalanceFact label="Difference" value="None" color="var(--app-positive)" />
          ) : (
            <BalanceFact
              label="Difference"
              value={formatMovedCurrency(difference, currency)}
              color="var(--app-warning-text)"
              hint={GAP_HINT}
            />
          ))}
      </dl>
      <p className="mt-3 text-xs" style={{ color: 'var(--app-text-muted)' }}>
        As of {asOf}
        {balance.available !== null && (
          <CaptionPart>{formatCurrency(balance.available, currency)} available</CaptionPart>
        )}
        {balance.available_unreadable && (
          <CaptionPart>
            <LabelWithHint
              label="Available balance unavailable"
              hint={`${providerName}'s available balance for this account can't be read exactly in ${currency}, so it isn't shown. Your ledger isn't affected.`}
              hintLabel="Why the available balance is unavailable"
              hintPlacement="top"
            />
          </CaptionPart>
        )}
      </p>
      <AnimatePresence initial={false}>
        {footer && (
          <Unfold key="footer" clipsOnlyWhileChanging>
            <div className="border-t pt-4" style={{ borderColor: 'var(--app-border)' }}>
              {footer}
            </div>
          </Unfold>
        )}
      </AnimatePresence>
    </div>
  )
}
