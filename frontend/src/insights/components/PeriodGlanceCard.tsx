import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Sparkles } from 'lucide-react'
import type { FxStatus } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { formatCurrency } from '@/utils/formatCurrency'
import { getPeriodIncomeExpenseFxStatusMessage } from '@/insights/utils/fxTooltipMessages'
import { FxStatusBadge } from './FxStatusBadge'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import { SectionHeader } from './SectionHeader'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'

const PRIMARY_AMOUNT_MAX_REM = 3
const PRIMARY_AMOUNT_MIN_REM = 1.875

type PeriodGlanceTone = 'positive' | 'neutral' | 'negative'

export type PeriodGlancePrimaryMetric = {
  label: string
  value: string
  detail: string
  calculation?: string
  tone: PeriodGlanceTone
}

export type PeriodGlanceSupportItem = {
  label: string
  value: string
  detail: string
  calculation?: string
  tone: PeriodGlanceTone
  fxStatus?: FxStatus
  getFxStatusMessage?: (fxStatus: FxStatus) => string
}

type PeriodGlanceSnapshot = {
  primaryMetric: PeriodGlancePrimaryMetric
  supportItems: PeriodGlanceSupportItem[]
  income: number
  expenses: number
  incomeExpenseFxStatus: FxStatus | undefined
  displayCurrency: string
}

type PeriodGlanceCardProps = {
  primaryMetric: PeriodGlancePrimaryMetric
  supportItems: PeriodGlanceSupportItem[]
  income: number
  expenses: number
  incomeExpenseFxStatus: FxStatus | undefined
  displayCurrency: string
  loading?: boolean
  transitionKey: string
}

function metricToneClass(tone: PeriodGlanceTone) {
  if (tone === 'positive') return 'text-[var(--app-positive)]'
  if (tone === 'negative') return 'text-[var(--app-negative)]'
  return ''
}

function MetricCalculationTooltip({ label, calculation }: { label: string, calculation?: string }) {
  if (!calculation) return null

  return (
    <IconTooltip
      label={`${label} calculation`}
      placement="top"
      widthClassName="w-72"
      size={14}
      strokeWidth={2.25}
    >
      {calculation}
    </IconTooltip>
  )
}

function useFittedPrimaryAmount(value: string) {
  const textRef = useRef<HTMLParagraphElement>(null)
  const [fontSizeRem, setFontSizeRem] = useState(PRIMARY_AMOUNT_MAX_REM)

  useEffect(() => {
    const textElement = textRef.current
    const containerElement = textElement?.parentElement
    if (!textElement || !containerElement) return undefined
    const measuredTextElement = textElement

    let frameId = 0
    let cancelled = false

    function measure() {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        if (cancelled) return

        const previousFontSize = measuredTextElement.style.fontSize
        measuredTextElement.style.fontSize = `${PRIMARY_AMOUNT_MAX_REM}rem`

        const availableWidth = measuredTextElement.clientWidth
        const requiredWidth = measuredTextElement.scrollWidth

        measuredTextElement.style.fontSize = previousFontSize

        const nextFontSize =
          availableWidth > 0 && requiredWidth > availableWidth
            ? Math.max(PRIMARY_AMOUNT_MIN_REM, PRIMARY_AMOUNT_MAX_REM * (availableWidth / requiredWidth))
            : PRIMARY_AMOUNT_MAX_REM

        setFontSizeRem((currentFontSize) =>
          Math.abs(currentFontSize - nextFontSize) < 0.02 ? currentFontSize : nextFontSize,
        )
      })
    }

    measure()
    document.fonts?.ready.then(measure)

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        cancelled = true
        window.cancelAnimationFrame(frameId)
      }
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(containerElement)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [value])

  return [textRef, fontSizeRem] as const
}

