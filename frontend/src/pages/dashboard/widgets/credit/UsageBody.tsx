import { AppScrambledNumber } from '@/components/display/ScrambledNumber'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatDashboardMoney } from '@/pages/dashboard/utils/formatDashboardMoney'
import type { CreditUsageSummary } from '@/pages/dashboard/utils/getCreditUsageSummary'

type CreditUsageBodyProps = {
  summary: CreditUsageSummary
  displayCurrency: string

  // The user has credit accounts but counts none, which reads differently from having none
  allLeftOut: boolean

  // The user counts credit accounts, but their limits add up to nothing
  limitUnset: boolean

  // Opens the account chooser from the empty state that asks the user to pick accounts
  onChooseAccounts: () => void
}

/**
 * Renders the credit progress ring, active mode amount, and the empty states for no credit accounts,
 * for counted accounts with no limit set and for every one left out
 */
export function CreditUsageBody({
  summary,
  displayCurrency,
  allLeftOut,
  limitUnset,
  onChooseAccounts,
}: CreditUsageBodyProps) {
  const {
    creditAvailable,
    displayAmount,
    displayAmountRounding,
    displayPct,
    hasCredit,
    tierColor,
  } = summary
  const { currencies } = useMoneyFormatters()

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
        className="flex h-full items-center justify-center text-center text-sm italic max-[1000px]:text-[0.7875rem]"
        style={{ color: 'var(--app-text-subtle)' }}
      >
        {limitUnset ? 'No credit limit set' : 'No credit accounts'}
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center gap-4">
      <div className="relative aspect-square h-full shrink-0">
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke="var(--app-border)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
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
        <p className="font-financial text-3xl font-normal leading-none tracking-tight max-[1000px]:text-[1.6875rem]">
          <AppScrambledNumber text={formatDashboardMoney(displayAmount, displayCurrency, 'credit', currencies, displayAmountRounding)} />
        </p>
        <p className="font-financial mt-1.5 text-sm max-[1000px]:text-[0.7875rem]" style={{ color: 'var(--app-text-muted)' }}>
          of <AppScrambledNumber text={formatDashboardMoney(creditAvailable, displayCurrency, 'credit', currencies, 'down')} />
        </p>
      </div>
    </div>
  )
}
