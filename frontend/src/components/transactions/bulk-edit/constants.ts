/**
 * Transactions one bulk edit or bulk delete may carry, matching the bound both endpoints enforce
 *
 * Held here as well so the page can stop a larger selection before the confirmation, rather than
 * letting the request be refused after the user has already agreed to it
 */
export const MAX_BULK_EDIT_TRANSACTIONS = 1000

/** Tags one bulk request may add or replace, matching the API's per-operation tag bound */
export const MAX_BULK_TAGS = 32
