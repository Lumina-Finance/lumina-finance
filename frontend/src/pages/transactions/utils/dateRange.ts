/**
 * Reports whether the date filter's bounds exclude each other, which no transaction can satisfy
 *
 * Each field holds a complete ISO yyyy-mm-dd date or nothing at all, so the two compare as plain
 * strings. A bound left blank, or still being typed, cannot cross the other
 *
 * @param dateRange - The from and to dates as the fields hold them
 */
export function isDateRangeCrossed({ from, to }: { from: string; to: string }): boolean {
  return from !== '' && to !== '' && from > to
}
