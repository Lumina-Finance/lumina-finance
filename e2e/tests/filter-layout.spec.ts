import { expect, test, type Locator, type Page } from '@playwright/test'
import { createAccount, signUpUser, TEST_CURRENCY } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { API_BASE_URL } from '../support/target'

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
async function openFilters(page: Page, domain: 'Account' | 'Transaction') {
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
async function selectFacet(page: Page, panel: Locator, name: string) {
  if (page.viewportSize()!.width < 750) {
    await panel.getByRole('combobox', { name: 'Filters', exact: true }).click()
    await panel.getByRole('option', { name, exact: true }).click()
  } else await panel.getByRole('tab', { name, exact: true }).click()
}

/** Checks that every chip fits its natural rows without a separate scrolling region */
async function expectChipGeometry(panel: Locator, count: number) {
  const chips = panel.getByRole('group', { name: 'Selected filters', exact: true })
  await expect(chips.getByRole('button')).toHaveCount(count)
  await expect.poll(() => chips.evaluate((element) => {
    return { overflow: getComputedStyle(element).overflowY, fits: element.scrollHeight <= element.clientHeight + 1 }
  })).toEqual({ overflow: 'visible', fits: true })
}

test('keeps long account and transaction selections reachable without crowding options', async ({ page, request }) => {
  const user = await signUpUser(request)
  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const fixtureId = crypto.randomUUID()
  const names = Array.from({ length: 12 }, (_, index) => `Filter layout ${String(index).padStart(2, '0')} with a deliberately long complete financial institution name ${fixtureId}`)
  for (const name of names) {
    const institution = await request.post(`${API_BASE_URL}/institutions`, {
      headers, data: { name, country_code: 'CA', website: 'https://example.com' },
    })
    expect(institution.status()).toBe(201)
    const { id } = await institution.json() as { id: string }
    const account = await createAccount(request, user, { name })
    const linked = await request.patch(`${API_BASE_URL}/accounts/${account.id}`, { headers, data: { institution_id: id } })
    expect(linked.status()).toBe(200)
  }
  await logIn(page, user)
  await expectSignedIn(page)

  for (const domain of ['Account', 'Transaction'] as const) {
    await page.goto(domain === 'Account' ? '/accounts' : '/transactions')
    let panel = await openFilters(page, domain)
    await expect(panel.getByRole('group', { name: 'Selected filters', exact: true })).toHaveCount(0)
    await expect(panel.getByText('No filters applied', { exact: true })).toBeVisible()
    await expect(panel.getByText(`${domain}s must match every filter you apply`, { exact: true })).toBeVisible()
    const originalScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    const originalPanelHeight = await panel.evaluate((element) => element.getBoundingClientRect().height)
    const originalPadding = page.viewportSize()!.width >= 750
      ? await panel.evaluate((element) => parseFloat(getComputedStyle(element.lastElementChild!.firstElementChild!.firstElementChild!).paddingTop))
      : 0
    for (let index = 0; index < names.length; index++) {
      await panel.getByRole('checkbox', { name: names[index], exact: true }).click()
      if (index === 0) await expectChipGeometry(panel, 1)
    }
    await expectChipGeometry(panel, 12)
    if (page.viewportSize()!.width >= 750) {
      await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(originalPanelHeight + 1)
    }
    const search = panel.getByPlaceholder(domain === 'Account' ? 'Search institution' : 'Search accounts', { exact: true })
    await expect(search).toBeVisible()
    const optionList = panel.getByRole('checkbox', { name: names[0], exact: true }).locator('..').locator('..')
    await expect.poll(() => optionList.evaluate((element) => element.clientHeight)).toBeGreaterThan(32)

    const removeButtons = panel.getByRole('group', { name: 'Selected filters', exact: true }).getByRole('button')
    await removeButtons.first().focus()
    for (let index = 1; index < names.length; index++) await page.keyboard.press('Tab')
    await expect(removeButtons.last()).toBeFocused()
    await expect(removeButtons.last()).toHaveAccessibleName(`Remove ${names[11]}`)
    await page.keyboard.press('Enter')
    await expect(removeButtons).toHaveCount(11)
    await expect(panel.getByRole('checkbox', { name: names[11], exact: true })).not.toBeChecked()
    await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
    panel = await openFilters(page, domain)
    await expect(panel.getByRole('group', { name: 'Selected filters', exact: true }).getByRole('button')).toHaveCount(11)
    await panel.getByRole('checkbox', { name: names[11], exact: true }).click()
    if (page.viewportSize()!.width < 750) await panel.getByRole('button', { name: 'Close filters', exact: true }).click()
    else await page.keyboard.press('Escape')
    panel = await openFilters(page, domain)
    await expect(panel.getByRole('group', { name: 'Selected filters', exact: true }).getByRole('button')).toHaveCount(11)

    const original = page.viewportSize()!
    await page.setViewportSize({ width: original.width, height: 320 })
    if (original.width >= 750) {
      // A drastic resize can leave the toolbar below the viewport. Existing placement follows that
      // anchor, so bring the whole collapsed footprint into view, including the glass borders
      const head = panel.getByRole('button', { name: `${domain} filters`, exact: true })
      await panel.locator('..').scrollIntoViewIfNeeded()
      await expect.poll(() => head.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight, inside: rect.top >= -1 && rect.bottom <= window.innerHeight + 1 }
      })).toMatchObject({ inside: true })
    }
    await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeEnabled()
    await expect.poll(() => panel.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: rect.height, viewportHeight: window.innerHeight, inside: rect.top >= -1 && rect.bottom <= window.innerHeight + 1 }
    })).toMatchObject({ inside: true })
    await expectChipGeometry(panel, 11)
    const shortOption = panel.getByRole('checkbox', { name: names[0], exact: true })
    const shortList = shortOption.locator('..').locator('..')
    await expect.poll(() => shortList.evaluate((element) => {
      const row = element.querySelector('button')
      return !!row && element.clientHeight >= row.getBoundingClientRect().height
    })).toBe(true)
    await shortOption.scrollIntoViewIfNeeded()
    await expect.poll(() => shortOption.evaluate((element) => {
      const row = element.getBoundingClientRect()
      const list = element.parentElement!.parentElement!.getBoundingClientRect()
      return row.top >= Math.max(0, list.top) - 1 && row.bottom <= Math.min(window.innerHeight, list.bottom) + 1
    })).toBe(true)
    await expect(shortOption).toBeChecked()
    await shortOption.click()
    await expect(shortOption).not.toBeChecked()
    await expect(panel.getByRole('group', { name: 'Selected filters', exact: true }).getByRole('button')).toHaveCount(10)
    await panel.getByRole('button', { name: 'Clear all', exact: true }).click()
    await page.setViewportSize(original)
    // Compare like-for-like space around the anchor, not the scroll position left by the short window
    await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y, behavior: 'instant' }), originalScroll)
    await expect.poll(() => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(originalScroll)
    panel = await openFilters(page, domain)
    await expect(panel.getByRole('group', { name: 'Selected filters', exact: true })).toHaveCount(0)
    if (original.width >= 750) {
      // Resizing and scrolling can reopen upward, which adds the existing top padding
      await expect.poll(async () => {
        const restored = await panel.evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          padding: parseFloat(getComputedStyle(element.lastElementChild!.firstElementChild!.firstElementChild!).paddingTop),
        }))
        return Math.abs(restored.height - originalPanelHeight - (restored.padding - originalPadding))
      }).toBeLessThanOrEqual(2)
    }
    await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  }
})

