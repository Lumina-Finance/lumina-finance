import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useCategories } from '@/api/categories'
import TransactionModalLinkRefundPicker from '@/components/transactions/transaction-modal/modals/LinkRefundPicker'
import RevealRow from '@/components/transactions/transaction-modal/sections/RevealRow'
import {
  RefundChainBox,
  RefundChainFooter,
  RefundChainGap,
  RefundChainLead,
  RefundChainPlaceholder,
  RefundChainRow,
  RefundCount,
  RefundStatusBadge,
} from '@/components/transactions/transaction-modal/sections/RefundChain'
import {
  useRefundLinkCandidates,
  useTransaction,
  useTransactionsById,
  useTransactionsLoadFailed,
  type Transaction,
} from '@/api/transactions'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { DEFAULT_CATEGORY_ICON } from '@/components/transactions/transaction-modal/constants'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import type { PendingLinks } from '@/components/transactions/transaction-modal/hooks/usePendingLinks'
import {
  getRefundRoom,
  getRefundStatus,
  getRefusedRooms,
  orderRefundsByDate,
} from '@/components/transactions/transaction-modal/utils/refund'

// Shown in place of the button that opens the picker while nothing in it could be picked
const NO_EXPENSE_FITS = 'No expense has room for this refund.'

const NO_MERCHANT = 'No merchant'
const LOAD_FAILED = 'Oops, something went wrong loading the linked transaction. Please reopen this transaction.'

/**
 * Reads a linked transaction, and keeps showing what was loaded while Save has the copy reload, so its row never
 * drops to the shorter placeholder
 */
function useHeldTransaction(transactionId: string | null) {
  const query = useTransaction(transactionId)
  const [lastLoaded, setLastLoaded] = useState(query.data)
  if (query.data && query.data !== lastLoaded) setLastLoaded(query.data)
  return { isError: query.isError, data: query.data ?? lastLoaded }
}

function LoadFailedRow() {
  return (
    <p role="alert" className="text-sm" style={{ color: 'var(--app-negative)' }}>
      {LOAD_FAILED}
    </p>
  )
}

interface SavedRefundRowProps {
  refundId: string

  /** The icon of the expense's category. Its refunds share it */
  icon: string

  /** Offers Unlink, or leaves the row as a plain record for a refund the window can't unlink */
  unlink: { disabled: boolean; onUnlink: () => void } | null

  /** Keeps Unlink's room on a row without it, so its amount lines up with the rows that have one */
  keepsUnlinkRoom: boolean

  /** Carries the dashed line on below the icon to the next refund, on every refund but the last */
  lineBelow: boolean
  testId: string
}

/** A refund whose link is already saved, loaded by its id */
function SavedRefundRow({ refundId, icon, unlink, keepsUnlinkRoom, lineBelow, testId }: SavedRefundRowProps) {
  const refund = useHeldTransaction(refundId)
  if (refund.isError && !refund.data) return <LoadFailedRow />
  if (!refund.data) return <RefundChainPlaceholder />
  const merchantName = refund.data.merchant_name ?? NO_MERCHANT
  return (
    <RefundChainRow
      icon={icon}
      merchantName={merchantName}
      kind="Refund"
      dt={refund.data.dt}
      amount={refund.data.amount}
      currency={refund.data.currency}
      unlink={unlink ? { otherName: merchantName, ...unlink } : undefined}
      keepsUnlinkRoom={keepsUnlinkRoom}
      lineAbove
      lineBelow={lineBelow}
      testId={testId}
    />
  )
}

interface LinkedRefundsSectionProps {
  transaction: Transaction
  readOnly: boolean

  /** True while Save is applying the window's changes, which locks the controls that make more */
  disabled: boolean

  /** Money out that can be refunded, so a refund that already exists can be linked to it */
  canLinkRefund: boolean

  /** Money in that is not yet the refund of anything, so it can be linked to the expense it refunds */
  canLinkExpense: boolean

