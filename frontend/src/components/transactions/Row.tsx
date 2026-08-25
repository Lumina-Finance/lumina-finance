import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { StickyNote, Tag as TagIcon } from 'lucide-react'
import type { Institution } from '@/api/institutions'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import { Checkbox } from '@/components/forms/Checkbox'
import type { RowSelectionMark } from '@/pages/transactions/components/bulk-edit/selection'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { resolveInstitutionLogoUrl } from '@/utils/institutionLogo'

const MAX_VISIBLE_TAGS = 1
const DEFAULT_CATEGORY_ICON = '🏷️'
const ROW_EXIT_EASE = [0.25, 0.1, 0.25, 1] as const

/**
 * Describes the counterparty of a transfer for the line that shows a merchant on other kinds
 *
 * Returns null when nothing was recorded, which is every transfer predating the field, so the row
 * falls back to the merchant rather than claiming an answer it does not have
 */
function describeTransferCounterparty(
  transaction: Transaction,
  counterpartyAccountName: string | undefined,
): string | null {
  const counterparty = transaction.counterparty_account_scope === 'outside'
    ? 'outside this app'
    : transaction.counterparty_account_scope === 'tracked' ? counterpartyAccountName : undefined
  if (!counterparty) return null

  // Which way the money went reads the same whether the counterparty is an account or not, so money
  // leaving the tracked accounts gets the same wording rather than standing on its own
  return transaction.amount < 0 ? `To ${counterparty}` : `From ${counterparty}`
}

/**
 * What the row needs while the list is in selection mode
 *
 * Absent everywhere else, including the import preview, which renders the same row and offers no
 * selection at all
 */
export interface TransactionRowSelection {
  /** How the row is marked once any pending shift-click is taken into account */
  mark: RowSelectionMark

  /** False for a row the app does not allow editing, such as one on an archived account */
  isSelectable: boolean

  onToggle: (withShift: boolean) => void
  onPointerEnter: () => void
}

interface TransactionRowProps {
  accountName?: string

