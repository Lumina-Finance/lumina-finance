/**
 * The ways a user can have dates written. Dates sent to and from the server are ISO whatever the
 * setting, which only decides how the app writes them on screen
 */
export const DATE_FORMAT_CHOICES = ['month-day-year', 'day-month-year', 'iso'] as const

export type DateFormatSetting = (typeof DATE_FORMAT_CHOICES)[number]

// What a new account starts on, and what every page uses while nobody is signed in. It is also how
// dates were written before the setting existed
export const DEFAULT_DATE_FORMAT: DateFormatSetting = 'month-day-year'

let currentDateFormat: DateFormatSetting = DEFAULT_DATE_FORMAT

/**
 * The setting every shared date formatter uses, including those called from utility modules outside
 * any component. DateFormatProvider keeps it in step with the signed-in user's profile
 */
export function readDateFormat(): DateFormatSetting {
  return currentDateFormat
}

/** Replaces the setting every shared date formatter uses. Only DateFormatProvider and tests call this */
export function setDateFormat(setting: DateFormatSetting) {
  currentDateFormat = setting
}

/**
 * Runs the shared date formatters under another setting and puts the current one back, so a setting
 * can show what it would look like before it is saved. Formatting is synchronous, so nothing else
 * runs while the other setting is in place
 */
export function formatWithDateFormat<T>(setting: DateFormatSetting, format: () => T): T {
  const previous = currentDateFormat
  currentDateFormat = setting
  try {
    return format()
  } finally {
    currentDateFormat = previous
  }
}
