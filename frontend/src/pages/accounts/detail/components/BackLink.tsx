import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

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

