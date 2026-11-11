import { motion, useReducedMotion } from 'motion/react'
import type { BankImportProgress, BankRangeImport } from '@/api/bank-sync'
import { describeImportHeading } from '@/pages/accounts/detail/components/bank-link/status'
import { CONTENT_EASE_CURVE } from '@/utils/widthEase'

// The bar never draws empty, so an import that has only started still shows where it will fill
const MIN_FILL_PERCENT = 4
const FILL_TRANSITION = { duration: 0.45, ease: CONTENT_EASE_CURVE } as const

/**
 * How far an import has got: what it has found and how many of its windows are stored, as a bar that
 * eases out as it fills. A finished import reads as done
 */
export function ImportProgress({
  progress,
  range = null,
}: {
  progress: BankImportProgress

  /** The date range import running on the link, for the heading to name, null while none runs */
  range?: BankRangeImport | null
}) {
  const prefersReducedMotion = useReducedMotion()
  const done = progress.state === 'complete'
  const fraction = progress.windows_total === 0 ? 0 : progress.windows_done / progress.windows_total

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span style={{ color: 'var(--app-text)' }}>{describeImportHeading(progress, range)}</span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--app-text-muted)' }}>
          {progress.items_found} found · {done ? 'Done' : `${progress.windows_done} of ${progress.windows_total}`}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full"
        style={{ background: 'color-mix(in srgb, var(--app-bank) 18%, transparent)' }}
        role="progressbar"
        aria-label="Import"
        aria-valuemin={0}
        aria-valuemax={progress.windows_total}
        aria-valuenow={progress.windows_done}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'var(--app-bank)' }}
          initial={false}
          animate={{ width: `${Math.max(fraction * 100, MIN_FILL_PERCENT)}%` }}
          transition={prefersReducedMotion ? { duration: 0 } : FILL_TRANSITION}
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
        Everything found waits for your review. The import always finishes, however many items it finds.
      </p>
    </div>
  )
}
