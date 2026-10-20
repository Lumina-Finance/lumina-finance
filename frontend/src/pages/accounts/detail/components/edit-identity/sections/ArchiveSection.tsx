import { AnimatePresence, motion } from 'motion/react'
import { EyeOff } from 'lucide-react'
import { Switch } from '@/components/forms/Switch'
import { useRevealWhenGrown } from '@/pages/accounts/detail/hooks/useRevealWhenGrown'
import {
  ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON,
  EDIT_ACCOUNT_IDENTITY_FIELD_IDS,
  EASE,
} from '@/pages/accounts/detail/constants/accountDetail'
import { ArchiveBalanceWarning } from '@/pages/accounts/detail/components/edit-identity/controls/ArchiveBalanceWarning'
import { EditModalSection } from '@/pages/accounts/detail/components/edit-identity/layout/Section'

type AccountArchiveSectionProps = {
  sectionNumber: string
  isArchived: boolean
  isArchiving: boolean
  /** Locks the switch off while later-dated transactions would leave the archived balance off zero */
  isArchiveBlocked: boolean
  currentBalance: number
  currency: string
  onToggle: (checked: boolean) => void
}

/**
 * Renders archive controls, warns when archiving will create a balance adjustment and explains
 * why archiving is unavailable while later-dated transactions remain
 */
export function AccountArchiveSection({
  sectionNumber,
  isArchived,
  isArchiving,
  isArchiveBlocked,
  currentBalance,
  currency,
  onToggle,
}: AccountArchiveSectionProps) {
  const { ref: warningRef, reveal: revealWarning } = useRevealWhenGrown<HTMLDivElement>(isArchiving)

  return (
    <EditModalSection number={sectionNumber} title="Archive">
      <label
        htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archive}
        className={`flex items-center justify-between gap-4 rounded-xl p-4 ${isArchiveBlocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        style={{
          background: 'var(--app-input-bg)',
          border: '1px solid var(--app-input-border)',
        }}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 font-medium">
            <EyeOff size={16} style={{ color: 'var(--app-text-muted)' }} aria-hidden />
            Archive account
          </span>
          <span className="mt-0.5 block text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Move this account out of active lists while keeping its history.
          </span>
        </span>
        <Switch
          id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archive}
          checked={isArchived}
          disabled={isArchiveBlocked}
          describedBy={isArchiveBlocked ? EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archiveBlockedReason : undefined}
          onChange={onToggle}
        />
      </label>

      {isArchiveBlocked && (
        <p
          id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archiveBlockedReason}
          className="mt-2 text-sm font-medium"
          style={{ color: 'var(--app-negative)' }}
        >
          {ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON}
        </p>
      )}

      <AnimatePresence initial={false}>
        {isArchiving && (
          <motion.div
            ref={warningRef}
            // Announced as it appears, since what it says is the consequence of the switch just turned on
            role="alert"
            className="overflow-hidden"
            initial={{ height: 0, marginTop: 0, opacity: 0 }}
            animate={{ height: 'auto', marginTop: 12, opacity: 1 }}
            exit={{ height: 0, marginTop: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            // It grows in at the foot of the dialog's scrolling body, so once it has, the body follows it as far
            // as it needs to for the whole warning to be read above the footer
            onAnimationComplete={revealWarning}
          >
            <ArchiveBalanceWarning balance={currentBalance} currency={currency} />
          </motion.div>
        )}
      </AnimatePresence>
    </EditModalSection>
  )
}
