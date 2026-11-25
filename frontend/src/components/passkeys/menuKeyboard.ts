/**
 * Picks the item an overflow menu key moves focus to, or null for a key the menu leaves alone
 *
 * `activeIndex` is -1 while focus is on the trigger, so Down enters at the first item and Up at the last.
 * Up and Down wrap round the ends, as a menu does in every other app
 */
export function getMenuItemTarget(key: string, activeIndex: number, count: number): number | null {
  if (count === 0) return null

  switch (key) {
    case 'ArrowDown':
      return (activeIndex + 1) % count
    case 'ArrowUp':
      return activeIndex <= 0 ? count - 1 : activeIndex - 1
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
