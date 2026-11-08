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
export const LINK_FLOW_FIELDS = ['bankAccount', 'startChoice', 'startDate'] as const

/** The id of the control that takes focus for each field, and of the message that describes it */
export const LINK_FLOW_FIELD_IDS = {
  bankAccount: 'bank-link-bank-account',
  startChoice: 'bank-link-start-choice',
  startDate: 'bank-link-start-date',
  bankAccountError: 'bank-link-bank-account-error',
  startChoiceError: 'bank-link-start-choice-error',
  startDateError: 'bank-link-start-date-error',
} as const

export const BANK_ACCOUNT_REQUIRED_MESSAGE = 'Choose a bank account'
export const START_CHOICE_REQUIRED_MESSAGE = 'Choose where to start'
export const START_DATE_REQUIRED_MESSAGE = 'Enter a start date'
export const START_DATE_OUT_OF_RANGE_MESSAGE = 'Outside the allowed range.'
