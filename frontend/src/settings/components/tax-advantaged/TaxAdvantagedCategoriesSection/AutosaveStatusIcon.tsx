import { AlertTriangle, Check, LoaderCircle } from 'lucide-react'
import type { AutosaveNotice } from '@/settings/components/tax-advantaged/taxAdvantagedTypes'
import { autosaveNoticeColor } from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection/taxAdvantagedAutosave'

export default function AutosaveStatusIcon({ status }: { status: AutosaveNotice['status'] }) {
  const Icon = status === 'error' ? AlertTriangle : status === 'saved' ? Check : LoaderCircle

  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      style={{
        background: autosaveNoticeColor(status),
        color: 'var(--app-bg)',
      }}
    >
      <Icon
        size={16}
        strokeWidth={status === 'saving' ? 2.4 : 3}
        className={status === 'saving' ? 'animate-spin' : undefined}
        aria-hidden
      />
    </span>
  )
}
