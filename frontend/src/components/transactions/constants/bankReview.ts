import {
  TRANSACTION_LIST_EASE,
  TRANSACTION_LIST_ENTER_DURATION_S,
  TRANSACTION_LIST_EXIT_DURATION_S,
} from '@/components/transactions/constants/transactionList'

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
