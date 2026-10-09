/** The longest nickname a connection may have, which the server enforces too */
export const CONNECTION_NICKNAME_MAX_LENGTH = 64;

// Review backlog thresholds, counted in new posted items awaiting their first review. The server
// pauses and resumes an account's sync at these counts, and the app words its warning from them
export const REVIEW_WARNING_COUNT = 80;
export const REVIEW_PAUSE_COUNT = 100;
export const REVIEW_RESUME_COUNT = 50;

/** How many review items one page of the inbox holds */
export const REVIEW_PAGE_SIZE = 50;

// The link list is read this often while one of the user's syncs or imports runs, so progress moves
// visibly while the user watches
export const BANK_LINKS_ACTIVE_POLL_MS = 2 * 1000;

// Otherwise it is read this often while any link exists, to notice an automatic sync coming due while
// the tab is in view
export const BANK_LINKS_IDLE_POLL_MS = 60 * 1000;

// A connection or link flow waiting on a listing of its bank accounts checks back this often
export const BANK_DISCOVERY_POLL_MS = 3 * 1000;
