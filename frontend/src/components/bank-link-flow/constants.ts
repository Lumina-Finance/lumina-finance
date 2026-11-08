/**
 * Why bank actions that need the sync worker are held back, wherever they are offered. The app reads
 * the worker as missing when none has checked in lately, which on a server with none stays so
 */
export const BANK_SYNC_NOT_SET_UP_REASON = "Bank sync isn't set up on this server yet."

/** Why a group account can't be linked, wherever linking it would be offered */
export const GROUP_ACCOUNT_LINK_REASON = "Accounts shared with a group can't be linked to a bank yet."

/** Why nothing can be linked for a user with no working connection while no provider takes new ones */
export const NOTHING_TO_LINK_REASON =
  'No bank provider is open to new connections right now, so there is nothing to link this account to yet.'

/** Where connections are added and reconnected */
export const BANK_CONNECTIONS_SETTINGS_PATH = '/settings#bank-connections'
