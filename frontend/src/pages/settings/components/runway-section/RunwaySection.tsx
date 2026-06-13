import type { ReactNode } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { RunwayThresholds } from '@/utils/runway'
import SectionHeader from '@/pages/settings/components/SectionHeader'
import SettingsCard from '@/pages/settings/components/SettingsCard'
import { ArchivedRunwayAccountTile, RunwayAccountTile } from './RunwayAccountTiles'
import { RunwayThresholdSlider } from './RunwayThresholdSlider'

interface RunwaySectionProps {
  loading: boolean
  accounts: AccountsOverview[]
  archivedAccounts: AccountsOverview[]
  selection: Set<string>
  onToggle: (id: string) => void
  thresholds: RunwayThresholds
  onThresholdChange: (field: keyof RunwayThresholds, value: number) => void
  actions: ReactNode
}

/**
 * Renders runway threshold controls and account selection for settings
 */
export default function RunwaySection({
  loading,
  accounts,
  archivedAccounts,
  selection,
  onToggle,
  thresholds,
  onThresholdChange,
  actions,
}: RunwaySectionProps) {
  return (
    <section id="runway" className="scroll-mt-8">
      <SectionHeader
        title="Runway"
        description={
          <>
            <p>
              Pick which accounts should count toward calculating your runway — how long the total balance in the selected accounts will last if your average monthly net expenses don't change. The average uses up to the last 12 completed months with recorded expenses; the current partial month and months with no net expense data are excluded. Only open asset accounts are eligible; liabilities like credit cards or loans can't be counted.
            </p>
            <p>
              For example, if your selected accounts hold $30,000 and you've averaged $5,000 a month in net expenses, that's a 6-month runway.
            </p>
          </>
        }
      />

      <SettingsCard>
        <div className="space-y-6">
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Status thresholds</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Month cutoffs for the runway status pill.
              </p>
            </div>

            <RunwayThresholdSlider thresholds={thresholds} onThresholdChange={onThresholdChange} />
          </div>

          <div className="space-y-4 border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Accounts</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Choose which accounts count toward your available runway balance.{' '}
                <strong style={{ color: 'var(--app-text)' }}>
                  Only open asset accounts are eligible and shown here.
                </strong>
              </p>
            </div>

            {loading ? null : accounts.length === 0 ? (
              <p className="py-3 text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                No eligible accounts yet. Add an asset account to configure runway.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-2 min-[1500px]:grid-cols-2">
                  {accounts.map((account) => (
                    <RunwayAccountTile
                      key={account.id}
                      account={account}
                      selected={selection.has(account.id)}
                      onToggle={() => onToggle(account.id)}
                    />
                  ))}
                </div>
                <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                  {selection.size} of {accounts.length} selected
                </p>
              </div>
            )}

          </div>

          {!loading && archivedAccounts.length > 0 && (
            <div className="space-y-4 border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Archived selections</h3>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  These accounts were selected before being archived. Archived accounts do not count toward runway and cannot be changed here. Unarchive an account to make it eligible again.
                </p>
              </div>
              <div className="grid gap-2 min-[1500px]:grid-cols-2">
                {archivedAccounts.map((account) => (
                  <ArchivedRunwayAccountTile key={account.id} account={account} />
                ))}
              </div>
            </div>
          )}

          {actions}
        </div>
      </SettingsCard>
    </section>
  )
}
