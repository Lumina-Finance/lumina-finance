import { expect, type Locator, type Page } from '@playwright/test'

/** Establishes the compact tablet sidebar through its real control before measuring filter layout */
async function compactTabletSidebar(page: Page, filterTrigger: Locator) {
  if (page.viewportSize()!.width !== 1194) return

  // The expanded sidebar overlaps the existing right-anchored filter at this width, so these
  // panel-space checks use the compact rail and leave expanded-sidebar placement to its own coverage
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
  await expect(navigation).toBeVisible()
  const collapse = navigation.getByRole('button', { name: 'Collapse sidebar', exact: true })
  if (await collapse.isVisible()) await collapse.click()
  await expect(navigation.getByRole('button', { name: 'Keep sidebar expanded', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await filterTrigger.focus()
  await page.mouse.move(page.viewportSize()!.width - 10, 10)
  await expect(navigation).toHaveClass(/app-desktop-nav-collapsed/)
  await expect.poll(() => navigation.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(74)
}

/** Opens the actual desktop panel or mobile sheet and waits for its footer to become usable */
export async function openFilters(page: Page, domain: 'Account' | 'Transaction') {
  const mobile = page.viewportSize()!.width < 750
  const trigger = page.getByRole('button', { name: mobile ? /^Filters/ : `${domain} filters`, exact: !mobile })
  await compactTabletSidebar(page, trigger)
  await trigger.click()
  const panel = mobile
    ? page.getByRole('dialog', { name: `${domain} filters`, exact: true })
    : page.locator('.app-range-glass').filter({ has: page.getByRole('button', { name: `${domain} filters`, exact: true }) })
  await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeVisible()
  if (!mobile) {
    // Footer visibility can precede the end of the opening animation
    await expect.poll(() => panel.evaluate((element) => {
      const animatedBody = element.lastElementChild!
      const viewport = animatedBody.firstElementChild!
      return Math.abs(animatedBody.getBoundingClientRect().height - viewport.clientHeight) < 1
    })).toBe(true)
  }
  return panel
}

/** Chooses a facet through the responsive tabs or labeled dropdown */
export async function selectFacet(page: Page, panel: Locator, name: string) {
  if (page.viewportSize()!.width < 750) {
    await panel.getByRole('combobox', { name: 'Filters', exact: true }).click()
    await panel.getByRole('option', { name, exact: true }).click()
  } else await panel.getByRole('tab', { name, exact: true }).click()
}
