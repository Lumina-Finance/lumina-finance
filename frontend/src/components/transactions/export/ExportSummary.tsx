import type { ExportDescription } from '@/components/transactions/export/describeExport'

/**
 * Says what the file will hold: a sentence, then each condition with its choices by name
 *
 * Each choice is its own chip, so a long list wraps one name at a time and a name holding a comma
 * stays one choice
 */
export function ExportSummary({ description }: { description: ExportDescription }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6" style={{ color: 'var(--app-text)' }}>
        {description.summary}
      </p>
      {description.groups.length > 0 && (
        <dl className="space-y-3">
          {description.groups.map((group) => (
            <div key={group.label}>
              <dt className="mb-1.5 text-xs font-semibold" style={{ color: 'var(--app-text-muted)' }}>
                {group.label}
              </dt>
              <dd className="flex flex-wrap gap-1.5">
                {group.values.map((value) => (
                  <span
                    key={value}
                    className="max-w-full break-words rounded-full px-2.5 py-1 text-xs"
                    style={{
                      background: 'color-mix(in srgb, var(--app-accent) 14%, transparent)',
                      color: 'var(--app-accent-on-page-tint)',
                    }}
                  >
                    {value}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
