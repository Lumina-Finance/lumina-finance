import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import type { BankConnection } from '@/api/bank-sync'
import MarqueeText from '@/components/display/MarqueeText'
import { SyncStatusDot } from '@/components/display/SyncStatusDot'
import { useAuth } from '@/hooks/useAuth'
import {
  CONNECTION_COLUMNS_CLASS,
  CONNECTION_ROW_ANIMATE,
  CONNECTION_ROW_EXIT,
  CONNECTION_ROW_INITIAL,
  CONNECTION_ROW_TRANSITION,
} from '@/pages/settings/components/bank-connections-section/constants'
import {
  countLinkedBankAccounts,
  describeConnectionStatus,
} from '@/pages/settings/components/bank-connections-section/utils'
import { connectionName } from '@/utils/bankSync'
import { DATE_FORMATS, formatDate } from '@/utils/date'

type ConnectionRowProps = {
  connection: BankConnection

  /**
   * Changes only when rows are added, removed or filtered, the only time rows should slide. Closing a
   * modal releases the page's scroll lock in the same update. That would otherwise read as a move
   */
  layoutKey: string
  isLast: boolean
  prefersReducedMotion: boolean | null
  onOpen: () => void
}

/**
 * One connection in the settings list: its name, how many of its bank accounts are linked, when it was
 * added and whether it still works, as the same dot and label every bank sync status uses. Every row
 * has the same shape whether or not it has a nickname, so the provider and server are left to the
 * connection's modal. Each detail has its own column from 750px. Below that the row follows a
 * merchant's phone row: flush with the search field, the status beside the name and the details in
 * one quiet line under it. The whole row opens the connection's modal
 */
export function ConnectionRow({ connection, layoutKey, isLast, prefersReducedMotion, onOpen }: ConnectionRowProps) {
  const { user } = useAuth()
  const status = describeConnectionStatus(connection)
  const { linked: linkedCount, total } = countLinkedBankAccounts(connection)
  const name = connectionName(connection)

  // The day it was added in the user's zone. Slicing the timestamp instead would give the UTC day, a
  // day out every evening west of UTC
  const added = formatDate(new Date(connection.created_at), DATE_FORMATS.monthDayYear, user?.tz)
  const statusLabel = (
    <span className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: 'var(--app-text)' }}>
      <SyncStatusDot tone={status.tone} />
      <span className="truncate">{status.label}</span>
    </span>
  )

  return (
    <motion.li
      layout={!prefersReducedMotion}
      layoutDependency={layoutKey}
      initial={prefersReducedMotion ? false : CONNECTION_ROW_INITIAL}
      animate={prefersReducedMotion ? undefined : CONNECTION_ROW_ANIMATE}
      exit={prefersReducedMotion ? { opacity: 0 } : CONNECTION_ROW_EXIT}
      transition={prefersReducedMotion ? { duration: 0.12 } : CONNECTION_ROW_TRANSITION}
      data-connection-id={connection.id}
      className="app-marquee-trigger"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      {/* Off the named type tiers on purpose: text-[0.9375rem] matches the tag, merchant and category lists
          this list is laid out like. Moving every list onto a named tier is a separate standards change */}
      <button
        type="button"
        className="app-focus-inset w-full py-3 text-left text-[0.9375rem] focus-visible:bg-transparent! min-[750px]:py-3.5 min-[750px]:pl-4 min-[750px]:pr-3 min-[750px]:hover:bg-[var(--app-accent-soft)]"
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 min-[750px]:hidden">
          <MarqueeText active className="min-w-0 font-medium">
            {name}
          </MarqueeText>
          <span className="flex min-w-0 items-center gap-1">
            {statusLabel}
            <ChevronRight size={16} aria-hidden className="shrink-0" style={{ color: 'var(--app-text-subtle)' }} />
          </span>
          {/* Spans the row under both, so a long status beside the name never cuts the date short */}
          <span className="col-span-2 mt-0.5 block truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {linkedCount} of {total} linked · Added {added}
          </span>
        </span>
        <span className={`hidden items-center gap-x-4 min-[750px]:grid ${CONNECTION_COLUMNS_CLASS}`}>
          <MarqueeText active className="min-w-0 font-medium">
            {name}
          </MarqueeText>
          <span className="min-w-0 truncate text-sm">
            {linkedCount} of {total} <span style={{ color: 'var(--app-text-muted)' }}>linked</span>
          </span>
          <span className="min-w-0 truncate text-sm">{added}</span>
          {statusLabel}
          <ChevronRight size={16} aria-hidden className="shrink-0" style={{ color: 'var(--app-text-subtle)' }} />
        </span>
      </button>
    </motion.li>
  )
}
