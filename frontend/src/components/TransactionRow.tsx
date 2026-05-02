import { Tag as TagIcon } from 'lucide-react'
import type { Institution } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import { formatCurrency } from '@/utils/formatCurrency'

const MAX_VISIBLE_TAGS = 1
const DEFAULT_CATEGORY_ICON = '🏷️'

interface TransactionRowProps {
  accountName?: string
  accountInstitution?: Institution | null
  category: Category | undefined
  currency: string
  transaction: Transaction
  onOpen: (transaction: Transaction) => void
}

function amountColor(category: Category | undefined) {
  if (category?.kind === 'income') return 'var(--app-positive)'
  if (category?.kind === 'transfer') return 'var(--app-text-muted)'
  return 'var(--app-negative)'
}

function accountLogoSrc(institution: Institution | null | undefined) {
  if (institution?.logo_url) return institution.logo_url
  if (!institution?.website) return null
  return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(institution.website)}&size=256`
}

function AccountLogo({
  accountName,
  institution,
}: {
  accountName: string | undefined
  institution: Institution | null | undefined
}) {
  const logoSrc = accountLogoSrc(institution)
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

function TagTooltip({ tags }: { tags: Transaction['tags'] }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 flex w-52 -translate-x-1/2 flex-col items-start gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      <span
        className="absolute -inset-3 rounded-xl"
        style={{
          background: 'color-mix(in srgb, var(--app-bg) 42%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          maskImage: 'radial-gradient(circle at center, black 0%, black 28%, transparent 82%)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 0%, black 28%, transparent 82%)',
        }}
        aria-hidden
      />
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="relative inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium"
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
  transaction,
  onOpen,
}: TransactionRowProps) {
  const categoryName = category?.name ?? 'Uncategorized'
  const categoryIcon = category?.icon ?? DEFAULT_CATEGORY_ICON
  const fallbackTitle = category?.kind === 'transfer' ? 'Transfer' : 'Transaction'
  const title = transaction.merchant_name ?? fallbackTitle
  const tags = [...(transaction.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS)
  const extraTagCount = Math.max(tags.length - visibleTags.length, 0)
  const hasAccountMeta = !!accountName || !!accountInstitution

  return (
    <button
      type="button"
      onClick={() => onOpen(transaction)}
      className="grid w-full cursor-pointer grid-cols-[2.5rem_minmax(0,0.7fr)_minmax(13rem,17rem)_minmax(13rem,1.3fr)_minmax(7rem,10rem)_8rem] items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100 hover:bg-[var(--app-surface-soft)] focus-visible:bg-[var(--app-surface-soft)] focus-visible:outline-none"
      style={{ borderBottom: '1px solid var(--app-border)' }}
    >
      <span className="text-2xl leading-none" aria-hidden>
        {categoryIcon}
      </span>

      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span
          className="mt-0.5 block truncate text-sm"
          style={{ color: 'var(--app-text-muted)' }}
        >
          {categoryName}
        </span>
      </span>

      <span className="min-w-0">
        {hasAccountMeta ? (
          <span
            className="inline-flex max-w-full items-center gap-2 text-sm font-medium"
            style={{ color: 'var(--app-text-muted)' }}
          >
            <AccountLogo accountName={accountName} institution={accountInstitution} />
            {accountName && <span className="truncate">{accountName}</span>}
          </span>
        ) : (
          <span aria-hidden>&nbsp;</span>
        )}
      </span>

      <span
        className="min-w-0 truncate text-sm"
        style={{ color: 'var(--app-text-muted)' }}
      >
        {transaction.notes || '\u00A0'}
      </span>

      <span className="flex min-w-0 justify-end gap-1.5">
        {visibleTags.length > 0 ? (
          <>
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
              <span
                className="group relative inline-flex shrink-0"
              >
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
          </>
        ) : (
          <span aria-hidden>&nbsp;</span>
        )}
      </span>

      <span
        className="justify-self-end font-financial text-base font-semibold tabular-nums"
        style={{ color: amountColor(category) }}
      >
        {transaction.amount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(transaction.amount), currency)}
      </span>
    </button>
  )
}