test('retains Tags explanations and invalid amount and date blocking', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Validation account' })
  await logIn(page, user)
  await expectSignedIn(page)
  await page.goto('/transactions')
  const panel = await openFilters(page, 'Transaction')
  await selectFacet(page, panel, 'Tags')
  await expect(panel.getByText('Match transactions with all selected tags', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Any', exact: true }).click()
  await expect(panel.getByText('Match transactions with any selected tag', { exact: true })).toBeVisible()
  await selectFacet(page, panel, 'Amount')
  await panel.getByRole('button', { name: TEST_CURRENCY, exact: true }).click()
  await panel.getByRole('textbox', { name: /^Min(?:\s|$)/ }).fill('20')
  await panel.getByRole('textbox', { name: /^Max(?:\s|$)/ }).fill('10')
  await expect(panel.getByText('Enter a minimum at or below the maximum', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeDisabled()
  await panel.getByRole('textbox', { name: /^Max(?:\s|$)/ }).fill('30')
  await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeEnabled()
  await selectFacet(page, panel, 'Date')
  for (const [label, day] of [['From', '20'], ['To', '10']] as const) {
    const date = panel.getByRole('group', { name: label, exact: true })
    await date.getByRole('textbox', { name: 'Year', exact: true }).fill('2024')
    await date.getByRole('textbox', { name: 'Month', exact: true }).fill('03')
    await date.getByRole('textbox', { name: 'Day', exact: true }).fill(day)
  }
  await expect(panel.getByText('The From date must be on or before the To date', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeDisabled()
})
