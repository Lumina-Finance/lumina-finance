import { useState } from 'react'
import { motion } from 'motion/react'
import { StickyNote, Tag as TagIcon } from 'lucide-react'
import type { Institution } from '@/api/institutions'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import { formatCurrency } from '@/utils/formatCurrency'
import { resolveInstitutionLogoUrl } from '@/utils/institutionLogo'

const MAX_VISIBLE_TAGS = 1
const DEFAULT_CATEGORY_ICON = '🏷️'
const ROW_EXIT_EASE = [0.25, 0.1, 0.25, 1] as const

interface TransactionRowProps {
  accountName?: string
  accountInstitution?: Institution | null
  category: Category | undefined
  currency: string
  readOnlyReason?: string
  transaction: Transaction
  // Skips the height collapse on removal so a deletion just fades when the viewer prefers reduced motion
  prefersReducedMotion?: boolean | null
  // Makes the row appear without the grow in, used for a lazy loaded batch that would otherwise all grow at once
  skipEnterAnimation?: boolean
  onOpen: (transaction: Transaction) => void
}

function amountColor(category: Category | undefined, amount: number) {
  if (category?.kind === 'expense' && amount > 0) return 'var(--app-positive)'
  if (category?.kind === 'income' && amount < 0) return 'var(--app-negative)'
  return 'var(--app-text)'
}

