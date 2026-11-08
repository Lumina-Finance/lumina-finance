import { useContext, useId, useState, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link2, StickyNote, Tag as TagIcon } from 'lucide-react'
import type { Institution } from '@/api/institutions'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import type { useDisabledReason } from '@/hooks/useDisabledReason'
import { getDisabledReasonProps } from '@/utils/disabledReasonControl'
import { Checkbox } from '@/components/forms/Checkbox'
import { BankMarker, type TransactionRowBankMarker } from '@/components/transactions/BankMarker'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/components/transactions/bulk-edit/constants'
import type { RowSelectionMark } from '@/components/transactions/bulk-edit/selection'
import {
  REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL,
  TRANSACTION_CHECKBOX_RAIL,
  TRANSACTION_CHECKBOX_RAIL_DURATION_S,
  TRANSACTION_CHECKBOX_RAIL_WIDTH,
  TRANSACTION_ROW_SCROLL_MARGIN,
} from '@/components/transactions/constants/transactionList'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { FADED_ROW_COLOURS, FadedRowsContext } from '@/contexts/FadedRowsContext'
import { getRefundLinkLabel } from '@/components/transactions/utils/refundLink'
import { getAmountSign } from '@/utils/negativeAmount'
import { useUsableLogo } from '@/hooks/useUsableLogo'
import { LOGO_PLACEHOLDER_STYLE, resolveInstitutionLogoUrl } from '@/utils/institutionLogo'

const MAX_VISIBLE_TAGS = 1
const DEFAULT_CATEGORY_ICON = '🏷️'
const ROW_EXIT_EASE = [0.25, 0.1, 0.25, 1] as const

// The selection box sits one level above the title's layer and no higher, so the Upcoming section's
// stuck header, laid at 10, still covers a box that scrolls under it
const CHECKBOX_OVER_TITLE_LAYER = 1

export type TransactionRowMetadata = Pick<
  Transaction,
  'id' | 'dt' | 'merchant_name' | 'notes' | 'tags' | 'counterparty_account_scope'
> &
  Partial<Pick<Transaction, 'refund_of_transaction_id' | 'refund_transaction_ids'>>
export type TransactionFxNote = 'unavailable' | 'rateNotPublished'

/**
 * Supplies already signed and formatted amount text, with the amount's sign controlling color
 * and transfer direction independently of its numeric representation
 */
export type TransactionAmountPresentation = { text: string; sign: -1 | 0 | 1 }

/**
 * Describes the counterparty of a transfer for the line that shows a merchant on other kinds
 *
 * Returns null when nothing was recorded, which is every transfer predating the field, so the row
 * falls back to the merchant rather than claiming an answer it does not have
 */
function describeTransferCounterparty(
  transaction: TransactionRowMetadata,
  sign: TransactionAmountPresentation['sign'],
  counterpartyAccountName: string | undefined,
): string | null {
  const counterparty =
    transaction.counterparty_account_scope === 'outside'
      ? 'outside this app'
      : transaction.counterparty_account_scope === 'tracked'
        ? counterpartyAccountName
        : undefined
  if (!counterparty) return null

  // Which way the money went reads the same whether the counterparty is an account or not, so money
  // leaving the tracked accounts gets the same wording rather than standing on its own
  return sign < 0 ? `To ${counterparty}` : `From ${counterparty}`
}

/**
 * What the row needs while the list is in selection mode
 *
 * Absent everywhere else, including the import preview, which renders the same row and offers no
 * selection at all
 */
export interface TransactionRowSelection {
  /** How the row is marked once any pending shift-click or day tick is taken into account */
  mark: RowSelectionMark

  /** False for a row the app does not allow editing, such as one on an archived account */
  isSelectable: boolean

  onToggle: (withShift: boolean) => void
  onPointerEnter: () => void
}

type DisabledReasonState = ReturnType<typeof useDisabledReason>

interface TransactionRowProps {
  accountName?: string

