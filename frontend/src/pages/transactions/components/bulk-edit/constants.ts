/**
 * Transactions one bulk edit may carry, matching the bound the endpoint enforces
 *
 * Held here as well so the bar can stop a larger selection before the confirmation, rather than
 * letting the request be refused after the user has already agreed to it
 */
export const MAX_BULK_EDIT_TRANSACTIONS = 1000
