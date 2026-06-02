import { useState } from 'react'
import { CreditCard, Repeat } from 'lucide-react'
import { useDashboardCredit, type FxStatus } from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import IconTooltip from '@/components/IconTooltip'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'

function getCreditTier(utilization: number) {
  if (utilization <= 30) return 'positive'
  if (utilization <= 70) return 'accent'
  return 'negative'
}

type CreditWidgetProps = {
  displayCurrency: string
}

type CreditMode = 'used' | 'available'

function getCreditFxStatusMessage(fxStatus: FxStatus, creditMode: CreditMode) {
  const metricLabel = creditMode === 'used' ? 'Credit used' : 'Credit remaining'

  switch (fxStatus.state) {
    case 'none':
      return 'All credit balances and limits were already in your base currency'
    case 'complete':
      return 'Foreign currency credit balances and limits were converted into your base currency'
    case 'incomplete':
      return `Some foreign currency credit accounts could not be converted. ${metricLabel} is incomplete and only includes credit accounts with available conversion rates`
    case 'unavailable':
      return `Foreign currency credit accounts could not be converted. ${metricLabel} is incomplete and only includes base currency credit accounts`
  }
}

export function CreditWidget({ displayCurrency }: CreditWidgetProps) {
  const { data: dashboardCredit, isLoading: dashboardCreditLoading } = useDashboardCredit()
  const [creditMode, setCreditMode] = useState<CreditMode>('used')
  const creditLimit = dashboardCredit?.credit_limit_total ?? 0
  const creditUsed = dashboardCredit?.credit_used ?? 0
  const fxStatus = dashboardCredit?.fx_status
  const utilization = creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0
  const hasCredit = creditLimit > 0

  const creditAvailable = creditLimit
  const creditRemaining = creditAvailable - creditUsed
  const remainingPct = creditAvailable > 0 ? 100 - utilization : 0
  const displayPct = creditMode === 'used' ? utilization : remainingPct
  const displayAmount = creditMode === 'used' ? creditUsed : creditRemaining
  const creditLoadingText = formatDashboardMoney(88888800, displayCurrency, 'credit')

  // Color tier always derives from utilization so the risk signal stays
  // consistent when toggling between used and remaining credit.
  const size = 120
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (Math.max(0, Math.min(displayPct, 100)) / 100) * circumference
  const tier = getCreditTier(utilization)
  const tierColor = `var(--app-${tier})`
  const tierSoft = `var(--app-${tier}-soft)`

  return (
    <div className="app-card h-[14rem] flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: tierSoft }}>
          <CreditCard size={16} style={{ color: tierColor }} aria-hidden />
        </div>
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="app-label">
            Credit <AppSlotMachineText text={creditMode === 'used' ? 'Used' : 'Remaining'} />
          </span>
          {fxStatus && (
            <IconTooltip
              label="Credit FX status"
              icon="fx"
              fxTone={getFxStatusTone(fxStatus)}
              placement="top"
            >
              <span className="block">{getCreditFxStatusMessage(fxStatus, creditMode)}</span>
              {fxStatus.missing_pairs.length > 0 && (
                <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                  Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
                </span>
              )}
            </IconTooltip>
          )}
        </span>
        {hasCredit && (
          <button
            type="button"
            onClick={() => setCreditMode((mode) => (mode === 'used' ? 'available' : 'used'))}
            title={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
            aria-label={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
            className="app-icon-button ml-auto"
          >
            <Repeat size={12} />
          </button>
        )}
      </div>

      {dashboardCreditLoading || hasCredit ? (
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
              <span className="font-financial font-medium tracking-tight text-2xl max-[1000px]:text-[1.35rem]">
                <AppScrambledNumber
                  text={`${displayPct}%`}
                  loading={dashboardCreditLoading}
                  loadingText="00%"
                />
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]">
              <AppScrambledNumber
                text={formatDashboardMoney(displayAmount, displayCurrency, 'credit')}
                loading={dashboardCreditLoading}
                loadingText={creditLoadingText}
              />
            </p>
            <p className="font-financial mt-1.5 text-sm max-[1000px]:text-[0.7875rem]" style={{ color: 'var(--app-text-muted)' }}>
              of{' '}
              <AppScrambledNumber
                text={formatDashboardMoney(creditAvailable, displayCurrency, 'credit')}
                loading={dashboardCreditLoading}
                loadingText={creditLoadingText}
              />
            </p>
          </div>
        </div>
      ) : (
        <p
          className="my-auto text-center text-sm italic max-[1000px]:text-[0.7875rem]"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          No credit accounts
        </p>
      )}
    </div>
  )
}