  // The account a transfer recorded as its counterparty, looked up by the caller. Absent on every
  // other kind, and on a transfer whose recorded account is not in the caller's list
  counterpartyAccountName?: string
  accountInstitution?: Institution | null
  category: Category | undefined
  currency: string
  readOnlyReason?: string
  // The amount could not be converted into the currency the list totals in, so the day's total leaves it out
  fxNote?: TransactionFxNote
  transaction: Transaction
  // Skips the height collapse on removal so a deletion just fades when the viewer prefers reduced motion
  prefersReducedMotion?: boolean | null
  // Makes the row appear without the grow in, used for a lazy loaded batch that would otherwise all grow at once
  skipEnterAnimation?: boolean

  // Lays the row out as it is on a phone at every width, for a list that is not on the transaction list's columns
  phoneLayout?: boolean

  // Marks the row as a toggle, for a list where pressing a row picks it instead of opening it
  pressed?: boolean

  // Holds the row off while it can't be used, with its reason in the shared tooltip on hover, keyboard focus and tap
  // and described for a screen reader, as for a greyed out button. The row's own reason text is not drawn
  disabledReason?: DisabledReasonState
  selection?: TransactionRowSelection

  // The id of the day's heading above the row. It names the date the row's button is described by
  dateHeadingId?: string

  // Goes to the waiting correction or removal a bank-imported transaction names, given where the list
  // shows the review block. Without it the row leaves the Needs review marker out
  onShowReview?: (reviewItemId: string) => void
  onOpen: (transaction: Transaction) => void
}

interface TransactionRowViewProps extends Omit<
  TransactionRowProps,
  'transaction' | 'currency' | 'onShowReview' | 'onOpen'
> {
  transaction: TransactionRowMetadata
  amountPresentation: TransactionAmountPresentation

  // Present on a bank-imported transaction only, so manual rows look exactly as they always have
  bankMarker?: TransactionRowBankMarker
  onOpen: () => void
}

// The row's two layouts, the grid from 750px wide and the stacked one on a phone
type RowLayout = 'wide' | 'narrow'

// From 750px wide the title is the row's second line, under the category's line and the gap below
// it, so a title brought into view below the pinned bars leaves room for that line too and the whole
// row shows rather than the title alone
const TITLE_SCROLL_MARGIN: Record<RowLayout, string> = {
  wide: `calc(${TRANSACTION_ROW_SCROLL_MARGIN} + 1.625rem)`,
  narrow: TRANSACTION_ROW_SCROLL_MARGIN,
}

// On a phone the title is the row's first line, with the category line and the account line under it
// (1.125rem each, a 0.125rem gap above each), so a title brought into view at the foot of the screen
// leaves room for both and the whole row shows. The wide layout ends with the title
const NARROW_TITLE_SCROLL_MARGIN_BOTTOM = '3rem'

// How far a faded row dims its category icon. Icons carry no text, so the contrast every text
// needs doesn't bound it, but a pale icon such as the white plate all but vanished on the light rows below this
const FADED_CATEGORY_ICON_OPACITY = 0.75

// A row that stops being faded brings its icon back with the rest of the change, so the icon eases rather than snaps
const ICON_FADE_CLASS_NAME = 'transition-opacity motion-reduce:transition-none'

function amountColor(category: Category | undefined, amount: number) {
  if (category?.kind === 'expense' && amount > 0) return 'var(--app-positive)'
  if (category?.kind === 'income' && amount < 0) return 'var(--app-negative)'
  return 'var(--app-text)'
}

