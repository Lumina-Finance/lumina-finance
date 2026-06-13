import { CreditCard, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import type { CreditMode } from '@/dashboard/utils/getCreditUsageSummary'
import { getCreditFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'

type CreditHeaderProps = {
  creditMode: CreditMode
  hasCredit: boolean
  tierColor: string
  tierSoft: string
  fxStatus: FxStatus | undefined
  onModeToggle: () => void
}

/**
 * Renders the credit widget label, FX tooltip, and used or remaining mode toggle
 */
export function CreditHeader({
  creditMode,
  hasCredit,
  tierColor,
  tierSoft,
  fxStatus,
  onModeToggle,
}: CreditHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="p-2 rounded-xl" style={{ background: tierSoft }}>
        <CreditCard size={16} style={{ color: tierColor }} aria-hidden />
      </div>
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="app-label">
          Credit <AppSlotMachineText text={creditMode === 'used' ? 'Used' : 'Remaining'} />
        </span>
        {fxStatus && (
          <IconTooltip
            label="Credit FX status"
            icon="fx"
            fxTone={getFxStatusTone(fxStatus)}
            placement="top"
          >
            <span className="block">{getCreditFxStatusMessage(fxStatus)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
      </span>
      {hasCredit && (
        <button
          type="button"
          onClick={onModeToggle}
          title={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
          aria-label={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
          className="app-icon-button ml-auto"
        >
          <Repeat size={12} />
        </button>
      )}
    </div>
  )
}
