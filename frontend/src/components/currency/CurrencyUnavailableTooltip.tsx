import { useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useCurrencies } from '@/api/currency'
import { CurrencyRetryAction } from '@/components/currency/CurrencyRetryAction'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { useCurrencyRetry } from '@/hooks/useCurrencyRetry'
import { CURRENCY_LIST_LOADING, type CurrencyListState } from '@/utils/currencyStatus'

/** Matches the inline retry fade when the warning is resolved */
const WARNING_FADE_SECONDS = 0.2

interface CurrencyUnavailableTooltipProps {
  unavailable: boolean
  currencyState: CurrencyListState
  label: string
}

/** Keeps recovery available for a failed list or a missing currency without resetting the form */
export function CurrencyUnavailableTooltip({ unavailable, currencyState, label }: CurrencyUnavailableTooltipProps) {
  const warningRef = useRef<HTMLSpanElement>(null)
  const { isFetching, refetch } = useCurrencies()
  const { retrying, handleRetry } = useCurrencyRetry(isFetching, () => refetch({ cancelRefetch: false }))
  const loading = currencyState === 'loading' && !retrying

  return (
    <AnimatePresence initial={false}>
      {(unavailable || retrying) && (
        <motion.span
          ref={warningRef}
          className="inline-flex"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: WARNING_FADE_SECONDS }}
        >
          <IconTooltip label={loading ? 'Loading currencies' : label} level={loading ? 'info' : 'important'} modalFieldTabStop interactive>
            {loading ? CURRENCY_LIST_LOADING : (
              <>
                We're having trouble retrieving the required currency information.{' '}
                <CurrencyRetryAction retrying={retrying} fetching={isFetching} onRetry={() => {
                  // Keep focus on a stable control while the retry link fades into its spinner
                  warningRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
                  return handleRetry()
                }} />
              </>
            )}
          </IconTooltip>
        </motion.span>
      )}
    </AnimatePresence>
  )
}