function AccountLogo({
  accountName,
  institution,
}: {
  accountName: string | undefined
  institution: Institution | null | undefined
}) {
  const logo = useUsableLogo(resolveInstitutionLogoUrl(institution))
  const logoSrc = logo.src

  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md"
      style={
        logoSrc ? { background: 'var(--app-input-bg)', border: '1px solid var(--app-border)' } : LOGO_PLACEHOLDER_STYLE
      }
    >
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={`${institution?.name ?? accountName ?? 'Account'} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
          {...logo.imageProps}
        />
      ) : (
        <span
          className="select-none text-[0.625rem] font-semibold leading-none"
          style={{ color: 'var(--app-accent-on-page-tint)' }}
        >
          $
        </span>
      )}
    </span>
  )
}

function ReadOnlyReasonPill({ id, reason }: { id: string; reason: string }) {
  return (
    <span
      id={id}
      className="inline-flex w-fit max-w-full rounded-full border px-1.5 py-0.5 text-[0.6875rem] leading-none"
      style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-muted)' }}
    >
      <span className="min-w-0 truncate">{reason}</span>
    </span>
  )
}

// Hidden from a screen reader since the row's description already names the tags
function TagTooltip({ tags }: { tags: Transaction['tags'] }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 flex w-52 -translate-x-1/2 flex-col items-start gap-1"
    >
      <span
        className="app-tag-tooltip-glass absolute -inset-6 rounded-3xl"
        style={{
          maskImage: 'radial-gradient(ellipse farthest-side at center, black 0%, black 55%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse farthest-side at center, black 0%, black 55%, transparent 100%)',
        }}
        aria-hidden
      />
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="relative inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            background: 'var(--app-surface-soft)',
            color: 'var(--app-text-muted)',
            border: '1px solid var(--app-border)',
          }}
        >
          <TagIcon size={11} aria-hidden className="shrink-0" />
          <span className="truncate">{tag.name}</span>
        </span>
      ))}
    </span>
  )
}

/** The ids a row's title is described by, one for each mark the icons draw that the layout has no text for */
type NoteAndTagIconIds = Partial<{ refund: string; note: string; tags: string }>

// Where a row has no room for the tag names or the note's text, it marks that they exist
function NoteAndTagIcons({
  hasNotes,
  tagCount,
  ids,
  refundLink = null,
  className = '',
}: {
  hasNotes: boolean
  tagCount: number
  ids: NoteAndTagIconIds
  refundLink?: string | null
  className?: string
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 ${className}`}>
      {refundLink && (
        <span
          id={ids.refund}
          // Positioned so it sits above the title's layer and its hint can be hovered
          className="relative inline-flex"
          role="img"
          aria-label={refundLink}
          title={refundLink}
          data-testid="transaction-refund-link"
        >
          <Link2 size={14} strokeWidth={2} aria-hidden />
        </span>
      )}
      {hasNotes && (
        <span id={ids.note} className="inline-flex" aria-label="Has note">
          <StickyNote size={14} strokeWidth={2} aria-hidden />
        </span>
      )}
      {tagCount > 0 && (
        <span
          id={ids.tags}
          className="inline-flex items-center gap-1"
          aria-label={`${tagCount} ${tagCount === 1 ? 'tag' : 'tags'}`}
        >
          <TagIcon size={14} strokeWidth={2} aria-hidden />
          {tagCount > 1 && <span className="text-xs font-medium">{tagCount}</span>}
        </span>
      )}
    </span>
  )
}

const FX_NOTES: Record<TransactionFxNote, { text: string; color: string }> = {
  // The look the accounts list gives a balance it could not convert
  unavailable: { text: 'FX unavailable', color: 'var(--app-negative)' },
  // A future-dated amount has no rate because none is published yet, which is no failure
  rateNotPublished: { text: 'Rate not published yet', color: 'var(--app-text-muted)' },
}

/**
 * Says under an amount that it has no exchange rate, and whether that is a failure or only a rate
 * that is not published yet
 */
function FxNote({ id, note }: { id?: string; note: TransactionFxNote }) {
  const { text, color } = FX_NOTES[note]
  return (
    <span id={id} className="block text-right text-xs font-normal leading-4" style={{ color }}>
      {text}
    </span>
  )
}

/**
 * Renders one transaction as a clickable row, showing its category, account, notes, tags, and signed
 * amount, and calling `onOpen` when clicked
 *
 * Renders two layouts gated by breakpoint, a grid of columns from 750px wide and a stacked layout on
 * narrower screens, and animates its height on mount and removal unless
 * `prefersReducedMotion` is set. A `readOnlyReason` dims the row and shows why it cannot be edited
 */