  // The account a transfer recorded as its counterparty, looked up by the caller. Absent on every
  // other kind, and on a transfer whose recorded account is not in the caller's list
  counterpartyAccountName?: string
  accountInstitution?: Institution | null
  category: Category | undefined
  currency: string
  readOnlyReason?: string
  transaction: Transaction
  // Skips the height collapse on removal so a deletion just fades when the viewer prefers reduced motion
  prefersReducedMotion?: boolean | null
  // Makes the row appear without the grow in, used for a lazy loaded batch that would otherwise all grow at once
  skipEnterAnimation?: boolean
  selection?: TransactionRowSelection
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

/**
 * Renders one transaction as a clickable row, showing its category, account, notes, tags, and signed
 * amount, and calling `onOpen` when clicked
 *
 * Renders three layouts gated by breakpoint, from a full grid of columns on wide screens down to a
 * stacked two-line layout on narrow ones, and animates its height on mount and removal unless
 * `prefersReducedMotion` is set. A `readOnlyReason` dims the row and shows why it cannot be edited
 */
export default function TransactionRow({
  accountName,
  counterpartyAccountName,
  accountInstitution,
  category,
  currency,
  readOnlyReason,
  transaction,
  prefersReducedMotion,
  skipEnterAnimation = false,
  selection,
  onOpen,
}: TransactionRowProps) {
  // The row clips its content only while the height animates, so the grow and collapse read cleanly
  // while the resting row still lets a tag tooltip overflow past its edges
  const [isAnimatingHeight, setIsAnimatingHeight] = useState(false)
  const { formatCurrency } = useMoneyFormatters()
  const categoryName = category?.name ?? 'Uncategorized'
  const categoryIcon = category?.icon ?? DEFAULT_CATEGORY_ICON
  const fallbackTitle = category?.kind === 'transfer' ? 'Transfer' : 'Transaction'

  // A transfer's merchant is almost always the same stand-in, so where the money went takes the line
  // that shows a merchant on other kinds, and the merchant fills in only for a transfer that
  // recorded no counterparty
  const transferCounterparty = category?.kind === 'transfer'
    ? describeTransferCounterparty(transaction, counterpartyAccountName)
    : null
  const title = transferCounterparty ?? transaction.merchant_name ?? fallbackTitle
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

  // A ticked row is marked with a background rather than with opacity, which already says the row
  // cannot be edited
  const selectionBackground = selection?.mark === 'selected'
    ? 'var(--app-accent-soft)'
    : selection?.mark === 'pending' ? 'var(--app-surface-soft)' : undefined

  return (
    <motion.div
      onMouseEnter={selection?.onPointerEnter}
      initial={skipEnterAnimation ? false : prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
      // The row's whole vertical padding, set here rather than in a class, so it can animate from
      // zero and the row grows from a fully collapsed height
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
      // Always a flex row, whether or not a checkbox is in it, so turning selection mode on and off
      // does not switch layout mode underneath the checkbox while it animates
      className="flex w-full items-center transition-colors duration-100 hover:bg-[var(--app-surface-soft)] min-[1300px]:col-span-full min-[1300px]:grid min-[1300px]:grid-cols-subgrid min-[1300px]:items-center min-[1300px]:gap-x-3"
      style={{
        borderBottom: '1px solid var(--app-border)',
        overflow: isAnimatingHeight ? 'hidden' : 'visible',
        background: selectionBackground,
      }}
    >
      {/* initial={false} so a row scrolling into view while selection mode is already on shows its
          checkbox rather than growing one. AnimatePresence keeps the last rendered checkbox mounted
          through its exit, which is why it can still read the selection that has just gone */}
      <AnimatePresence initial={false}>
        {selection && (
          <motion.span
            key="row-checkbox"
            className="flex shrink-0 items-center justify-center overflow-hidden"
            initial={prefersReducedMotion ? { opacity: 0 } : { width: 0, opacity: 0, paddingLeft: 0 }}
            animate={{ width: 'auto', opacity: 1, paddingLeft: '0.75rem' }}
            exit={prefersReducedMotion ? { opacity: 0 } : { width: 0, opacity: 0, paddingLeft: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: ROW_EXIT_EASE }}
          >
            <Checkbox
              checked={selection.mark === 'selected'}
              disabled={!selection.isSelectable}
              label={`Select ${title} on ${transaction.dt}`}
              onChange={(event) => selection.onToggle(event.shiftKey)}
            />
          </motion.span>
        )}
      </AnimatePresence>

      {/* The row's own click target. It is a button nested inside the row rather than the row
          itself, because a checkbox is a button too and one cannot contain the other. On a wide
          screen it declares a subgrid of its own so the cells inside it still line up against the
          tracks the list declares */}
      <button
        type="button"
        // In selection mode the checkbox is the row's single stop, so the same row does not offer
        // two controls doing the same thing
        tabIndex={selection ? -1 : undefined}
        onClick={(event) => {
          if (!selection) {
            onOpen(transaction)
            return
          }

          // A shift-click lands on a row the app will not edit as readily as on any other, and the
          // range it takes steps over that row, so it runs anyway rather than doing nothing under a
          // pointer the highlight has already answered
          if (selection.isSelectable || event.shiftKey) selection.onToggle(event.shiftKey)
        }}
        className="block w-full min-w-0 flex-1 cursor-pointer px-3 text-left focus-visible:bg-[var(--app-surface-soft)] focus-visible:outline-none min-[1300px]:col-span-6 min-[1300px]:grid min-[1300px]:grid-cols-subgrid min-[1300px]:items-center min-[1300px]:gap-x-3"
      >
      {/* Desktop row: each cell is a direct child of this button's subgrid, which spans the list's
          content tracks, so every row shares the same column tracks and stays aligned. The category
          and account tracks grow to their widest content across all rows, showing long names while
          there is room and truncating only when there is not, with notes as the flexible filler
          that compresses first */}
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
      </button>
    </motion.div>
  )
}
