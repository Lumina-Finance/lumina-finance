import TransactionRow from '@/components/transactions/Row'
import { EmptyState, ImportStep } from '../components'
import type { TransactionImportWorkflow } from '../hooks'

type ImportPreviewStepProps = Pick<
  TransactionImportWorkflow,
  'missingRequiredColumnLabels' | 'previewRows' | 'previewGroups'
>

export function ImportPreviewStep({
  missingRequiredColumnLabels,
  previewRows,
  previewGroups,
}: ImportPreviewStepProps) {
  return (
    <ImportStep
      index="07"
      title="Imported Data Preview"
      description="Showing the first 5 compiled transactions."
    >
      {missingRequiredColumnLabels.length > 0 ? (
        <EmptyState
          title="Missing required columns"
          description={missingRequiredColumnLabels.join(', ')}
        />
      ) : previewRows.length === 0 ? (
        <EmptyState
          title="No preview rows"
          description="Mapped rows will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[58rem]">
            {previewGroups.map((group, groupIndex) => (
              <div key={`${group.dateLabel}-${groupIndex}`}>
                <div
                  className="flex items-center justify-between px-3 py-2"
                  style={{
                    background: 'var(--app-input-bg)',
                    borderBottom: '1px solid var(--app-border)',
                  }}
                >
                  <p
                    className="text-sm font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    {group.dateLabel}
                  </p>
                </div>

                <div>
                  {group.rows.map((row) => (
                    <TransactionRow
                      key={row.id}
                      accountInstitution={row.accountInstitution}
                      accountName={row.accountName}
                      category={row.category}
                      currency={row.currency}
                      transaction={row.transaction}
                      onOpen={() => undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </ImportStep>
  )
}
