import type { DropdownOption } from '@/components/dropdown/types'
import { DATE_FORMATS, formatDate } from '@/utils/date'
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
