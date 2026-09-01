import { Info, TriangleAlert } from 'lucide-react'
import type { BulkEditSummary as BulkEditSummaryResult } from '@/pages/transactions/components/bulk-edit/summary'

interface BulkEditSummaryProps {
  summary: BulkEditSummaryResult
}

/**
 * Renders what a bulk edit would do to the selected transactions: a row per detail it sends, a note
 * for anything it passes over, and a warning for anything the server would refuse
 *
 * Warnings sit under a rule below the rows and notes, since they are what holds Apply disabled
 * rather than a description of what the edit does
 */
export default function BulkEditSummary({ summary }: BulkEditSummaryProps) {
  const { rows, notes, warnings } = summary

  if (rows.length === 0 && warnings.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        Nothing changes yet. Set a detail above.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
                  {row.label}
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
                  {row.value}
                </span>
              </div>
              {row.detail && (
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {row.detail}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {notes.map((note) => (
        <div key={note} className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
          <Info size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden />
          <span>{note}</span>
        </div>
      ))}

      {warnings.length > 0 && (
        <div className="space-y-1.5 pt-3" style={{ borderTop: '1px solid var(--app-border)' }}>
          {warnings.map((warning) => (
            <div key={warning} className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--app-warning-text)' }}>
              <TriangleAlert size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
