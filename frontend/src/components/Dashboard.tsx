import { useMemo, useState } from 'react'
import { CreditCard, Repeat, Wallet } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
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

  // Net worth history — backend returns a forward-filled day-by-day series
  // over the trailing window_days. We attach dates client-side for the x-axis.
  const netWorthData = useMemo(() => {
    const history = dashboard?.net_worth_history ?? []
    if (history.length === 0) return []
    const today = new Date()
    return history.map((value, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() - (history.length - 1 - i))
      return {
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value,
      }
    })
  }, [dashboard])

  const netWorth = dashboard?.current_net_worth ?? 0
  const netWorthColor = netWorth >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
  const netWorthTrendUp =
    netWorthData.length >= 2 &&
    netWorthData[netWorthData.length - 1].value >= netWorthData[0].value
  const netWorthLineColor = netWorthTrendUp ? 'var(--app-positive)' : 'var(--app-negative)'

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
          {/* Net Worth — current value + sparkline over trailing window */}
          <div
            className="rounded-2xl h-[13.5rem] p-5 pb-2 flex flex-col"
            style={{
              background: 'var(--app-surface-soft)',
              border: '1px solid var(--app-border)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
                <Wallet size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
              </div>
              <span className="app-label">Net Worth</span>
            </div>
            <p
              className="font-financial font-medium tracking-tight leading-none text-2xl"
              style={{ color: netWorthColor }}
            >
              {formatCurrency(netWorth, displayCurrency)}
            </p>
            {netWorthData.length >= 2 && (
              <div className="mt-3 flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={netWorthData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <XAxis
                      dataKey="date"
                      axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={40}
                      tick={{ fill: 'var(--app-text-subtle)', fontSize: 9 }}
                      tickMargin={3}
                    />
                    <YAxis hide domain={['dataMin', 'dataMax']} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--app-surface-soft)',
                        border: '1px solid var(--app-border-strong)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: 'var(--app-text-subtle)' }}
                      itemStyle={{ color: 'var(--app-text)' }}
                      formatter={(value) => [formatCurrency(Number(value), displayCurrency), 'Net Worth']}
                      cursor={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={netWorthLineColor}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

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
