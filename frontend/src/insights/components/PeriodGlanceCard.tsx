import type { ReactNode } from 'react'
import { formatCurrency } from '@/utils/formatCurrency'

type PeriodGlanceTone = 'positive' | 'neutral' | 'negative'

export type PeriodGlancePrimaryMetric = {
  label: string
  value: string
  detail: string
  tone: PeriodGlanceTone
}

export type PeriodGlanceSupportItem = {
  label: string
  value: string
  detail: string
  tone: PeriodGlanceTone
}

type PeriodGlanceCardProps = {
  header: ReactNode
  primaryMetric: PeriodGlancePrimaryMetric
  supportItems: PeriodGlanceSupportItem[]
  income: number
  expenses: number
  displayCurrency: string
}

function metricToneColor(tone: PeriodGlanceTone) {
  if (tone === 'positive') return 'var(--app-positive)'
  if (tone === 'negative') return 'var(--app-negative)'
  return undefined
}

export function PeriodGlanceCard({
  header,
  primaryMetric,
  supportItems,
  income,
  expenses,
  displayCurrency,
}: PeriodGlanceCardProps) {
  return (
    <section className="app-card">
      {header}

      <div className="grid gap-4 min-[1040px]:grid-cols-[minmax(280px,0.82fr)_minmax(0,1fr)]">
        <div
          className="flex min-h-52 flex-col justify-between rounded-xl border p-4"
          style={{ background: 'var(--app-accent-soft)', borderColor: 'var(--app-accent-border)' }}
        >
          <div>
            <p className="app-label">{primaryMetric.label}</p>
            <p
              className="mt-3 font-financial font-normal tracking-tight leading-none text-5xl max-[1000px]:text-4xl"
              style={{ color: metricToneColor(primaryMetric.tone) }}
            >
              {primaryMetric.value}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
              {primaryMetric.detail}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--app-border)] pt-3">
            <div>
              <p className="app-label app-label-compact">Income</p>
              <p className="mt-1 font-financial text-lg">{formatCurrency(income, displayCurrency)}</p>
            </div>
            <div>
              <p className="app-label app-label-compact">Expenses</p>
              <p className="mt-1 font-financial text-lg">{formatCurrency(expenses, displayCurrency)}</p>
            </div>
          </div>
        </div>

        <div className="grid min-[720px]:grid-cols-2">
          {supportItems.map((item, index) => (
            <div
              key={item.label}
              className={[
                'border-[var(--app-border)] py-3 min-[720px]:p-4 min-[720px]:border-t-0',
                index > 0 ? 'border-t' : '',
                index === 0 ? 'pt-0 min-[720px]:border-b min-[720px]:border-r min-[720px]:pl-0 min-[720px]:pt-0' : '',
                index === 1 ? 'min-[720px]:border-b min-[720px]:pr-0 min-[720px]:pt-0' : '',
                index === 2 ? 'min-[720px]:border-r min-[720px]:pb-0 min-[720px]:pl-0' : '',
                index === 3 ? 'pb-0 min-[720px]:pb-0 min-[720px]:pr-0' : '',
              ].join(' ')}
            >
              <div className="flex min-h-28 flex-col items-center justify-start text-center">
                <p className="app-label">{item.label}</p>
                <p
                  className="mt-1 text-2xl font-semibold leading-tight max-[1000px]:text-xl"
                  style={{ color: metricToneColor(item.tone) }}
                >
                  {item.value}
                </p>
                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--app-text-subtle)' }}>
                  {item.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
