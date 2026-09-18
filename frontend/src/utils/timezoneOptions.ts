/** Keep a valid current timezone selectable even when the browser inventory omits it */
export function buildTimezoneOptions(listedTimezones: readonly string[], currentTimezone: string) {
  const values = new Set(listedTimezones)
  if (currentTimezone && !values.has(currentTimezone)) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: currentTimezone })
      values.add(currentTimezone)
    } catch {
      // Invalid stored values must not become selectable timezone options
    }
  }
  return Array.from(values, (value) => ({ value, label: value.replace(/_/g, ' ') }))
}
