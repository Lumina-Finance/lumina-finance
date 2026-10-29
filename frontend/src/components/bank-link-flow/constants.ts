/** Why a bank account can't be linked while the bank sync worker is down, wherever linking is offered */
export const LINKING_PAUSED_REASON = "Bank sync isn't running right now. You can link accounts once it's back."

/** Why a group account can't be linked, wherever linking it would be offered */
export const GROUP_ACCOUNT_LINK_REASON = "Accounts shared with a group can't be linked to a bank yet."

/** Why nothing can be linked for a user with no working connection while no provider takes new ones */
export const NOTHING_TO_LINK_REASON =
  'No bank provider is open to new connections right now, so there is nothing to link this account to yet.'

/** Where connections are added and reconnected */
export const BANK_CONNECTIONS_SETTINGS_PATH = '/settings#bank-connections'
