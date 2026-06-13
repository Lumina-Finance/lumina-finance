import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { formatCurrency } from '@/utils/formatCurrency'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusTooltip } from '@/components/FxStatusTooltip'

function AccountValueSkeleton({
  label,
  className,
}: {
  label: string
  className: string
}) {
  const shouldReduceMotion = useReducedMotion() ?? false

  return (
    <div
      className={`relative overflow-hidden rounded-md ${className}`}
      role="status"
      aria-label={label}
      style={{
        background: 'var(--app-border)',
      }}
    >
      {!shouldReduceMotion && (
        <motion.span
          className="absolute inset-y-0 left-0 w-2/3"
          aria-hidden
          initial={{ x: '-140%' }}
          animate={{ x: '190%' }}
          transition={{ duration: 1.15, ease: 'easeInOut', repeat: Infinity }}
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.62), transparent)',
          }}
        />
      )}
    </div>
  )
}

function AccountValueFade({
  loading,
  skeleton,
  children,
}: {
  loading: boolean
  skeleton: ReactNode
  children: ReactNode
}) {
  const shouldReduceMotion = useReducedMotion() ?? false
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.42, 0, 0.58, 1] as const }

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {loading ? (
        <motion.div
          key="skeleton"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          {skeleton}
        </motion.div>
      ) : (
        <motion.div
          key="value"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function getAccountSummaryFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'All account balances were already in your base currency'
    case 'complete':
      return 'Foreign currency account balances were converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency accounts could not be converted. Account totals are incomplete and only include accounts with available conversion rates'
    case 'unavailable':
      return 'Foreign currency accounts could not be converted. Account totals are incomplete and only include base currency accounts'
  }
}

export default function AccountSummaryStatement({
  error,
  isLoading,
  netWorth,
  totalAssets,
  totalDebts,
  assetCount,
  debtCount,
  displayCurrency,
  fxStatus,
}: {
  error: unknown
  isLoading: boolean
  netWorth: number
  totalAssets: number
  totalDebts: number
  assetCount: number
  debtCount: number
  displayCurrency: string
  fxStatus: FxStatus
}) {
  if (error) {
    return (
      <p className="py-2 font-medium" style={{ color: 'var(--app-negative)' }}>
        Unable to load accounts.
      </p>
    )
  }

  return (
    <section>
      <div
        className="mb-3"
        style={{
          height: 1,
          background:
            'linear-gradient(to right, var(--app-accent), var(--app-accent-border), transparent)',
        }}
      />
      <div className="grid gap-5 min-[730px]:flex min-[730px]:flex-wrap min-[730px]:items-end min-[730px]:justify-between min-[730px]:gap-6">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <p className="app-label">Net Worth</p>
            <FxStatusTooltip
              label="Net worth FX status"
              fxStatus={fxStatus}
              getMessage={getAccountSummaryFxStatusMessage}
            />
          </div>
          <AccountValueFade
            loading={isLoading}
            skeleton={(
              <AccountValueSkeleton
                label="Loading net worth value"
                className="h-[3.125rem] w-[min(18rem,76vw)] min-[730px]:h-[3.375rem]"
              />
            )}
          >
            <p
              className="font-financial text-[3.125rem] font-semibold leading-none tracking-tight min-[730px]:text-[3.375rem]"
              style={{
                color: netWorth >= 0 ? 'var(--app-positive)' : 'var(--app-negative)',
              }}
            >
              {formatCurrency(netWorth, displayCurrency)}
            </p>
          </AccountValueFade>
        </div>

        <div className="grid grid-cols-2 gap-4 pb-1.5 min-[730px]:flex min-[730px]:gap-8">
          <div className="text-left min-[730px]:text-right">
            <p className="app-label mb-0.5">Assets</p>
            <AccountValueFade
              loading={isLoading}
              skeleton={(
                <div className="grid w-max justify-items-start gap-1.5 min-[730px]:ml-auto min-[730px]:justify-items-end">
                  <AccountValueSkeleton
                    label="Loading asset value"
                    className="h-6 w-28"
                  />
                  <AccountValueSkeleton
                    label="Loading asset account count"
                    className="h-4 w-20"
                  />
                </div>
              )}
            >
              <>
                <p
                  className="font-financial text-xl font-medium"
                  style={{ color: totalAssets >= 0 ? 'var(--app-positive)' : 'var(--app-negative)' }}
                >
                  {formatCurrency(totalAssets, displayCurrency)}
                </p>
                <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  {assetCount} account{assetCount !== 1 ? 's' : ''}
                </p>
              </>
            </AccountValueFade>
          </div>
          <div className="text-right">
            <p className="app-label mb-0.5">Liabilities</p>
            <AccountValueFade
              loading={isLoading}
              skeleton={(
                <div className="ml-auto grid w-max justify-items-end gap-1.5">
                  <AccountValueSkeleton
                    label="Loading liability value"
                    className="h-6 w-28"
                  />
                  <AccountValueSkeleton
                    label="Loading liability account count"
                    className="h-4 w-20"
                  />
                </div>
              )}
            >
              <>
                <p
                  className="font-financial text-xl font-medium"
                  style={{ color: totalDebts < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
                >
                  {formatCurrency(totalDebts, displayCurrency)}
                </p>
                <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  {debtCount} account{debtCount !== 1 ? 's' : ''}
                </p>
              </>
            </AccountValueFade>
          </div>
        </div>
      </div>
    </section>
  )
}
