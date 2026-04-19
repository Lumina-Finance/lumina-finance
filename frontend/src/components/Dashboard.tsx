import { useState } from 'react'
import { CreditCard, Repeat } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDashboard } from '@/api/dashboard'
import { formatCurrency } from '@/utils/formatCurrency'

type CreditTier = 'positive' | 'accent' | 'negative'

function getCreditTier(utilization: number): CreditTier {
  if (utilization <= 30) return 'positive'
  if (utilization <= 70) return 'accent'
  return 'negative'
}

export default function Dashboard() {
  const hour = new Date().getHours()
  const greeting =
    hour >= 1 && hour < 4 ? 'Still Up?' :
    hour < 12 ? 'Good Morning' :
    hour < 17 ? 'Good Afternoon' :
    'Good Evening'
  const subtitle =
    hour >= 1 && hour < 4
      ? 'Your finances can wait, your sleep can\u2019t.'
      : 'Here is your financial overview.'

  const { user } = useAuth()
  const { data: dashboard } = useDashboard()
  const [creditMode, setCreditMode] = useState<'used' | 'available'>('used')

  const displayCurrency = user!.base_currency

  // Credit data — backend returns base-currency-scoped totals.
  const creditLimit = dashboard?.credit_limit_total ?? 0
  const creditUsed = dashboard?.credit_used ?? 0
  const utilization = creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0
  const hasCredit = creditLimit > 0

  // Mode-dependent display values: "used" shows utilization%/used $; "available"
  // shows the inverse — both still over the same total limit.
  const availableAmount = Math.max(creditLimit - creditUsed, 0)
  const availablePct = creditLimit > 0 ? 100 - utilization : 0
  const displayPct = creditMode === 'used' ? utilization : availablePct
  const displayAmount = creditMode === 'used' ? creditUsed : availableAmount

  // Donut geometry — bg ring plus a stroke-dashed arc that fills to displayPct.
  // Color tier always derives from utilization so the risk signal stays consistent:
  // 70% available reads green because 30% used is low-risk.
  const size = 120
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (Math.min(displayPct, 100) / 100) * circumference
  const tier = getCreditTier(utilization)
  const tierColor = `var(--app-${tier})`
  const tierSoft = `var(--app-${tier}-soft)`

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title font-medium lg:font-normal text-[clamp(2.4rem,6vw,3.4rem)]">
          {greeting}
        </h1>
        <p className="app-page-description">{subtitle}</p>
      </header>

      <div className="space-y-6">
        {/* Row 1 — Hero metric strip */}
        <div className="grid grid-cols-1 gap-4 grid-cols-4">
          {/* Credit Used / Available donut */}
          <div
            className="rounded-2xl h-[13.5rem] p-5 flex flex-col"
            style={{
              background: 'var(--app-surface-soft)',
              border: '1px solid var(--app-border)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: tierSoft }}>
                <CreditCard size={16} style={{ color: tierColor }} aria-hidden />
              </div>
              <span className="app-label">
                Credit {creditMode === 'used' ? 'Used' : 'Available'}
              </span>
              {hasCredit && (
                <button
                  type="button"
                  onClick={() => setCreditMode((m) => (m === 'used' ? 'available' : 'used'))}
                  title={creditMode === 'used' ? 'Show available credit' : 'Show credit used'}
                  aria-label={creditMode === 'used' ? 'Show available credit' : 'Show credit used'}
                  className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150"
                  style={{
                    background: 'var(--app-accent-soft)',
                    color: 'var(--app-text-muted)',
                  }}
                >
                  <Repeat size={12} />
                </button>
              )}
            </div>

            {hasCredit ? (
              <div className="flex flex-1 min-h-0 items-center justify-center gap-4">
                <div className="relative shrink-0 aspect-square h-full">
                  <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
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
                    <span className="font-financial font-medium tracking-tight text-2xl">
                      {displayPct}%
                    </span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="font-financial font-medium tracking-tight leading-none text-2xl">
                    {formatCurrency(displayAmount, displayCurrency)}
                  </p>
                  <p className="font-financial mt-1.5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                    of {formatCurrency(creditLimit, displayCurrency)}
                  </p>
                </div>
              </div>
            ) : (
              <p
                className="my-auto text-center text-sm italic"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                No credit accounts
              </p>
            )}
          </div>

          <div className="rounded-2xl h-[13.5rem] bg-gray-300" />
          <div className="rounded-2xl h-[13.5rem] bg-gray-300" />
          <div className="rounded-2xl h-[13.5rem] bg-gray-300" />
        </div>

        {/* Row 2 — Charts */}
        <div className="grid grid-cols-1 gap-6 grid-cols-2">
          <div className="rounded-2xl h-[420px] bg-gray-300" />
          <div className="rounded-2xl h-[420px] bg-gray-300" />
        </div>

        {/* Row 3 — Quick insight cards */}
        <div className="grid grid-cols-1 gap-4 grid-cols-4">
          <div className="rounded-2xl h-[320px] bg-gray-300" />
          <div className="rounded-2xl h-[320px] bg-gray-300" />
          <div className="rounded-2xl h-[320px] bg-gray-300" />
          <div className="rounded-2xl h-[320px] bg-gray-300" />
        </div>
      </div>
    </div>
  )
}
