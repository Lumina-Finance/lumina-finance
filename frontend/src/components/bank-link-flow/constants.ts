/**
 * Why bank actions that need the sync worker are held back, wherever they are offered. The app reads
 * the worker as missing when none has checked in lately, and on a server with none it stays missing
 */
export const BANK_SYNC_NOT_SET_UP_REASON = "Bank sync isn't set up on this server yet."

/** Why a group account can't be linked, wherever linking it would be offered */
export const GROUP_ACCOUNT_LINK_REASON = "Accounts shared with a group can't be linked to a bank yet."

/** Why nothing can be linked for a user with no working connection while no provider takes new ones */
export const NOTHING_TO_LINK_REASON =
  'No bank provider is open to new connections right now, so there is nothing to link this account to yet.'

/** Where connections are added and reconnected */
export const BANK_CONNECTIONS_SETTINGS_PATH = '/settings#bank-connections'

/** The fields a press of the flow's action button can find a problem with, in the order the steps draw them */
export const LINK_FLOW_FIELDS = ['bankAccount', 'startChoice', 'rangeFrom', 'rangeTo'] as const

/** The id of the control that takes focus for each field, and of the message that describes it */
export const LINK_FLOW_FIELD_IDS = {
  bankAccount: 'bank-link-bank-account',
  startChoice: 'bank-link-start-choice',
  rangeFrom: 'bank-link-range-from',
  rangeTo: 'bank-link-range-to',
  bankAccountError: 'bank-link-bank-account-error',
  startChoiceError: 'bank-link-start-choice-error',
} as const

/** The fields of the dialogue importing a date range into a linked account, in the order it draws them */
export const RANGE_IMPORT_FIELDS = ['rangeFrom', 'rangeTo'] as const

/** The id of the control that takes focus for each of its fields */
export const RANGE_IMPORT_FIELD_IDS = {
  rangeFrom: 'bank-range-import-from',
  rangeTo: 'bank-range-import-to',
} as const

/**
 * What a linked account's reminder says while its import waits for the user's other accounts to be
 * linked and join it. The server holds the import back for 2 minutes after the latest link, and the
 * reminder shows in the account's Bank link section while it waits
 *
 * @param providerName - The connection's provider, whose daily request limit the joined import saves
 */
export function importStartReminder(providerName: string): string {
  return `Syncing starts shortly. Link your other accounts now, and they'll import together using fewer of ${providerName}'s daily requests.`
}

export const BANK_ACCOUNT_REQUIRED_MESSAGE = 'Choose a bank account'
export const START_CHOICE_REQUIRED_MESSAGE = 'Choose where to start'
export const START_DATE_REQUIRED_MESSAGE = 'Enter a start date'
export const START_DATE_OUT_OF_RANGE_MESSAGE = 'Outside the allowed range.'
export const RANGE_END_REQUIRED_MESSAGE = 'Enter an end date'
export const RANGE_CROSSED_MESSAGE = 'Must be on or before the end date'

/**
 * What bringing back dismissed items risks, said as soon as the option is ticked
 */
export const RESTORE_DISMISSED_WARNING =
  "This may change the account's balance in ways that are hard to predict if it was brought up to date with a balance adjustment. Reconcile carefully afterwards."

/**
 * What linking for a date range ending before today means for the days after it
 *
 * @param lastDay - The range's last day, as a label
 */
export function rangeEndsBeforeTodayNote(lastDay: string): string {
  return `Syncing picks up from today. The days after ${lastDay} stay as you entered them.`
}