export default function TransactionRow({ transaction, currency, onShowReview, onOpen, ...props }: TransactionRowProps) {
  const { formatMovedCurrency } = useMoneyFormatters()
  const sign = getAmountSign(transaction.amount)
  const text = formatMovedCurrency(transaction.amount, currency)

  // Read from the source the transaction carries, so the marker needs no request of its own and stays
  // once the account is unlinked. A waiting correction or removal shows the Needs review marker where
  // the list can go to its item
  const source = transaction.bank_source
  const reviewItemId = source?.review_item_id ?? null
  const bankMarker = source
    ? {
        providerName: source.provider_name,
        isEdited: source.edited_fields.length > 0,
        needsReview: reviewItemId !== null && onShowReview !== undefined,
        onShowReview: reviewItemId !== null && onShowReview ? () => onShowReview(reviewItemId) : undefined,
      }
    : undefined
  return (
    <TransactionRowView
      {...props}
      transaction={transaction}
      amountPresentation={{ text, sign }}
      bankMarker={bankMarker}
      onOpen={() => onOpen(transaction)}
    />
  )
}

/** Renders transaction metadata with an already formatted amount and its exact direction */
export function TransactionRowView({
  accountName,
  counterpartyAccountName,
  accountInstitution,
  category,
  readOnlyReason,
  fxNote,
  transaction,
  amountPresentation,
  prefersReducedMotion,
  skipEnterAnimation = false,
  phoneLayout = false,
  pressed,
  disabledReason,
  selection,
  bankMarker,
  dateHeadingId,
  onOpen,
}: TransactionRowViewProps) {
  const wide = !phoneLayout
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (!selection) {
      onOpen()
      return
    }

    // A shift-click lands on a row the app will not edit as readily as on any other, and the
    // range it takes steps over that row, so it runs anyway rather than doing nothing under a
    // pointer the highlight has already answered
    if (selection.isSelectable || event.shiftKey) selection.onToggle(event.shiftKey)
  }
  const reasonProps = getDisabledReasonProps<HTMLElement>(
    disabledReason ?? { isUnavailable: false, controlProps: {}, handleBlockedClick: () => {} },
    { onClick: handleClick },
  )
  const isHeldOff = disabledReason?.isUnavailable === true
  const marker = bankMarker ? <BankMarker {...bankMarker} /> : null

  // The row clips its content only while the height animates, so the grow and collapse read cleanly
  // while the resting row still lets a tag tooltip overflow past its edges
  const [isAnimatingHeight, setIsAnimatingHeight] = useState(false)
  const categoryName = category?.name ?? 'Uncategorized'
  const categoryIcon = category?.icon ?? DEFAULT_CATEGORY_ICON
  const fallbackTitle = category?.kind === 'transfer' ? 'Transfer' : 'Transaction'

  // A transfer's merchant is almost always the same stand-in, so where the money went takes the line
  // that shows a merchant on other kinds, and the merchant fills in only for a transfer that
  // recorded no counterparty
  const transferCounterparty =
    category?.kind === 'transfer'
      ? describeTransferCounterparty(transaction, amountPresentation.sign, counterpartyAccountName)
      : null
  const title = transferCounterparty ?? transaction.merchant_name ?? fallbackTitle
  const hasNotes = Boolean(transaction.notes?.trim())
  const tags = [...(transaction.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS)
  const extraTagCount = Math.max(tags.length - visibleTags.length, 0)
  const hasVisibleTags = visibleTags.length > 0
  const refundLink = getRefundLinkLabel(transaction)
  const hasSupplementalMeta = hasNotes || hasVisibleTags || refundLink !== null
  const hasAccountMeta = !!accountName || !!accountInstitution
  const readOnly = Boolean(readOnlyReason)
  const isInFadedSection = useContext(FadedRowsContext)
  // A read-only row is faded the way a faded section fades its rows, and still says why beside its account
  const isFaded = isInFadedSection || readOnly
  const formattedAmount = amountPresentation.text
  // A faded row draws a refund or reversal in its muted text too, through the text token it remaps to the
  // muted colour, and dims the category icon, which colour can't reach, so nothing in the row reads as
  // strongly as one that counts
  const transactionAmountColor = isFaded ? 'var(--app-text)' : amountColor(category, amountPresentation.sign)
  const categoryIconStyle = { opacity: isFaded ? FADED_CATEGORY_ICON_OPACITY : 1 }

  // Only the limit gets a title here, since a read-only row already explains itself through the
  // pill beside its account name
  const tickTitle =
    selection && !selection.isSelectable && !readOnly
      ? `Up to ${MAX_BULK_EDIT_TRANSACTIONS} transactions can be ticked at once`
      : undefined

  // A ticked row is marked with a background, which leaves every text on it at full strength
  const selectionBackground =
    selection?.mark === 'selected'
      ? 'var(--app-accent-soft)'
      : selection?.mark === 'pending'
        ? 'var(--app-hover-soft)'
        : undefined

  // The row's own control is its title, stretched over the whole row by a layer laid across it, the
  // way an account row stretches its name. The controls inside the row, such as the bank marker and
  // the tags, are positioned and so sit above that layer. That keeps them hoverable and pressable
  // and keeps one button from holding another. A screen reader reads the row once, in order, with
  // the title as the button. Both layouts render, each with its own title, and the one not on screen
  // is hidden with display: none. That keeps its title out of the tab order and away from a screen
  // reader. The press and the pointer are taken by the content the layer stretches across, so a title
  // carries only the rest of the reason: its focus and the blocked key press, and its description.
  // That follows the amount and the day's heading. The row draws the shared focus ring around itself
  // and takes the hover shade while a title or the checkbox has keyboard focus, so the bank icon and the
  // marker beside the title keep their own rings without a second one around the row
  //
  // Tabbing from row to row hears only the button's name and description, so each title is
  // described by the category, the account and the amount beside it in its own layout, in the order that
  // layout shows them, and by its day's heading. The heading names its date. What the row says beyond
  // those, the exchange rate note, the read-only reason, the refund link, the note and the tags, is read
  // too, in the form the layout draws at that width. The wide layout reads the note's text and the tag
  // names where the extras track has room for them and the icons that stand for them where it has not,
  // and the phone layout reads the icons. The logo and the category icon are left out, since the names
  // beside them already say what they show
  const descriptionId = useId()
  const amountId = (layout: RowLayout) => `${descriptionId}-amount-${layout}`
  const categoryId = (layout: RowLayout) => `${descriptionId}-category-${layout}`
  const accountId = (layout: RowLayout) => `${descriptionId}-account-${layout}`
  // Only the phone layout draws the note apart from the amount. The wide layout's amount holds it
  const phoneFxNoteId = `${descriptionId}-fx-narrow`
  const readOnlyId = (layout: RowLayout) => `${descriptionId}-read-only-${layout}`
  // The phone layout has room for the icons alone, each described by its own id
  const phoneIconIds: NoteAndTagIconIds = {
    refund: `${descriptionId}-refund-narrow`,
    note: `${descriptionId}-note-narrow`,
    tags: `${descriptionId}-tags-narrow`,
  }
  // The wide layout holds the note's text, the tag names and their icons in one element that is always
  // drawn. The extras track's width decides which form of each shows, and a screen reader leaves the
  // hidden forms out of an element's text, so the description follows what the row draws
  const wideExtrasId = `${descriptionId}-extras-wide`
  const describingIds = (layout: RowLayout) => {
    const category = categoryId(layout)
    const account = accountName ? accountId(layout) : null
    const amount = amountId(layout)
    if (layout === 'wide') {
      const readOnlyPill = readOnlyReason && hasAccountMeta ? readOnlyId(layout) : null
      return [category, account, readOnlyPill, hasSupplementalMeta ? wideExtrasId : null, amount]
    }
    const readOnlyPill = readOnlyReason && (hasAccountMeta || hasSupplementalMeta) ? readOnlyId(layout) : null
    // The phone layout shows the amount first
    return [
      amount,
      fxNote ? phoneFxNoteId : null,
      category,
      account,
      readOnlyPill,
      refundLink ? phoneIconIds.refund : null,
      hasNotes ? phoneIconIds.note : null,
      tags.length > 0 ? phoneIconIds.tags : null,
    ]
  }
  const { onClick: handleContentClick, onMouseEnter, onMouseMove, onMouseLeave, ...titleReasonProps } = reasonProps
  const renderTitleButton = (layout: RowLayout) => (
    <button
      type="button"
      data-row-title=""
      // In selection mode the checkbox is the row's single stop, so the same row does not offer two
      // controls doing the same thing
      tabIndex={selection ? -1 : undefined}
      {...titleReasonProps}
      aria-describedby={[...describingIds(layout), dateHeadingId, titleReasonProps['aria-describedby']]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={pressed}
      className={`min-w-0 ${isHeldOff ? 'cursor-not-allowed' : 'cursor-pointer'} text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none`}
      style={{
        scrollMarginTop: TITLE_SCROLL_MARGIN[layout],
        scrollMarginBottom: layout === 'narrow' ? NARROW_TITLE_SCROLL_MARGIN_BOTTOM : undefined,
      }}
    >
      <span className="block truncate">{title}</span>
    </button>
  )

  return (
    // The row's own box, around the content that carries transaction-row-<id>, with the row's padding
    // and separator. That is what a focused row's ring has to go round
    <motion.div
      data-testid={`transaction-box-${transaction.id}`}
      onMouseEnter={selection?.onPointerEnter}
      initial={
        skipEnterAnimation
          ? false
          : prefersReducedMotion
            ? { opacity: 0 }
            : { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }
      }
      // The row's whole vertical padding, set here rather than in a class, so it can animate from
      // zero and the row grows from a fully collapsed height
      animate={{ opacity: 1, height: 'auto', paddingTop: '0.625rem', paddingBottom: '0.625rem' }}
      exit={
        prefersReducedMotion
          ? { opacity: 0, transition: { duration: 0 } }
          : {
              opacity: 0,
              height: 0,
              paddingTop: 0,
              paddingBottom: 0,
              overflow: 'hidden',
              transition: { duration: 0.24, ease: ROW_EXIT_EASE },
            }
      }
      transition={{ duration: prefersReducedMotion ? 0 : 0.24, ease: ROW_EXIT_EASE }}
      onAnimationStart={() => setIsAnimatingHeight(true)}
      onAnimationComplete={() => setIsAnimatingHeight(false)}
      className={`app-transaction-row relative flex items-center ${isHeldOff ? '' : 'hover:bg-[var(--app-hover-soft)]'} ${wide ? 'min-[750px]:col-span-full min-[750px]:grid min-[750px]:grid-cols-subgrid min-[750px]:items-center min-[750px]:gap-x-3 min-[1300px]:gap-x-4' : ''}`}
      style={{
        borderBottom: '1px solid var(--app-border)',
        overflow: isAnimatingHeight ? 'hidden' : 'visible',
        background: selectionBackground,
        // The row starts at the left edge of the rail rather than after it, so its background and its
        // separator cover the checkbox as well, while the padding puts its cells back on the tracks
        ...REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL,
        // A faded section sets these on all of its rows already
        ...(readOnly && !isInFadedSection ? FADED_ROW_COLOURS : {}),
        paddingLeft: TRANSACTION_CHECKBOX_RAIL,
      }}
    >
      {/* initial={false} so a row scrolling into view while selection mode is already on shows its
          checkbox rather than growing one. AnimatePresence keeps the last rendered checkbox mounted
          through its exit, which is why it can still read the selection that has just gone */}
      <AnimatePresence initial={false}>
        {selection && (
          <motion.span
            key="row-checkbox"
            // Laid over the rail rather than placed in the row, because a cell of the row would take
            // one of the list's columns, and the content beside it asks for all five of them. The rail
            // is the row's own left padding, so the box sits still at the list's edge while the rail
            // opens and closes underneath the rest of the row. Raised above the title's layer, which spans
            // the rail too, so a press on the box ticks it rather than landing on the row
            className="absolute inset-y-0 left-0 flex items-center justify-center"
            style={{ width: TRANSACTION_CHECKBOX_RAIL_WIDTH, zIndex: CHECKBOX_OVER_TITLE_LAYER }}
            title={tickTitle}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
            transition={{
              duration: prefersReducedMotion ? 0 : TRANSACTION_CHECKBOX_RAIL_DURATION_S,
              ease: ROW_EXIT_EASE,
            }}
          >
            <Checkbox
              checked={selection.mark === 'selected'}
              disabled={!selection.isSelectable}
              label={`Select ${title} on ${transaction.dt}`}
              onChange={(event) => selection.onToggle(event.shiftKey)}
            />
          </motion.span>
        )}
      </AnimatePresence>

      {/* The row's content, and from 750px wide a subgrid of its own so the cells inside it still
          line up against the tracks the list declares. Left unpositioned, so the title's layer
          stretches across the whole row, its padding included, and its focus ring goes round the
          row rather than tight around the text. A press anywhere on the row lands here, the title's
          own press and Enter on it included, along with a press on a tag, which sits above the layer
          for its tooltip. A shift-press holds back the text selection it would otherwise stretch
          across the rows it ranges over */}
      <div
        data-testid={`transaction-row-${transaction.id}`}
        data-row-content=""
        onClick={handleContentClick}
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseDown={(event) => {
          if (event.shiftKey) event.preventDefault()
        }}
        className={`block w-full min-w-0 flex-1 ${isHeldOff ? 'cursor-not-allowed' : 'cursor-pointer'} px-3 text-left ${wide ? 'min-[750px]:col-span-5 min-[750px]:grid min-[750px]:grid-cols-subgrid min-[750px]:items-center min-[750px]:gap-x-3 min-[1300px]:gap-x-4' : ''}`}
      >
        {/* Row from 750px wide: each cell is a direct child of this content's subgrid. The subgrid spans the
          list's content tracks, so every row shares the same column tracks and stays aligned. The
          category and account tracks grow to their widest content across all rows, showing long
          names while there is room and truncating only when there is not, with the note and tags
          as the flexible filler that compresses first */}
        {wide && (
          <>
            <span
              className={`hidden text-2xl leading-none min-[750px]:block ${ICON_FADE_CLASS_NAME}`}
              style={categoryIconStyle}
              aria-hidden
            >
              {categoryIcon}
            </span>

            <span className="hidden min-w-0 min-[750px]:block">
              <span id={categoryId('wide')} className="block truncate font-medium">
                {categoryName}
              </span>
              <span
                className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm"
                style={{ color: 'var(--app-text-muted)' }}
              >
                {renderTitleButton('wide')}
                {marker}
              </span>
            </span>

            <span
              className="hidden min-w-0 flex-col gap-1 text-sm font-medium leading-5 min-[750px]:flex"
              style={{ color: 'var(--app-text-muted)' }}
            >
              {hasAccountMeta && (
                <>
                  <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                    <AccountLogo accountName={accountName} institution={accountInstitution} />
                    {accountName && (
                      <span id={accountId('wide')} className="min-w-0 truncate">
                        {accountName}
                      </span>
                    )}
                  </span>
                  {readOnlyReason && <ReadOnlyReasonPill id={readOnlyId('wide')} reason={readOnlyReason} />}
                </>
              )}
            </span>

            {/* The note and the tags share the track the category, merchant and account leave over. It is
          the same width in every row, so measuring it as a container switches every row together and
          each column stays one form down the list. With too little room the tags give way to an icon
          and count first, below 22rem, and then the note to its icon, below 12rem, which leaves under
          8rem of text where most notes would be cut to a few letters. Being a container makes the
          track its own stacking context, so a hovered one rises over the pinned day heading for the
          tag list that opens above it */}
            <span className="@container/extras hidden min-w-0 hover:z-50 min-[750px]:block">
              <span
                id={wideExtrasId}
                className="flex min-w-0 items-center gap-3 text-sm leading-5 @min-[12rem]/extras:pl-5"
                style={{ color: 'var(--app-text-muted)' }}
              >
                <span className="hidden min-w-0 truncate @min-[12rem]/extras:block">{transaction.notes}</span>
                {hasNotes && <NoteAndTagIcons ids={{}} hasNotes tagCount={0} className="@min-[12rem]/extras:hidden" />}
                <span className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
                  {refundLink && <NoteAndTagIcons ids={{}} hasNotes={false} tagCount={0} refundLink={refundLink} />}
                  {hasVisibleTags && (
                    <span className="group relative inline-flex @min-[22rem]/extras:hidden">
                      <NoteAndTagIcons ids={{}} hasNotes={false} tagCount={tags.length} />
                      <TagTooltip tags={tags} />
                    </span>
                  )}
                  {visibleTags.map((tag) => (
                    <span
                      key={tag.id}
                      className="group relative hidden max-w-[8rem] shrink-0 @min-[22rem]/extras:inline-flex"
                    >
                      <span
                        className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium"
                        style={{
                          background: 'var(--app-surface-soft)',
                          color: 'var(--app-text-muted)',
                          border: '1px solid var(--app-border)',
                        }}
                      >
                        <TagIcon size={11} aria-hidden className="shrink-0" />
                        <span className="truncate">{tag.name}</span>
                      </span>
                      <TagTooltip tags={tags} />
                    </span>
                  ))}
                  {extraTagCount > 0 && (
                    <span className="group relative hidden shrink-0 @min-[22rem]/extras:inline-flex">
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-sm font-medium"
                        style={{
                          background: 'var(--app-surface-soft)',
                          color: 'var(--app-text-muted)',
                          border: '1px solid var(--app-border)',
                        }}
                      >
                        +{extraTagCount}
                      </span>
                      <TagTooltip tags={tags} />
                    </span>
                  )}
                </span>
              </span>
            </span>

            {/* The note under the amount is part of what the amount's id names, so the description reads it with the amount */}
            <span
              id={amountId('wide')}
              className="hidden min-w-0 text-right font-financial text-base font-semibold tabular-nums min-[750px]:block"
              data-testid="transaction-amount"
              style={{ color: transactionAmountColor }}
            >
              {formattedAmount}
              {fxNote && <FxNote note={fxNote} />}
            </span>
          </>
        )}

        {/* Three lines on a phone: merchant and amount, category, then account. Set close together, and
          reaching a little into the row's padding, which the wide layout keeps, so a row takes less
          height without crowding the account in beside the category. Only so far that the first and
          last lines stay 4px clear of the focus ring, which sits 2px in from the row's edge, or 4px
          in a row inside the Upcoming section's edge */}
        <span
          className={`-my-0.5 grid grid-cols-[2.125rem_minmax(0,1fr)_max-content] items-start gap-x-2.5 gap-y-0.5 ${wide ? 'min-[750px]:hidden' : ''}`}
        >
          <span
            className={`row-span-3 pt-0.5 text-[1.35rem] leading-none ${ICON_FADE_CLASS_NAME}`}
            style={categoryIconStyle}
            aria-hidden
          >
            {categoryIcon}
          </span>

          <span className="col-start-2 row-start-1 flex min-w-0 items-center gap-1.5 text-[0.9375rem] font-medium leading-5">
            {renderTitleButton('narrow')}
            {marker}
          </span>

          <span
            id={amountId('narrow')}
            className="col-start-3 row-start-1 ml-2 justify-self-end font-financial text-[0.9375rem] font-semibold leading-5 tabular-nums"
            data-testid="transaction-amount"
            style={{ color: transactionAmountColor }}
          >
            {formattedAmount}
          </span>

          <span
            id={categoryId('narrow')}
            className={`col-start-2 row-start-2 min-w-0 truncate text-sm leading-[1.125rem] ${fxNote ? '' : 'col-span-2'}`}
            style={{ color: 'var(--app-text-muted)' }}
          >
            {categoryName}
          </span>

          {/* In the category line's own row beside it, so the marker never moves the lines in the left column */}
          {fxNote && (
            <span className="col-start-3 row-start-2 ml-2 justify-self-end">
              <FxNote id={phoneFxNoteId} note={fxNote} />
            </span>
          )}

          {(hasAccountMeta || hasSupplementalMeta) && (
            <span
              className="col-start-2 col-span-2 row-start-3 flex min-w-0 items-start gap-2 text-sm leading-[1.125rem]"
              style={{ color: 'var(--app-text-muted)' }}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                {hasAccountMeta && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <AccountLogo accountName={accountName} institution={accountInstitution} />
                    {accountName && (
                      <span id={accountId('narrow')} className="min-w-0 truncate">
                        {accountName}
                      </span>
                    )}
                  </span>
                )}
                {readOnlyReason && <ReadOnlyReasonPill id={readOnlyId('narrow')} reason={readOnlyReason} />}
              </span>
              {hasSupplementalMeta && (
                <NoteAndTagIcons
                  ids={phoneIconIds}
                  hasNotes={hasNotes}
                  tagCount={tags.length}
                  refundLink={refundLink}
                  className="shrink-0 pt-0.5"
                />
              )}
            </span>
          )}
        </span>
      </div>
    </motion.div>
  )
}
