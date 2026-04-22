import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

// Placeholder shell for the per-account detail view. Live data, identity card,
// balance chart, spending breakdown, and transaction list will land in later
// commits — this exists so the route is navigable end-to-end first.
export default function AccountDetail() {
  const { accountId } = useParams<{ accountId: string }>()

  return (
    <div>
      <header className="app-page-header">
        <Link
          to="/accounts"
          className="inline-flex items-center gap-1.5 text-sm mb-3"
          style={{ color: 'var(--app-text-muted)' }}
        >
          <ArrowLeft size={14} aria-hidden />
          Back to accounts
        </Link>
        <h1 className="app-page-title">Account detail</h1>
        <p className="app-page-description">
          Viewing account <span className="font-financial">{accountId}</span>
        </p>
      </header>

      <div
        className="rounded-2xl p-6"
        style={{
          background: 'var(--app-surface-soft)',
          border: '1px solid var(--app-border)',
        }}
      />

    </div>
  )
}
