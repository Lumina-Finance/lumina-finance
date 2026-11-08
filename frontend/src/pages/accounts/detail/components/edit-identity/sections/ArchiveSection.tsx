import { AnimatePresence, motion } from 'motion/react'
import { EyeOff } from 'lucide-react'
import { Unfold } from '@/components/display/Unfold'
import { Switch } from '@/components/forms/Switch'
import { useRevealWhenGrown } from '@/pages/accounts/detail/hooks/useRevealWhenGrown'
import { EDIT_ACCOUNT_IDENTITY_FIELD_IDS, EASE } from '@/pages/accounts/detail/constants/accountDetail'
import { ArchiveBalanceWarning } from '@/pages/accounts/detail/components/edit-identity/controls/ArchiveBalanceWarning'
import { EditModalSection } from '@/pages/accounts/detail/components/edit-identity/layout/Section'

type AccountArchiveSectionProps = {
  sectionNumber: string
  isArchived: boolean
  isArchiving: boolean
  /** Locks the switch off while later-dated transactions would leave the archived balance off zero. Never true for a linked account */
  isArchiveBlocked: boolean

  /** Locks the switch until the account's bank link has been read, since a link holds archiving back */
  isLinkLoading: boolean

  /** Why the account can't be archived while it is linked, printed under the switch like the other reason */
  archiveLinkedReason: string | null

  /** The one reason archiving is unavailable, the link's or the later transactions', or null when it is available */
  archiveReason: string | null
  currentBalance: number
  currency: string
  onToggle: (checked: boolean) => void
}

/**
 * Renders archive controls, warns when archiving will create a balance adjustment and explains
 * why archiving is unavailable while the account is linked or later-dated transactions remain
 */
export function AccountArchiveSection({
  sectionNumber,
  isArchived,
  isArchiving,
  isArchiveBlocked,
  isLinkLoading,
  archiveLinkedReason,
  archiveReason,
  currentBalance,
  currency,
  onToggle,
}: AccountArchiveSectionProps) {
  const { ref: warningRef, reveal: revealWarning } = useRevealWhenGrown<HTMLDivElement>(isArchiving)

  return (
    <EditModalSection number={sectionNumber} title="Archive">
      {/* The switch's input is visually hidden, so a press lands on the row, and the row refuses it as well,
          whether the switch is held for a reason or only until the link has been read. A switch held off by a
          link stays focusable, so its row keeps its ring whole and the text inside fades */}
      <label
        htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archive}
        className={`flex items-center justify-between gap-4 rounded-xl p-4 ${archiveReason || isLinkLoading ? 'cursor-not-allowed' : 'cursor-pointer'} ${isArchiveBlocked ? 'opacity-60' : ''}`}
        style={{
          background: 'var(--app-input-bg)',
          border: '1px solid var(--app-input-border)',
        }}
      >
        <span
          className={`min-w-0 transition-opacity motion-reduce:transition-none ${archiveLinkedReason !== null ? 'opacity-60' : ''}`}
        >
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
          disabled={isArchiveBlocked || isLinkLoading}
          unavailable={archiveLinkedReason !== null}
          describedBy={archiveReason ? EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archiveBlockedReason : undefined}
          onChange={onToggle}
        />
      </label>

      <AnimatePresence initial={false}>
        {archiveReason && (
          <Unfold key="reason" flush>
            <p
              id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archiveBlockedReason}
              className="mt-2 text-sm font-medium"
              style={{ color: 'var(--app-negative)' }}
            >
              {archiveReason}
            </p>
          </Unfold>
        )}
      </AnimatePresence>

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