export function PeriodGlanceCard({
  primaryMetric,
  supportItems,
  income,
  expenses,
  incomeExpenseFxStatus,
  displayCurrency,
  loading = false,
  transitionKey,
}: PeriodGlanceCardProps) {
  const incomingSnapshot = useMemo<PeriodGlanceSnapshot>(() => ({
    primaryMetric,
    supportItems,
    income,
    expenses,
    incomeExpenseFxStatus,
    displayCurrency,
  }), [displayCurrency, expenses, income, incomeExpenseFxStatus, primaryMetric, supportItems])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useInsightLoadingSnapshot({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })
  const [primaryAmountRef, primaryAmountFontSizeRem] = useFittedPrimaryAmount(displaySnapshot.primaryMetric.value)
  const primaryAmountStyle: CSSProperties | undefined =
    primaryAmountFontSizeRem < PRIMARY_AMOUNT_MAX_REM ? { fontSize: `${primaryAmountFontSizeRem}rem` } : undefined

  return (
    <section className="app-card">
      <SectionHeader icon={Sparkles} label="This Period at a Glance" />

      <div className="relative overflow-hidden" data-tooltip-bounds>
        <InsightLoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="grid gap-4 min-[1400px]:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]">
            <div className="grid gap-5 rounded-xl border border-[var(--app-accent-border)] bg-[var(--app-accent-soft)] p-4 min-[750px]:grid-cols-[minmax(0,60fr)_minmax(0,40fr)] min-[750px]:items-center min-[1400px]:flex min-[1400px]:min-h-52 min-[1400px]:flex-col min-[1400px]:items-stretch min-[1400px]:justify-between">
              <div className="min-w-0 [container-type:inline-size]">
                <p className="app-label inline-flex items-center gap-2">
                  {displaySnapshot.primaryMetric.label}
                  <MetricCalculationTooltip
                    label={displaySnapshot.primaryMetric.label}
                    calculation={displaySnapshot.primaryMetric.calculation}
                  />
                  {displaySnapshot.incomeExpenseFxStatus && (
                    <FxStatusBadge
                      label="Income and expense FX status"
                      status={displaySnapshot.incomeExpenseFxStatus}
                      getMessage={getPeriodIncomeExpenseFxStatusMessage}
                    />
                  )}
                </p>
                <p
                  ref={primaryAmountRef}
                  className={[
                    'mt-3 max-w-full whitespace-nowrap font-financial text-5xl font-normal leading-none',
                    metricToneClass(displaySnapshot.primaryMetric.tone),
                  ].join(' ')}
                  style={primaryAmountStyle}
                >
                  {displaySnapshot.primaryMetric.value}
                </p>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-text-muted)]">
                  {displaySnapshot.primaryMetric.detail}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-[var(--app-border)] pt-3 min-[750px]:grid-cols-1 min-[750px]:border-l min-[750px]:border-t-0 min-[750px]:pl-5 min-[750px]:pt-0 min-[1400px]:mt-5 min-[1400px]:grid-cols-2 min-[1400px]:border-l-0 min-[1400px]:border-t min-[1400px]:pl-0 min-[1400px]:pt-3">
                <div>
                  <p className="app-label app-label-compact inline-flex items-center gap-2">
                    Income
                    <MetricCalculationTooltip
                      label="Income"
                      calculation="Total money in for this range after refunds and reversals are netted. Transfers are excluded"
                    />
                  </p>
                  <p className="mt-1 font-financial text-lg">{formatCurrency(displaySnapshot.income, displaySnapshot.displayCurrency)}</p>
                </div>
                <div>
                  <p className="app-label app-label-compact inline-flex items-center gap-2">
                    Expenses
                    <MetricCalculationTooltip
                      label="Expenses"
                      calculation="Total money out for this range after refunds and reversals are netted. Shown as a positive amount. Transfers are excluded"
                    />
                  </p>
                  <p className="mt-1 font-financial text-lg">{formatCurrency(displaySnapshot.expenses, displaySnapshot.displayCurrency)}</p>
                </div>
              </div>
            </div>

            <div className="grid min-[750px]:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]">
              {displaySnapshot.supportItems.map((item, index) => (
                <div
                  key={item.label}
                  className={[
                    'border-[var(--app-border)] py-4 min-[750px]:p-4',
                    index < displaySnapshot.supportItems.length - 1 ? 'border-b' : '',
                    index === 0 ? 'pt-0 min-[750px]:border-r min-[750px]:pl-0 min-[750px]:pt-0' : '',
                    index === 1 ? 'min-[750px]:pr-0 min-[750px]:pt-0' : '',
                    index === 2
                      ? 'min-[750px]:border-b-0 min-[750px]:border-r min-[750px]:pb-0 min-[750px]:pl-0'
                      : '',
                    index === 3 ? 'pb-0 min-[750px]:pr-0' : '',
                  ].join(' ')}
                >
                  <div className="flex min-h-28 flex-col items-center justify-center text-center">
                    <p className="app-label inline-flex items-center justify-center gap-2">
                      {item.label}
                      <MetricCalculationTooltip
                        label={item.label}
                        calculation={item.calculation}
                      />
                      {item.fxStatus && (
                        <FxStatusBadge
                          label={`${item.label} FX status`}
                          status={item.fxStatus}
                          getMessage={item.getFxStatusMessage}
                        />
                      )}
                    </p>
                    <p
                      className={['mt-1 text-2xl font-semibold leading-tight', metricToneClass(item.tone)].join(' ')}
                    >
                      {item.value}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </InsightLoadingContent>

        <InsightLoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading period at a glance"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