  /** The link changes made in the window, which Save applies */
  pending: PendingLinks

  /** What is left to refund of an expense once the refunds saved and held are counted */
  refundRoom: number | undefined
}

/**
 * Shows an expense and its refunds as one chain from either side, with how much is refunded and what is left, and a
 * way to remove a link. A refund shows the expense it refunds with every refund of it, and an expense shows its
 * refunds. Where none is linked it offers to link an existing refund or expense. Links made, removed or created here
 * are held, and shown as such, until the window is saved. It draws nothing where there is no link and none can be made
 */
export default function TransactionModalLinkedRefundsSection({
  transaction,
  readOnly,
  disabled,
  canLinkRefund,
  canLinkExpense,
  pending,
  refundRoom,
}: LinkedRefundsSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const { data: categories = [] } = useCategories()
  const { formatCurrency } = useMoneyFormatters()

  // The list row the modal opened from is a snapshot, so the links come from the live copy once it loads
  const live = useTransaction(transaction.id)
  const current = live.data ?? transaction
  const isUnlinked = (id: string) => pending.unlinkedRefundIds.includes(id) || pending.appliedUnlinkIds.includes(id)
  const isRefund = current.amount > 0

  // A link or refund that Save has made keeps the row it had, from what the window already knew of it, until the
  // window closes. The saved copy loads after Save, and swapping to it would take the row away and bring it back
  const appliedOriginal = isRefund && !isUnlinked(current.id) ? pending.appliedLinks[0] : undefined
  const appliedRefundLinks = isRefund ? [] : pending.appliedLinks.filter((link) => !isUnlinked(link.id))
  const appliedIds = [...appliedRefundLinks.map((link) => link.id), ...pending.appliedRefunds.map((r) => r.id)]
  const savedOriginalId = isUnlinked(current.id) || appliedOriginal ? null : current.refund_of_transaction_id

  // Links picked for a refund name its one expense, and links picked for an expense name its refunds
  const pendingOriginal = isRefund ? pending.links[0] : undefined
  const pendingRefundLinks = isRefund ? [] : pending.links
  const savedRefundIds = current.refund_transaction_ids.filter((id) => !isUnlinked(id) && !appliedIds.includes(id))
  const savedRefunds = useTransactionsById(savedRefundIds)
  const appliedRefunds = pending.appliedRefunds.filter((refund) => !isUnlinked(refund.id))

  // A refund that fails to load leaves what is left to refund unknown, so the total gives way to the row's error
  const refundsLoadFailed = useTransactionsLoadFailed(savedRefundIds)

  // The expense a refund is linked to, and the other refunds of it. They all count towards what is left to refund
  const savedOriginal = useHeldTransaction(savedOriginalId)
  const original = savedOriginalId ? savedOriginal.data : (appliedOriginal ?? pendingOriginal)
  const siblingIds = original ? original.refund_transaction_ids.filter((id) => id !== current.id) : []
  const siblings = useTransactionsById(siblingIds)
  const siblingsLoaded = siblings.every((sibling) => sibling !== undefined)
  const siblingsLoadFailed = useTransactionsLoadFailed(siblingIds)
  const chainIds = orderRefundsByDate(
    [...siblingIds.map((id, index) => ({ id, dt: siblings[index]?.dt })), { id: current.id, dt: current.dt }],
    (refund) => refund.dt,
  ).map(({ id }) => id)
  const originalRoom =
    original && siblingsLoaded ? getRefundRoom(original, [...(siblings as Transaction[]), current]) : undefined

  // The button that opens the picker is held off while nothing in the unfiltered list could be picked. The query is
  // the picker's own with nothing searched or filtered, so the two share one request
  const candidates = useRefundLinkCandidates(
    canLinkRefund || canLinkExpense ? current.id : null,
    '',
    pending.unlinkedRefundIds.length > 0 ? { unlinked_id: pending.unlinkedRefundIds } : {},
  )
  const unheld = candidates.data?.filter((candidate) => !pending.links.some((link) => link.id === candidate.id))
  // Until what is left to refund is known, the button shows, so the reason never goes without its amount. An unlink
  // asks for the list again, and until the new list lands the old one shows without the link just freed. That link
  // always fits, so the button shows meanwhile
  const anythingFits =
    unheld === undefined ||
    candidates.isPlaceholderData ||
    (!isRefund && refundRoom === undefined) ||
    unheld.length > getRefusedRooms(current, unheld, refundRoom, []).size
  // The prompt and its reason wait for the list and what is left, so the dialogue never opens on one and swaps to the
  // other. A list or refund that fails to load leaves the button, for the picker to say what went wrong
  const fitKnown =
    candidates.isError || (unheld !== undefined && (isRefund || refundRoom !== undefined || refundsLoadFailed))
  const refundCount =
    savedRefundIds.length +
    appliedRefundLinks.length +
    appliedRefunds.length +
    pendingRefundLinks.length +
    pending.refunds.length
  const showRefunds = refundCount > 0 || canLinkRefund
  const showRefundOf =
    Boolean(savedOriginalId) || appliedOriginal !== undefined || pendingOriginal !== undefined || canLinkExpense
  const refundOfStatus = original && originalRoom !== undefined ? getRefundStatus(original, originalRoom) : null
  const refundsStatus = refundCount > 0 && refundRoom !== undefined ? getRefundStatus(current, refundRoom) : null

  // An expense refunded in full offers no link, and where nothing could be picked the reason shows in the button's
  // place, so the section never offers what the picker would refuse
  const offersRefundLink = canLinkRefund && refundsStatus !== 'full'
  const offersExpenseLink = showRefundOf && !original
  const linkButtonShown = anythingFits && (isRefund ? offersExpenseLink : offersRefundLink)

  // The picker gives focus back to the button that opened it. Where the link it made takes that button away, focus
  // moves on to Unlink on the row the link made, after the picker's own hand back a frame on
  const focusAfterPick = useRef<string | null>(null)
  useEffect(() => {
    const linkId = focusAfterPick.current
    if (pickerOpen || linkId === null) return
    focusAfterPick.current = null
    if (linkButtonShown) return
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-link-id="${CSS.escape(linkId)}"] button[aria-label^="Unlink"]`)
        ?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pickerOpen, linkButtonShown])

  if (!showRefunds && !showRefundOf) return null

  // Every row in a chain takes the icon of the expense's category, so the refunds read as part of it
  const categoryOf = (expense: Transaction) => categories.find((category) => category.id === expense.category_id)
  const iconOf = (expense: Transaction) => categoryOf(expense)?.icon ?? DEFAULT_CATEGORY_ICON
  const expenseRow = (expense: Transaction, notSaved: boolean, testId: string) => {
    const category = categoryOf(expense)
    return (
      <RefundChainRow
        icon={iconOf(expense)}
        merchantName={expense.merchant_name ?? NO_MERCHANT}
        kind={category?.name ?? 'Uncategorized'}
        dt={expense.dt}
        amount={expense.amount}
        currency={expense.currency}
        notSaved={notSaved}
        keepsUnlinkRoom={!readOnly}
        lineBelow
        testId={testId}
      />
    )
  }
  const refundRow = (
    key: string,
    refund: Pick<Transaction, 'merchant_name' | 'dt' | 'amount' | 'currency'>,
    notSaved: boolean,
    onUnlink: () => void,
    last: boolean,
  ) => (
    <RevealRow key={key} testId="linked-row" spacingClassName="">
      <RefundChainGap />
      <RefundChainRow
        icon={iconOf(current)}
        merchantName={refund.merchant_name ?? NO_MERCHANT}
        kind="Refund"
        dt={refund.dt}
        amount={refund.amount}
        currency={refund.currency}
        notSaved={notSaved}
        unlink={readOnly ? undefined : { otherName: refund.merchant_name ?? NO_MERCHANT, disabled, onUnlink }}
        lineAbove
        lineBelow={!last}
        linkId={key}
        testId="linked-transaction"
      />
      <RefundChainGap drawn={!last} />
    </RevealRow>
  )

  // Saved refunds, links Save has just made and links held until Save, in one date order. Each row is drawn once its
  // place is known, since the last one ends the dashed line
  const refundRows = orderRefundsByDate(
    [
      ...savedRefundIds.map((refundId, index) => ({
        dt: savedRefunds[index]?.dt,
        row: (last: boolean) => (
          <RevealRow key={refundId} testId="linked-row" spacingClassName="">
            <RefundChainGap />
            <SavedRefundRow
              refundId={refundId}
              icon={iconOf(current)}
              unlink={readOnly ? null : { disabled, onUnlink: () => pending.unlink(refundId) }}
              keepsUnlinkRoom={false}
              lineBelow={!last}
              testId="linked-transaction"
            />
            <RefundChainGap drawn={!last} />
          </RevealRow>
        ),
      })),
      ...appliedRefundLinks.map((refund) => ({
        dt: refund.dt,
        row: (last: boolean) => refundRow(refund.id, refund, false, () => pending.unlink(refund.id), last),
      })),
      ...appliedRefunds.map((refund) => ({
        dt: refund.preview.dt,
        row: (last: boolean) => refundRow(refund.key, refund.preview, false, () => pending.unlink(refund.id), last),
      })),
      ...pendingRefundLinks.map((refund) => ({
        dt: refund.dt,
        row: (last: boolean) => refundRow(refund.id, refund, true, () => pending.removeLink(refund.id), last),
      })),
      ...pending.refunds.map((refund) => ({
        dt: refund.preview.dt,
        row: (last: boolean) =>
          refundRow(refund.key, refund.preview, true, () => pending.removeRefund(refund.key), last),
      })),
    ],
    (entry) => entry.dt,
  )

  const linkButton = (label: string) => (
    <DisabledReasonButton
      className="app-secondary-button whitespace-nowrap"
      data-testid="link-existing"
      disabled={disabled}
      onClick={() => setPickerOpen(true)}
    >
      {label}
    </DisabledReasonButton>
  )
  const promptText = (text: string) => (
    <p className="text-sm text-pretty" style={{ color: 'var(--app-text-muted)' }} data-testid="link-prompt">
      {text}
    </p>
  )
  const prompt = (text: string, label: string, reason: string) =>
    anythingFits ? (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {promptText(text)}
        {linkButton(label)}
      </div>
    ) : (
      promptText(reason)
    )
  const noRefundFits = `No money that comes in fits the ${formatCurrency(refundRoom ?? 0, current.currency)} left to refund.`

  // Unlinking a refund from its expense takes back a saved or applied link, or drops one only held in the window
  const unlinkOriginal = () =>
    pendingOriginal && original === pendingOriginal
      ? pending.removeLink(pendingOriginal.id)
      : pending.unlink(current.id)

  return (
    <>
      {showRefundOf && (
        <CreateModalSectionFrame
          step="04"
          title="Refund of"
          titleEnd={refundOfStatus && <RefundStatusBadge status={refundOfStatus} />}
        >
          <div className="-mb-2">
            <AnimatePresence initial={false}>
              {savedOriginalId && savedOriginal.isError && !savedOriginal.data ? (
                <RevealRow key="failed">
                  <LoadFailedRow />
                </RevealRow>
              ) : savedOriginalId && !savedOriginal.data ? (
                <RevealRow key="loading" testId="linked-row">
                  <RefundChainPlaceholder />
                </RevealRow>
              ) : original ? (
                <RevealRow key={original.id} testId="linked-row">
                  <RefundChainBox>
                    {expenseRow(original, original === pendingOriginal, 'linked-transaction')}
                    <RefundChainLead />
                    {chainIds.map((id, index) => (
                      <div key={id}>
                        <RefundChainGap />
                        {id === current.id ? (
                          <RefundChainRow
                            icon={iconOf(original)}
                            merchantName={current.merchant_name ?? NO_MERCHANT}
                            kind="This refund"
                            dt={current.dt}
                            amount={current.amount}
                            currency={current.currency}
                            unlink={
                              readOnly
                                ? undefined
                                : {
                                    otherName: original.merchant_name ?? NO_MERCHANT,
                                    disabled,
                                    onUnlink: unlinkOriginal,
                                  }
                            }
                            lineAbove
                            lineBelow={index < chainIds.length - 1}
                            linkId={current.id}
                            testId="refund-chain-self"
                          />
                        ) : (
                          <SavedRefundRow
                            refundId={id}
                            icon={iconOf(original)}
                            unlink={null}
                            keepsUnlinkRoom={!readOnly}
                            lineBelow={index < chainIds.length - 1}
                            testId="refund-chain-sibling"
                          />
                        )}
                        <RefundChainGap drawn={index < chainIds.length - 1} />
                      </div>
                    ))}
                    {!siblingsLoadFailed && (
                      <RefundChainFooter room={originalRoom} currency={original.currency} keepsUnlinkRoom={!readOnly} />
                    )}
                  </RefundChainBox>
                </RevealRow>
              ) : (
                fitKnown && (
                  <RevealRow key={anythingFits ? 'prompt' : 'reason'}>
                    {prompt(
                      'If this gives money back for an expense, you can link them here.',
                      'Link to an expense',
                      NO_EXPENSE_FITS,
                    )}
                  </RevealRow>
                )
              )}
            </AnimatePresence>
          </div>
        </CreateModalSectionFrame>
      )}
      {showRefunds && (
        <CreateModalSectionFrame
          step={showRefundOf ? '05' : '04'}
          title="Refunds"
          titleAccessory={refundCount > 0 && <RefundCount count={refundCount} />}
          titleEnd={refundsStatus && <RefundStatusBadge status={refundsStatus} />}
        >
          <div className="-mb-2">
            <AnimatePresence initial={false}>
              {refundCount > 0 && (
                <RevealRow key="chain">
                  <RefundChainBox>
                    {expenseRow(current, false, 'refund-chain-expense')}
                    <RefundChainLead />
                    <AnimatePresence initial={false}>
                      {refundRows.map(({ row }, index) => row(index === refundRows.length - 1))}
                    </AnimatePresence>
                    {!refundsLoadFailed && (
                      <RefundChainFooter room={refundRoom} currency={current.currency} keepsUnlinkRoom={!readOnly} />
                    )}
                  </RefundChainBox>
                </RevealRow>
              )}
              {/* The reason and the prompt are rows of their own, so one eases out as the other and any new refund ease
                  in, with no jump in the section's height */}
              {offersRefundLink && fitKnown && (
                <RevealRow key={anythingFits ? 'prompt' : 'reason'}>
                  {prompt(
                    'If a refund for this expense is already recorded, you can link them here.',
                    'Link an existing refund',
                    noRefundFits,
                  )}
                </RevealRow>
              )}
            </AnimatePresence>
          </div>
        </CreateModalSectionFrame>
      )}
      <TransactionModalLinkRefundPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        transaction={current}
        heldIds={pending.links.map((link) => link.id)}
        unlinkedIds={pending.unlinkedRefundIds}
        refundRoom={refundRoom}
        onPick={(picked) => {
          picked.forEach(pending.addLink)
          focusAfterPick.current = isRefund ? current.id : (picked.at(-1)?.id ?? null)
        }}
      />
    </>
  )
}
