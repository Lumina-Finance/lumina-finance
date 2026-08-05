import { motion, useReducedMotion } from 'motion/react'

// How many transaction rows the placeholder list shows. Enough to reach the fold on a laptop
// without implying the account has exactly this many transactions
const PLACEHOLDER_TRANSACTION_ROWS = 6

/**
 * One placeholder block, sweeping left to right unless the user asked for reduced motion
 *
 * @param className - Sizing for this block, since every placeholder is a different shape
 * @param reducedMotion - Read once by the page rather than per block
 */
function SkeletonBlock({ className, reducedMotion }: { className: string; reducedMotion: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md ${className}`}
      style={{ background: 'var(--app-border)' }}
    >
      {!reducedMotion && (
        <motion.span
          className="absolute inset-y-0 left-0 w-2/3"
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

/**
 * Placeholder for one of the two spending breakdown cards, holding the card's own height so the
 * row does not resize when the real cards arrive
 */
function BreakdownCardSkeleton({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <section className="app-card flex h-[440px] flex-col min-[1200px]:h-[400px]">
      <div className="mb-4 flex items-center justify-between gap-4">
        <SkeletonBlock className="h-3 w-40" reducedMotion={reducedMotion} />
        <SkeletonBlock className="h-7 w-28 rounded-full" reducedMotion={reducedMotion} />
      </div>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 5 }, (_, row) => (
          <SkeletonBlock key={row} className="h-10 rounded-xl" reducedMotion={reducedMotion} />
        ))}
      </div>
      <div className="flex-1" />
      <SkeletonBlock className="h-4 w-full" reducedMotion={reducedMotion} />
    </section>
  )
}

/**
 * Stands in for the whole account detail page until the account is ready to render, which outlasts
 * the request itself by the minimum the page holds this on screen for
 *
 * Built from the same grid and card classes the loaded page uses, so every card lands in the
 * position its placeholder occupied and nothing moves under the user. The blocks are hidden from
 * assistive technology behind a single status line, since a screen reader announcing a dozen
 * shapes says nothing a person can act on
 */
export default function AccountDetailLoadingSkeleton() {
  const reducedMotion = useReducedMotion() ?? false

  return (
    <div>
      <span role="status" className="sr-only">Loading account</span>

      <div aria-hidden>
        <div className="grid grid-cols-1 gap-5 min-[750px]:grid-cols-[320px_minmax(0,1fr)]">
          <section className="app-card relative flex flex-col min-[750px]:min-h-[440px]">
            <SkeletonBlock className="h-12 w-12 rounded-xl" reducedMotion={reducedMotion} />
            <SkeletonBlock className="mt-4 h-6 w-48" reducedMotion={reducedMotion} />
            <SkeletonBlock className="mt-2 h-4 w-32" reducedMotion={reducedMotion} />

            <div className="mt-6 flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, fact) => (
                <div key={fact} className="flex items-center justify-between gap-4">
                  <SkeletonBlock className="h-3 w-24" reducedMotion={reducedMotion} />
                  <SkeletonBlock className="h-3 w-16" reducedMotion={reducedMotion} />
                </div>
              ))}
            </div>

            <div className="flex-1" />
            <SkeletonBlock className="h-16 w-full rounded-xl" reducedMotion={reducedMotion} />
          </section>

          <section className="app-card flex flex-col">
            <div className="mb-4 flex items-center justify-between gap-4">
              <SkeletonBlock className="h-3 w-32" reducedMotion={reducedMotion} />
              <SkeletonBlock className="h-7 w-40 rounded-full" reducedMotion={reducedMotion} />
            </div>
            <SkeletonBlock className="h-9 w-56" reducedMotion={reducedMotion} />
            <SkeletonBlock className="mt-6 min-h-[260px] flex-1" reducedMotion={reducedMotion} />
          </section>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 min-[750px]:grid-cols-2 min-[1600px]:grid-cols-3">
          <BreakdownCardSkeleton reducedMotion={reducedMotion} />
          <BreakdownCardSkeleton reducedMotion={reducedMotion} />
          <div className="min-[750px]:col-span-2 min-[1600px]:col-span-1">
            <section className="app-card flex h-[400px] flex-col">
              <div className="mb-4 flex items-center justify-between gap-4">
                <SkeletonBlock className="h-3 w-36" reducedMotion={reducedMotion} />
                <SkeletonBlock className="h-7 w-28 rounded-full" reducedMotion={reducedMotion} />
              </div>
              <SkeletonBlock className="min-h-[200px] flex-1" reducedMotion={reducedMotion} />
            </section>
          </div>
        </div>

        <div className="mt-5">
          <h2 className="mb-4 font-serif text-4xl font-medium leading-none">Transactions</h2>
          <SkeletonBlock className="h-11 w-full rounded-xl" reducedMotion={reducedMotion} />
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: PLACEHOLDER_TRANSACTION_ROWS }, (_, row) => (
              <SkeletonBlock key={row} className="h-14 rounded-xl" reducedMotion={reducedMotion} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
