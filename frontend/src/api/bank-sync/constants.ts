/** The longest nickname a connection may have. The server enforces it too */
export const CONNECTION_NICKNAME_MAX_LENGTH = 64

/** The refusal both nickname fields show past the limit, worded as the account notes' is */
export const CONNECTION_NICKNAME_TOO_LONG_MESSAGE = `Nickname must be ${CONNECTION_NICKNAME_MAX_LENGTH} characters or less.`

// Review backlog thresholds, counted in new posted items awaiting their first review. The server
// pauses and resumes an account's sync at these counts, and the app words its warning from them
export const REVIEW_WARNING_COUNT = 80
export const REVIEW_PAUSE_COUNT = 100
export const REVIEW_RESUME_COUNT = 50

/** How many review items one page of the inbox holds */
export const REVIEW_PAGE_SIZE = 50

// The link list is read this often while one of the user's syncs or imports runs, so progress moves
// visibly while the user watches
export const BANK_LINKS_ACTIVE_POLL_MS = 2 * 1000

// Otherwise it is read this often while any link exists, to notice an automatic sync coming due while
// the tab is in view
export const BANK_LINKS_IDLE_POLL_MS = 60 * 1000

// A connection or link flow waiting on a listing of its bank accounts checks back this often
export const BANK_DISCOVERY_POLL_MS = 3 * 1000

// After a claim the app didn't answer, the connections are read this often for this long, since the
// server may still be saving the connection. A claim can take about 80 seconds, longer than the 60
// seconds a proxy in front of the app commonly waits, so Add a connection waits as long from sending
// one before it says the connection may have been added
export const UNANSWERED_CLAIM_POLL_MS = 5 * 1000
export const UNANSWERED_CLAIM_WATCH_MS = 2 * 60 * 1000
