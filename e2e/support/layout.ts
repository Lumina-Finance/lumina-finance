import type { Locator } from '@playwright/test'

/**
 * For a table meant to scroll sideways inside the box right around it: whether that box holds more than
 * it shows, and every box past it, up to the page, that scrolls sideways too
 */
export function measureOwnScroll(table: Locator) {
  return table.evaluate((node) => {
    const own = node.parentElement!
    const outside: string[] = []
    for (let box = own.parentElement; box; box = box.parentElement) {
      if (box.scrollWidth > box.clientWidth + 1 && getComputedStyle(box).overflowX !== 'visible') {
        outside.push(`${box.tagName.toLowerCase()} by ${box.scrollWidth - box.clientWidth}px`)
      }
    }
    const page = document.documentElement
    if (page.scrollWidth > page.clientWidth + 1) outside.push(`page by ${page.scrollWidth - page.clientWidth}px`)
    return { scrolls: own.scrollWidth > own.clientWidth + 1, outside }
  })
}

/**
 * Sideways scrolling anywhere from an element up to the page, and any control inside it reaching past
 * what a clipping box around it, or the window, shows of it
 */
export function measureFit(area: Locator) {
  return area.evaluate((node) => {
    const scrolling: string[] = []
    for (let box: Element | null = node; box; box = box.parentElement) {
      if (box.scrollWidth > box.clientWidth + 1 && getComputedStyle(box).overflowX !== 'visible') {
        scrolling.push(`${box.tagName.toLowerCase()} by ${box.scrollWidth - box.clientWidth}px`)
      }
    }
    const page = document.documentElement
    if (page.scrollWidth > page.clientWidth + 1) scrolling.push(`page by ${page.scrollWidth - page.clientWidth}px`)
    const clipped = [...node.querySelectorAll('[role="combobox"], [role="radiogroup"], input, button')]
      .filter((control) => {
        const rect = control.getBoundingClientRect()
        for (let box = control.parentElement; box; box = box.parentElement) {
          if (getComputedStyle(box).overflowX === 'visible') continue
          const bounds = box.getBoundingClientRect()
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) return true
        }
        return rect.left < -1 || rect.right > page.clientWidth + 1
      })
      .map((control) => control.getAttribute('aria-label') ?? control.textContent?.trim())
    return { scrolling, clipped }
  })
}
