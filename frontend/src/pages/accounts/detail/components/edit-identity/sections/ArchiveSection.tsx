import { AnimatePresence, motion } from 'motion/react'
import { EyeOff } from 'lucide-react'
import { EASE } from '@/pages/accounts/detail/constants/accountDetail'
import { ArchiveBalanceWarning } from '../controls/ArchiveBalanceWarning'
import { EditModalSection } from '../layout/Section'

type AccountArchiveSectionProps = {
  sectionNumber: string
  isArchived: boolean
  isArchiving: boolean
  currentBalance: number
  currency: string
  onToggle: (checked: boolean) => void
}

/**
 * Renders archive controls and warns when archiving will create a balance adjustment
 */
export function AccountArchiveSection({
  sectionNumber,
  isArchived,
  isArchiving,
  currentBalance,
  currency,
  onToggle,
}: AccountArchiveSectionProps) {
  return (
    <EditModalSection number={sectionNumber} title="Archive">
      <label
        htmlFor="edit-account-archived"
        className="flex cursor-pointer items-center justify-between gap-4 rounded-xl p-4"
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
        <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors">
          <input
            id="edit-account-archived"
            type="checkbox"
            role="switch"
            checked={isArchived}
            onChange={(event) => {
              onToggle(event.target.checked)
            }}
            className="peer sr-only"
          />
          <span
            className="absolute inset-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
            style={{ background: isArchived ? 'var(--app-accent)' : 'var(--app-border-strong)' }}
            aria-hidden
          />
          <span
            className="relative h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
            style={{ transform: isArchived ? 'translateX(1.25rem)' : 'translateX(0)' }}
            aria-hidden
          />
        </span>
      </label>

      <AnimatePresence initial={false}>
        {isArchiving && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, marginTop: 0, opacity: 0 }}
            animate={{ height: 'auto', marginTop: 12, opacity: 1 }}
            exit={{ height: 0, marginTop: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <ArchiveBalanceWarning balance={currentBalance} currency={currency} />
          </motion.div>
        )}
      </AnimatePresence>
    </EditModalSection>
  )
}
