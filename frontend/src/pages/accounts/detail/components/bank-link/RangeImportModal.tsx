import { useId, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { CalendarRange, TriangleAlert } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import {
  REVIEW_PAUSE_COUNT,
  useImportBankRange,
  useImportRange,
  type BankConnection,
  type BankLink,
  type BankProvidersResponse,
} from '@/api/bank-sync'
import {
  RANGE_IMPORT_FIELD_IDS,
  RANGE_IMPORT_FIELDS,
  RESTORE_DISMISSED_WARNING,
} from '@/components/bank-link-flow/constants'
import { useBankDateRange } from '@/components/bank-link-flow/dateRange'
import { BankDateRangeFields } from '@/components/bank-link-flow/DateRangeFields'
import { Unfold } from '@/components/display/Unfold'
import LoadFailure from '@/components/errors/LoadFailure'
import { Checkbox } from '@/components/forms/Checkbox'
import { InfoCallout } from '@/components/InfoCallout'
import LoadingRegion from '@/components/loading/Region'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { useToast } from '@/hooks/useToast'
import { describeRangeImportBlock } from '@/pages/accounts/detail/components/bank-link/syncNow'
import { getSaveFailureMessage } from '@/utils/createFailure'
import { formatDateRangeLabel } from '@/utils/date'

const RESTORE_LABEL = 'Bring back dismissed items'

type RangeImportModalProps = {
  open: boolean
  account: AccountsOverview
  link: BankLink

  /** The link's connection, the owner of the request budget each window spends, undefined until read */
  connection: BankConnection | undefined

  /** Whether the bank sync worker is running, undefined until read */
  providers: BankProvidersResponse | undefined
  onClose: () => void
  onExitComplete: () => void
}

/**
 * The choice to bring back items dismissed before, off until ticked, with the warning it needs shown
 * as soon as it is. The warning sits in a live region kept on the page, so a screen reader says it as
 * it appears
 */
export function RestoreDismissedOption({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <Checkbox checked={checked} disabled={disabled} label={RESTORE_LABEL} onChange={onToggle} />
        {/* The checkbox is the keyboard and assistive target, so its text only has to take a click */}
        <div className="min-w-0 cursor-pointer" onClick={onToggle}>
          <p className="text-sm font-medium leading-5" style={{ color: 'var(--app-text)' }}>
            {RESTORE_LABEL}
          </p>
          <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
            Dismissed items in these dates wait for review again
          </p>
        </div>
      </div>
      <div role="status">
        <AnimatePresence initial={false}>
          {checked && (
            <Unfold key="restore-warning">
              <InfoCallout tone="review" icon={TriangleAlert}>
                {RESTORE_DISMISSED_WARNING}
              </InfoCallout>
            </Unfold>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/**
 * Imports a date range into a linked account, from any day the provider reaches through today. What it
 * brings in waits for review, and what is already in the ledger or waiting isn't brought in again.
 * Items dismissed before come back only when the user ticks the option, and ticking it says at once how that can
 * move the balance. The import button says why it is held back while anything holds the range back, as
 * the server would refuse it. It opens over the account's edit dialogue, so it takes the stacked level
 */
export function RangeImportModal({
  open,
  account,
  link,
  connection,
  providers,
  onClose,
  onExitComplete,
}: RangeImportModalProps) {
  const { showToast } = useToast()
  const importRange = useImportBankRange()
  const { data: range, error: rangeError } = useImportRange(account.id, link.provider, open)
  const dateRange = useBankDateRange(range)
  const [restoresDismissed, setRestoresDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blockReasonId = useId()
  const busy = importRange.isPending

  const refusal = useRefusedSubmit(
    { rangeFrom: dateRange.fromProblem, rangeTo: dateRange.toProblem },
    RANGE_IMPORT_FIELDS,
    RANGE_IMPORT_FIELD_IDS,
  )
  const blockReason = describeRangeImportBlock(link, connection, providers)
  const heldBackReason = !range ? 'Still loading' : blockReason
  const toggleRestore = () => {
    if (!busy) setRestoresDismissed((ticked) => !ticked)
  }

  const confirm = () => {
    if (heldBackReason || !refusal.guard()) return
    setError(null)
    importRange.mutate(
      {
        accountId: account.id,
        first_day: dateRange.from,
        last_day: dateRange.to,
        restores_dismissed: restoresDismissed,
      },
      {
        onSuccess: () => {
          showToast({
            status: 'success',
            text: `Importing ${formatDateRangeLabel(dateRange.from, dateRange.to)} into ${account.name}.`,
          })
          onClose()
        },
        onError: (cause) => setError(getSaveFailureMessage(cause)),
      },
    )
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      titleId="bank-range-import-title"
      title="Import a date range"
      eyebrow={`${link.external_account_name} at ${link.institution_name}`}
      RailIcon={CalendarRange}
      railLabel="Bank"
      level="stacked"
      closeDisabled={busy}
      footer={
        <ModalFormFooter
          submitLabel="Import"
          submitDisabled={busy}
          submitReason={heldBackReason}
          submitBlockedReason={refusal.blockedReason}
          submitReasonShownById={blockReason ? blockReasonId : undefined}
          submitWidthClassName="w-full sm:w-auto"
          error={error}
          level="stacked"
          onCancel={onClose}
          onPrimary={confirm}
        />
      }
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Everything in these dates waits for your review, without duplicates. Syncing pauses at {REVIEW_PAUSE_COUNT}{' '}
          waiting items.
        </p>
        {!range && rangeError ? (
          <LoadFailure error={rangeError} subject="Import range" />
        ) : (
          <LoadingRegion loading={!range} label="Loading the import range" animateLoadingHeight readsLayoutHeight>
            {range ? (
              <div className="space-y-4">
                <BankDateRangeFields
                  dateRange={dateRange}
                  ids={{ from: RANGE_IMPORT_FIELD_IDS.rangeFrom, to: RANGE_IMPORT_FIELD_IDS.rangeTo }}
                  errors={{ from: refusal.errors.rangeFrom, to: refusal.errors.rangeTo }}
                  onBlur={(end) => refusal.touch(end === 'from' ? 'rangeFrom' : 'rangeTo')}
                  disabled={busy}
                />
                <RestoreDismissedOption checked={restoresDismissed} disabled={busy} onToggle={toggleRestore} />
              </div>
            ) : (
              <div className="min-h-32" />
            )}
          </LoadingRegion>
        )}
        {blockReason && (
          <p id={blockReasonId} className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {blockReason}
          </p>
        )}
      </div>
    </ModalTitledPanel>
  )
}
