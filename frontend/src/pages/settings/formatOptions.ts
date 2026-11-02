import type { DropdownOption } from '@/components/dropdown/types'
import { DATE_FORMATS, formatDate } from '@/utils/date'
import { ACTION_KEY_CHOICES, type ActionKeySetting } from '@/utils/actionKey'
import { DATE_FORMAT_CHOICES, formatWithDateFormat, type DateFormatSetting } from '@/utils/dateFormat'

// A day whose number cannot be mistaken for a month, so every example reads as one format only.
// Built on the local calendar like every date the product writes without a zone
const SAMPLE_DATE = new Date(2026, 8, 24)

const DATE_FORMAT_DESCRIPTIONS: Record<DateFormatSetting, string> = {
  'month-day-year': 'Month, day, year',
  'day-month-year': 'Day, month, year',
  iso: 'Year, month, day (ISO 8601)',
}

/**
 * Builds the date format dropdown, each option shown by the sample date written in that format
 */
export function buildDateFormatOptions(): DropdownOption[] {
  return DATE_FORMAT_CHOICES.map((value) => ({
    value,
    label: formatWithDateFormat(value, () => formatDate(SAMPLE_DATE, DATE_FORMATS.monthDayYear)),
    description: DATE_FORMAT_DESCRIPTIONS[value],
  }))
}

/**
 * Builds the action key dropdown, naming the key the way the keyboard prints it: Option on a Mac, Alt elsewhere
 */
export function buildActionKeyOptions(isMac: boolean): DropdownOption[] {
  const name = isMac ? 'Option' : 'Alt'
  const labels: Record<ActionKeySetting, { label: string; description: string }> = {
    alt: { label: name, description: 'Either side works.' },
    'left-alt': { label: `Left ${name}`, description: 'The right side stays free to type symbols.' },
  }

  return ACTION_KEY_CHOICES.map((value) => ({ value, ...labels[value] }))
}
