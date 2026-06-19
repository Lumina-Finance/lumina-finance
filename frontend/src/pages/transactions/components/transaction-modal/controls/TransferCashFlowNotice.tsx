import { AlertTriangle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { EASE } from '@/pages/transactions/components/transaction-modal/constants'

type TransferCashFlowNoticeProps = {
  show: boolean
}

/**
 * Reminds the user that balance adjustments never count toward cash flow and that a
 * transfer is the right way to record money actually moving between their accounts
 */
export default function TransferCashFlowNotice({
  show,
}: TransferCashFlowNoticeProps) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="transfer-cash-flow-notice"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="overflow-hidden"
        >
          <div
            className="mt-3 rounded-lg px-3 py-2.5"
            style={{
              background: 'var(--app-warning-soft)',
              border: '1px solid var(--app-border)',
            }}
          >
            <div className="flex gap-2.5">
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                style={{ background: 'var(--app-bg)', color: 'var(--app-warning)' }}
              >
                <AlertTriangle size={13} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5">
                  Balance adjustments are not cash flow
                </p>
                <p
                  className="mt-0.5 text-sm leading-5"
                  style={{ color: 'var(--app-text-muted)' }}
                >
                  A balance adjustment only corrects an account&apos;s balance, so it is left
                  out of cash flow. If money actually moved between your accounts, pick a
                  regular transfer category instead.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