function AccountLogo({
  accountName,
  institution,
}: {
  accountName: string | undefined
  institution: Institution | null | undefined
}) {
  const logoSrc = resolveInstitutionLogoUrl(institution)
  const fallback = accountName?.trim().charAt(0).toUpperCase() || '$'

  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md"
      style={{
        background: 'var(--app-input-bg)',
        border: '1px solid var(--app-border)',
      }}
    >
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={`${institution?.name ?? accountName ?? 'Account'} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      ) : (
        <span
          className="select-none text-[0.625rem] font-semibold leading-none"
          style={{ color: 'var(--app-text-muted)' }}
        >
          {fallback}
        </span>
      )}
    </span>
  )
}

function ReadOnlyReasonPill({ reason }: { reason: string }) {
  return (
    <span
      className="inline-flex w-fit max-w-full rounded-full border px-1.5 py-0.5 text-[0.6875rem] leading-none"
      style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-subtle)' }}
    >
      <span className="min-w-0 truncate">{reason}</span>
    </span>
  )
}

function TagTooltip({ tags }: { tags: Transaction['tags'] }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 flex w-52 -translate-x-1/2 flex-col items-start gap-1">
      <span
        className="app-tag-tooltip-glass absolute -inset-6 rounded-3xl"
        style={{
          maskImage: 'radial-gradient(ellipse farthest-side at center, black 0%, black 55%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse farthest-side at center, black 0%, black 55%, transparent 100%)',
        }}
        aria-hidden
      />
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="relative inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            background: 'var(--app-surface-soft)',
            color: 'var(--app-text-muted)',
            border: '1px solid var(--app-border)',
          }}
        >
          <TagIcon size={11} aria-hidden className="shrink-0" />
          <span className="truncate">{tag.name}</span>
        </span>
      ))}
    </span>
  )
}

export default function TransactionRow({
  accountName,
  accountInstitution,
  category,
  currency,
  readOnlyReason,
  transaction,
  prefersReducedMotion,
  skipEnterAnimation = false,
  onOpen,
}: TransactionRowProps) {
  // The row clips its content only while the height animates, so the grow and collapse read cleanly
  // while the resting row still lets a tag tooltip overflow past its edges
  const [isAnimatingHeight, setIsAnimatingHeight] = useState(false)
  const categoryName = category?.name ?? 'Uncategorized'
  const categoryIcon = category?.icon ?? DEFAULT_CATEGORY_ICON
  const fallbackTitle = category?.kind === 'transfer' ? 'Transfer' : 'Transaction'
  const title = transaction.merchant_name ?? fallbackTitle
  const hasNotes = Boolean(transaction.notes?.trim())
  const tags = [...(transaction.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS)
  const extraTagCount = Math.max(tags.length - visibleTags.length, 0)
  const hasVisibleTags = visibleTags.length > 0
  const hasSupplementalMeta = hasNotes || hasVisibleTags
  const hasAccountMeta = !!accountName || !!accountInstitution
  const readOnly = Boolean(readOnlyReason)
  const formattedAmount = `${transaction.amount >= 0 ? '+' : '-'}${formatCurrency(Math.abs(transaction.amount), currency)}`
  const transactionAmountColor = amountColor(category, transaction.amount)

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(transaction)}
      initial={skipEnterAnimation ? false : prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
      // The padding targets mirror the py-2.5 class so the row grows from a fully collapsed height
      animate={{ opacity: readOnly ? 0.68 : 1, height: 'auto', paddingTop: '0.625rem', paddingBottom: '0.625rem' }}
      exit={
        prefersReducedMotion
          ? { opacity: 0, transition: { duration: 0 } }
          : {
              opacity: 0,
              height: 0,
              paddingTop: 0,
              paddingBottom: 0,
              overflow: 'hidden',
              transition: { duration: 0.24, ease: ROW_EXIT_EASE },
            }
      }
      transition={{ duration: prefersReducedMotion ? 0 : 0.24, ease: ROW_EXIT_EASE }}
      onAnimationStart={() => setIsAnimatingHeight(true)}
      onAnimationComplete={() => setIsAnimatingHeight(false)}
      className="block w-full cursor-pointer px-3 py-2.5 text-left transition-colors duration-100 hover:bg-[var(--app-surface-soft)] focus-visible:bg-[var(--app-surface-soft)] focus-visible:outline-none min-[1300px]:col-span-full min-[1300px]:grid min-[1300px]:grid-cols-subgrid min-[1300px]:items-center min-[1300px]:gap-x-3"
      style={{ borderBottom: '1px solid var(--app-border)', overflow: isAnimatingHeight ? 'hidden' : 'visible' }}
    >
      {/* Desktop row: each cell is a direct child of the row's subgrid, so every row shares the same
          column tracks and stays aligned. The category and account tracks grow to their widest content
          across all rows, showing long names while there is room and truncating only when there is not,
          with notes as the flexible filler that compresses first */}
      <span className="hidden text-2xl leading-none min-[1300px]:block" aria-hidden>
        {categoryIcon}
      </span>

      <span className="hidden min-w-0 min-[1300px]:block">
        <span className="block truncate font-medium">{categoryName}</span>
        <span
          className="mt-0.5 block truncate text-sm"
          style={{ color: 'var(--app-text-muted)' }}
        >
          {title}
        </span>
      </span>

      <span
        className="hidden min-w-0 flex-col gap-1 text-sm font-medium leading-none min-[1300px]:flex"
        style={{ color: 'var(--app-text-muted)' }}
      >
        {hasAccountMeta && (
          <>
            <span className="inline-flex min-w-0 max-w-full items-center gap-2">
              <AccountLogo accountName={accountName} institution={accountInstitution} />
              {accountName && <span className="min-w-0 truncate">{accountName}</span>}
            </span>
            {readOnlyReason && <ReadOnlyReasonPill reason={readOnlyReason} />}
          </>
        )}
      </span>

      <span
        className="hidden min-w-0 truncate px-5 text-sm leading-none min-[1300px]:block"
        style={{ color: 'var(--app-text-muted)' }}
      >
        {transaction.notes}
      </span>

      <span className="hidden min-w-0 justify-end gap-1.5 min-[1300px]:flex">
        {visibleTags.map((tag) => (
          <span
            key={tag.id}
            className="group relative inline-flex max-w-[8rem] shrink-0"
          >
            <span
              className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium"
              style={{
                background: 'var(--app-surface-soft)',
                color: 'var(--app-text-muted)',
                border: '1px solid var(--app-border)',
              }}
            >
              <TagIcon size={11} aria-hidden className="shrink-0" />
              <span className="truncate">{tag.name}</span>
            </span>
            <TagTooltip tags={tags} />
          </span>
        ))}
        {extraTagCount > 0 && (
          <span className="group relative inline-flex shrink-0">
            <span
              className="inline-flex rounded-full px-2 py-0.5 text-sm font-medium"
              style={{
                background: 'var(--app-surface-soft)',
                color: 'var(--app-text-muted)',
                border: '1px solid var(--app-border)',
              }}
            >
              +{extraTagCount}
            </span>
            <TagTooltip tags={tags} />
          </span>
        )}
      </span>

      <span
        className="hidden min-w-0 text-right font-financial text-base font-semibold tabular-nums min-[1300px]:block"
        style={{ color: transactionAmountColor }}
      >
        {formattedAmount}
      </span>

      <span className="grid grid-cols-[2rem_minmax(0,1fr)_max-content] items-start gap-x-2.5 gap-y-1 min-[750px]:hidden">
        <span className="row-span-3 pt-0.5 text-[1.35rem] leading-none" aria-hidden>
          {categoryIcon}
        </span>

        <span className="col-start-2 row-start-1 min-w-0 truncate text-[0.9375rem] font-medium leading-5">
          {title}
        </span>

        <span
          className="col-start-3 row-start-1 ml-2 justify-self-end font-financial text-[0.9375rem] font-semibold leading-5 tabular-nums"
          style={{ color: transactionAmountColor }}
        >
          {formattedAmount}
        </span>

        <span
          className="col-start-2 col-span-2 row-start-2 min-w-0 truncate text-sm leading-5"
          style={{ color: 'var(--app-text-muted)' }}
        >
          {categoryName}
        </span>

        {(hasAccountMeta || hasSupplementalMeta) && (
          <span
            className="col-start-2 col-span-2 row-start-3 flex min-w-0 items-start gap-2 text-sm leading-5"
            style={{ color: 'var(--app-text-muted)' }}
          >
            {hasAccountMeta ? (
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <AccountLogo accountName={accountName} institution={accountInstitution} />
                  {accountName && <span className="min-w-0 truncate">{accountName}</span>}
                </span>
                {readOnlyReason && <ReadOnlyReasonPill reason={readOnlyReason} />}
              </span>
            ) : (
              <span className="min-w-0 flex-1" aria-hidden />
            )}

            {hasSupplementalMeta && (
              <span className="inline-flex shrink-0 items-center gap-2 pt-0.5">
                {hasNotes && (
                  <span className="inline-flex" aria-label="Has note">
                    <StickyNote size={14} strokeWidth={2} aria-hidden />
                  </span>
                )}
                {hasVisibleTags && (
                  <span
                    className="inline-flex items-center gap-1"
                    aria-label={`${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}
                  >
                    <TagIcon size={14} strokeWidth={2} aria-hidden />
                    {tags.length > 1 && (
                      <span className="text-xs font-medium">{tags.length}</span>
                    )}
                  </span>
                )}
              </span>
            )}
          </span>
        )}
      </span>

      <span className="hidden grid-cols-[2.5rem_minmax(0,1fr)_max-content] items-start gap-x-3 gap-y-1.5 min-[750px]:grid min-[1300px]:hidden">
        <span className="row-span-3 text-2xl leading-none" aria-hidden>
          {categoryIcon}
        </span>

        <span className="col-start-2 row-start-1 min-w-0 truncate font-medium">
          {title}
        </span>

        <span
          className="col-start-3 row-start-1 justify-self-end font-financial text-base font-semibold tabular-nums"
          style={{ color: transactionAmountColor }}
        >
          {formattedAmount}
        </span>

        <span
          className="col-start-2 col-span-2 row-start-2 flex min-w-0 items-center gap-2 text-sm leading-none"
          style={{ color: 'var(--app-text-muted)' }}
        >
          <span className="min-w-0 truncate">{categoryName}</span>
          {hasAccountMeta && (
            <>
              <span aria-hidden>·</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <AccountLogo accountName={accountName} institution={accountInstitution} />
                  {accountName && <span className="min-w-0 truncate">{accountName}</span>}
                </span>
                {readOnlyReason && <ReadOnlyReasonPill reason={readOnlyReason} />}
              </span>
            </>
          )}
        </span>

        {hasSupplementalMeta && (
          <span
            className="col-start-2 col-span-2 row-start-3 flex min-w-0 items-center gap-2 text-sm leading-none"
            style={{ color: 'var(--app-text-muted)' }}
          >
            {hasNotes && (
              <>
                <span className="min-w-0 truncate whitespace-nowrap">
                  {transaction.notes}
                </span>
              </>
            )}
            {hasVisibleTags && (
              <span
                className="ml-auto inline-flex shrink-0 items-center gap-1"
                aria-label={`${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}
              >
                <TagIcon size={14} strokeWidth={2} aria-hidden />
                {tags.length > 1 && (
                  <span className="text-xs font-medium">{tags.length}</span>
                )}
              </span>
            )}
          </span>
        )}
      </span>
    </motion.button>
  )
}
