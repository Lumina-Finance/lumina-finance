import { CONTENT_EASE_CURVE } from '@/utils/widthEase'

// Rows enter, leave and expand the way the tag, merchant and category lists' rows do
export const CONNECTION_LIST_HEIGHT_TRANSITION = { duration: 0.24, ease: CONTENT_EASE_CURVE }
export const CONNECTION_ROW_INITIAL = { opacity: 0, y: -4 }
export const CONNECTION_ROW_ANIMATE = { opacity: 1, y: 0 }
export const CONNECTION_ROW_EXIT = { opacity: 0, y: -4 }
export const CONNECTION_ROW_TRANSITION = { duration: 0.18, ease: CONTENT_EASE_CURVE }

// The list's columns once the list itself is 47rem wide: the connection, its bank accounts, its
// requests left, when it was added, its status and the row's chevron. The header and every row share
// it so the columns line up. A narrower list drops the header and stacks each row instead. Each detail
// column fits its longest value, such as "12 of 12 linked" and "Bank sign-in needed", and the width is
// the list's rather than the screen's, since the sidebar and the settings menu take a varying share of
// the screen, so the name keeps at least 10rem
export const CONNECTION_COLUMNS_CLASS =
  '@min-[47rem]/connections:grid-cols-[minmax(0,1fr)_6.5rem_6rem_6.5rem_10rem_1rem]'

// A connection with more institutions than this gets a search field over them
export const INSTITUTION_SEARCH_AFTER = 5

// How long a just-linked bank account shows as linking before its account settles in
export const LINKING_HOLD_MS = 700
