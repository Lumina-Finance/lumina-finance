import { CONTENT_EASE_CURVE } from '@/utils/widthEase'

// Rows enter, leave and expand the way the tag, merchant and category lists' rows do
export const CONNECTION_LIST_HEIGHT_TRANSITION = { duration: 0.24, ease: CONTENT_EASE_CURVE }
export const CONNECTION_ROW_INITIAL = { opacity: 0, y: -4 }
export const CONNECTION_ROW_ANIMATE = { opacity: 1, y: 0 }
export const CONNECTION_ROW_EXIT = { opacity: 0, y: -4 }
export const CONNECTION_ROW_TRANSITION = { duration: 0.18, ease: CONTENT_EASE_CURVE }

// The list's columns from 750px: the connection, its bank accounts, when it was added, its status and
// the row's chevron. The header and every row share it so the columns line up. Narrower screens drop
// the header and stack each row instead
export const CONNECTION_COLUMNS_CLASS = 'min-[750px]:grid-cols-[minmax(0,1fr)_9.5rem_7.5rem_11rem_1rem]'

// A connection with more institutions than this gets a search field over them
export const INSTITUTION_SEARCH_AFTER = 5

// How long a just-linked bank account shows as linking before its account settles in
export const LINKING_HOLD_MS = 700
