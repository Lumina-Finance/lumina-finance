import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Pencil } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useAccount, type Account } from '@/api/accounts'
import { formatCurrency } from '@/utils/formatCurrency'

const TAX_TREATMENT_LABEL: Record<string, string> = {
  taxable: 'Taxable',
  tax_free: 'Tax-free',
  tax_deferred: 'Tax-deferred',
  tax_assisted: 'Tax-assisted',
}

const ACCOUNT_KIND_LABEL: Record<string, string> = {
  asset: 'Asset',
  revolving: 'Revolving credit',
  amortizing: 'Amortizing debt',
}

function humanizeAccountType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Larger version of the accounts-list logo — 64px square so the detail card
// reads as "this one account" rather than a row in a list.
function DetailInstitutionLogo({ institution }: { institution: Account['institution'] }) {
  const faviconUrl = institution?.website
    ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(institution.website)}&size=256`
    : null
  return (
    <div
      className="w-16 h-16 shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
      style={{
        background: 'var(--app-accent-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      {faviconUrl ? (
        <img
          src={faviconUrl}
          alt={`${institution!.name} logo`}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      ) : (
        <span className="text-2xl font-semibold select-none" style={{ color: 'var(--app-accent)' }}>$</span>
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/accounts"
      className="inline-flex items-center gap-1.5 text-sm mb-6"
      style={{ color: 'var(--app-text-muted)' }}
    >
      <ArrowLeft size={14} aria-hidden />
      Back to accounts
    </Link>
  )
}

export default function AccountDetail() {
  const { accountId } = useParams<{ accountId: string }>()
  const { data: account, isLoading, error } = useAccount(accountId)

  // Tax-advantaged details are hidden by default so the card height stays
  // consistent. Clicking the Tax treatment row opens a floating popover
  // anchored at that row's top — extends downward without reflowing the grid.
  const [taxOpen, setTaxOpen] = useState(false)
  const taxRowRef = useRef<HTMLDivElement>(null)
  const taxPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!taxOpen) return
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (taxPanelRef.current?.contains(target)) return
      if (taxRowRef.current?.contains(target)) return
      setTaxOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTaxOpen(false)
    }
    // defer registration so the click that opened doesn't immediately close it
    const t = setTimeout(() => window.addEventListener('pointerdown', onPointer), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [taxOpen])

  if (isLoading) {
    return (
      <div>
        <BackLink />
        <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-5">
          <div className="h-96 rounded-2xl bg-[var(--app-surface-soft)]" />
          <div className="h-96 rounded-2xl bg-[var(--app-surface-soft)]" />
        </div>
      </div>
    )
  }

  if (error || !account) {
    return (
      <div>
        <BackLink />
        <h1 className="app-page-title">Account not found</h1>
        <p className="app-page-description">We couldn't load this account. It may have been deleted.</p>
      </div>
    )
  }

  const money = (value: number | null) =>
    value === null ? '—' : formatCurrency(value, account.currency)

  // Always-visible rows. Tax treatment is handled separately below because it
  // doubles as the toggle for the tax-advantaged popover.
  const coreRows: { label: string; value: string }[] = [
    { label: 'Kind', value: ACCOUNT_KIND_LABEL[account.account_kind] ?? account.account_kind },
    { label: 'Type', value: humanizeAccountType(account.account_type) },
    { label: 'Currency', value: account.currency },
    { label: 'Credit limit', value: money(account.credit_limit) },
  ]
  const taxTreatmentLabel = TAX_TREATMENT_LABEL[account.tax_treatment] ?? account.tax_treatment

  const taxRows: { label: string; value: string }[] = [
    { label: 'Contribution limit', value: money(account.current_year_contribution_limit) },
    { label: 'Lifetime limit', value: money(account.lifetime_contribution_limit) },
    { label: 'Withdrawal limit', value: money(account.current_year_withdrawal_limit) },
    { label: 'YTD contributions', value: money(account.ytd_contributions) },
    { label: 'YTD withdrawals', value: money(account.ytd_withdrawals) },
    { label: 'Lifetime contributions', value: money(account.lifetime_contributions) },
    { label: 'Lifetime withdrawals', value: money(account.lifetime_withdrawals) },
  ]

  return (
    <div>
      <BackLink />

      {/* Two-column layout: identity card (fixed) + chart area (flex).
          The chart side is a placeholder for step 4. */}
      <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-5">
        <section
          className="relative rounded-2xl p-6 flex flex-col"
          style={{
            background: 'var(--app-surface-soft)',
            border: '1px solid var(--app-border)',
          }}
        >
          {!account.closed_at && (
            <button
              type="button"
              aria-label="Edit account"
              className="absolute top-3 right-3 grid place-items-center rounded-md transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
              style={{ width: 28, height: 28, color: 'var(--app-text-muted)' }}
            >
              <Pencil size={14} aria-hidden />
            </button>
          )}

          <DetailInstitutionLogo institution={account.institution} />

          <h1 className="mt-4 font-serif font-semibold leading-tight text-2xl">{account.name}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {account.institution?.name ?? 'No institution'}
            {account.closed_at && ` · Closed ${new Date(account.closed_at).toLocaleDateString()}`}
          </p>

          <dl className="mt-5 flex-1">
            {coreRows.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between py-2 border-b"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <dt className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {row.label}
                </dt>
                <dd className="text-sm font-medium">{row.value}</dd>
              </div>
            ))}

            {/* Tax treatment — clickable, doubles as disclosure trigger. */}
            <div ref={taxRowRef} className="relative">
              <button
                type="button"
                onClick={() => setTaxOpen((o) => !o)}
                aria-expanded={taxOpen}
                className="w-full flex items-baseline justify-between py-2 border-b transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Tax treatment
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{taxTreatmentLabel}</span>
                  <ChevronDown
                    size={14}
                    aria-hidden
                    style={{
                      color: 'var(--app-text-muted)',
                      transform: taxOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 150ms ease',
                    }}
                  />
                </span>
              </button>

              {/* Popover anchored at this row's top, extending downward. Left/
                  right pulled to cancel the card's p-6 padding so the panel
                  spans the full card width. Floats over page content below. */}
              <AnimatePresence>
                {taxOpen && (
                  <motion.div
                    ref={taxPanelRef}
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
                    className="absolute z-30 rounded-2xl px-6 py-4"
                    style={{
                      top: 0,
                      left: -24,
                      right: -24,
                      background: 'var(--app-bg)',
                      border: '1px solid var(--app-border-strong)',
                      boxShadow: 'var(--app-shadow-soft)',
                    }}
                  >
                    {/* Header repeats "Tax treatment" so the popover stays
                        grounded where it opens from. */}
                    <div
                      className="flex items-baseline justify-between pb-2 border-b"
                      style={{ borderColor: 'var(--app-border)' }}
                    >
                      <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                        Tax treatment
                      </span>
                      <span className="text-sm font-medium">{taxTreatmentLabel}</span>
                    </div>

                    {taxRows.map((row, idx) => (
                      <div
                        key={row.label}
                        className={`flex items-baseline justify-between py-1.5 ${idx < taxRows.length - 1 ? 'border-b' : ''}`}
                        style={{ borderColor: 'var(--app-border)' }}
                      >
                        <span className="text-[0.8125rem]" style={{ color: 'var(--app-text-muted)' }}>
                          {row.label}
                        </span>
                        <span className="text-[0.8125rem] font-medium">{row.value}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </dl>
        </section>

        {/* Chart placeholder — step 4. Stretches to match the identity card
            height via the grid's align-stretch default. */}
        <div
          className="rounded-2xl"
          style={{
            background: 'var(--app-surface-soft)',
            border: '1px solid var(--app-border)',
          }}
        />
      </div>
    </div>
  )
}
