import {
  TRANSACTION_LIST_EASE,
  TRANSACTION_LIST_ENTER_DURATION_S,
  TRANSACTION_LIST_EXIT_DURATION_S,
} from '@/components/transactions/constants/transactionList'

// The review block and the strips under it line up with the list's Upcoming box: what they hold sits
// 12px inside the box's edges, their headers are 40px tall with a 16px icon leading a title 40px in, and
// their corners are 8px. The dashed edge is a layer over the box rather than a border on it, as
// Upcoming's is, so it takes no room and the 12px counts from the box's outer edge. The box is isolated,
// so the edge's layer stays inside it rather than rising over the page's bars
export const BANK_BOX_CLASS = 'relative isolate overflow-hidden rounded-lg'
export const BANK_BOX_EDGE_CLASS = 'pointer-events-none absolute inset-0 z-20 rounded-lg border border-dashed'

// A strip's header, the whole of which opens and closes it. Rounded like the box at whichever corners it
// fills, so its focus ring follows them. Its muted words and icons lift to the full text colour over the
// hover tint
export const BANK_STRIP_HEADER_CLASS =
  'flex w-full items-center gap-3 px-3 py-2 text-left text-[var(--app-text-muted)] transition-control hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:bg-transparent! focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)] motion-reduce:transition-none'

const COLLAPSED = { height: 0, opacity: 0 }
const FADED = { opacity: 0 }

// How the review block and its rows grow in and collapse out, as the list's day groups do, or fade
// at once for a reader who asks for less motion
export const REVIEW_MOTION = {
  full: {
    collapsed: COLLAPSED,
    enterTransition: { duration: TRANSACTION_LIST_ENTER_DURATION_S, ease: TRANSACTION_LIST_EASE },
    leave: { ...COLLAPSED, transition: { duration: TRANSACTION_LIST_EXIT_DURATION_S, ease: TRANSACTION_LIST_EASE } },
  },
  reduced: {
    collapsed: FADED,
    enterTransition: { duration: 0 },
    leave: { ...FADED, transition: { duration: 0 } },
  },
}
