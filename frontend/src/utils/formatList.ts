import { DATE_LOCALE } from '@/utils/date'

// In the product's locale rather than the browser's, so a list reads in the language around it
const CONJUNCTION_FORMAT = new Intl.ListFormat(DATE_LOCALE, { style: 'long', type: 'conjunction' })
const UNIT_FORMAT = new Intl.ListFormat(DATE_LOCALE, { style: 'short', type: 'unit' })

/**
 * Joins items into a list the way a sentence does, such as "A", "A and B" or "A, B and C", with the
 * separators and the word before the last item taken from the product's locale
 *
 * @param items - The items in the order they read
 */
export function formatList(items: readonly string[]): string {
  return CONJUNCTION_FORMAT.format(items)
}

/**
 * Joins values that sit in a cell or beside a label rather than in a sentence, such as tags, sample
 * values or currency codes, with no word before the last one
 *
 * @param items - The values in the order they read
 */
export function formatValueList(items: readonly string[]): string {
  return UNIT_FORMAT.format(items)
}
