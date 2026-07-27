import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'

/**
 * Link back to the accounts list, shown above the content on every state of the account detail
 * page so a reader who reached a missing account can still leave
 */
export default function AccountDetailBackLink() {
  return (
    <Link
      to="/accounts"
      className="mb-6 inline-flex items-center gap-1.5 text-sm"
      style={{ color: 'var(--app-text-muted)' }}
    >
      <ArrowLeft size={14} aria-hidden />
      Back to accounts
    </Link>
  )
}

