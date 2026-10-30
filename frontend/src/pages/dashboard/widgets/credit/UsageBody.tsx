import { useLayoutEffect, useRef, useState } from 'react'
import { AppScrambledNumber } from '@/components/display/ScrambledNumber'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatDashboardMoney } from '@/pages/dashboard/utils/formatDashboardMoney'
import type { CreditEmptyMessage } from '@/pages/dashboard/utils/creditAccountChoice'
import type { CreditUsageSummary } from '@/pages/dashboard/utils/getCreditUsageSummary'

type CreditUsageBodyProps = {
  summary: CreditUsageSummary
  displayCurrency: string

  // The user has credit accounts but counts none, which reads differently from having none
  allLeftOut: boolean

  // What the widget says when the counted accounts' limits add up to nothing
  emptyMessage: CreditEmptyMessage

  // Opens the account chooser from the empty state that asks the user to pick accounts
  onChooseAccounts: () => void
}

/**
 * Renders the credit progress ring, active mode amount, and the empty states for no credit accounts,
 * for counted accounts with no limit set or no exchange rate and for every one left out
 */
export function CreditUsageBody({
  summary,
  displayCurrency,
  allLeftOut,
  emptyMessage,
  onChooseAccounts,
}: CreditUsageBodyProps) {
  const { creditAvailable, displayAmount, displayAmountRounding, displayPct, hasCredit, tierColor } = summary
  const { currencies } = useMoneyFormatters()

  // The width the amount may take, which is what the ring and the gap leave of the row. The amount
  // steps its font size down to it rather than overflow the widget and lose a digit
  const rowRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const [amountWidth, setAmountWidth] = useState<number>()
  useLayoutEffect(() => {
    const row = rowRef.current
    const ring = ringRef.current
    if (!row || !ring) return

    const measure = () =>
      setAmountWidth(
        row.getBoundingClientRect().width -
          ring.getBoundingClientRect().width -
          parseFloat(getComputedStyle(row).columnGap),
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(ring)
    return () => observer.disconnect()
  }, [allLeftOut, hasCredit])

  const size = 120
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (Math.max(0, Math.min(displayPct, 100)) / 100) * circumference

  if (allLeftOut) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium max-[1000px]:text-[0.7875rem]">No accounts selected</p>
        <p className="text-sm italic max-[1000px]:text-[0.7875rem]" style={{ color: 'var(--app-text-subtle)' }}>
          <button
            type="button"
            onClick={onChooseAccounts}
            className="font-medium underline underline-offset-2"
          >
            Choose a credit account
          </button>{' '}
          to get started
        </p>
      </div>
    )
  }

  if (!hasCredit) {
    return (
      <p
        className={`flex h-full items-center justify-center text-center text-sm max-[1000px]:text-[0.7875rem] ${emptyMessage.needsAttention ? 'font-medium' : 'italic'}`}
        style={{ color: emptyMessage.needsAttention ? 'var(--app-warning-text)' : 'var(--app-text-subtle)' }}
      >
        {emptyMessage.message}
      </p>
    )
  }

  return (
    <div ref={rowRef} data-testid="credit-row" className="flex h-full min-h-0 items-center justify-center gap-4">
      <div ref={ringRef} className="relative aspect-square h-full shrink-0">
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--app-border)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tierColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - filled}
            style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-financial text-2xl font-medium tracking-tight max-[1000px]:text-[1.35rem]">
            <AppScrambledNumber text={`${displayPct}%`} />
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p
          data-testid="credit-amount"
          className="font-financial text-3xl font-normal leading-none tracking-tight max-[1000px]:text-[1.6875rem]"
        >
          <AppScrambledNumber
            text={formatDashboardMoney(displayAmount, displayCurrency, 'credit', currencies, displayAmountRounding)}
            maxWidth={amountWidth}
          />
        </p>
        <p
          className="font-financial mt-1.5 text-sm max-[1000px]:text-[0.7875rem]"
          style={{ color: 'var(--app-text-muted)' }}
        >
          of{' '}
          <AppScrambledNumber
            text={formatDashboardMoney(creditAvailable, displayCurrency, 'credit', currencies, 'down')}
          />
        </p>
      </div>
    </div>
  )
}
