import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { asUser, createAccount, signUpUser, TEST_CURRENCY } from '../support/api'
import { openPage, logInViaApi } from '../support/app'
import { openFilters, selectFacet } from '../support/filters'
import { API_BASE_URL } from '../support/target'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: filters show as a panel, a compact rail or a sheet depending on the width

/** Checks that every chip fits its natural rows without a separate scrolling region */
async function expectChipGeometry(panel: Locator, count: number) {
  const chips = panel.getByRole('group', { name: 'Selected filters', exact: true })
  await expect(chips.getByRole('button')).toHaveCount(count)
  await expect.poll(() => chips.evaluate((element) => {
    return { overflow: getComputedStyle(element).overflowY, fits: element.scrollHeight <= element.clientHeight + 1 }
  })).toEqual({ overflow: 'visible', fits: true })
}

/** Creates an isolated populated panel for each independent layout scenario */
async function seedFilterPanel(page: Page, request: APIRequestContext, domain: 'Account' | 'Transaction') {
  const user = await signUpUser(request)
  const headers = asUser(user)
  const fixtureId = crypto.randomUUID()
  const names = Array.from({ length: 12 }, (_, index) => `Filter layout ${String(index).padStart(2, '0')} with a deliberately long complete financial institution name ${fixtureId}`)
  for (const name of names) {
    const institution = await request.post(`${API_BASE_URL}/institutions`, {
      headers, data: { name, country_code: 'CA', website: 'https://example.com' },
    })
    expect(institution.status()).toBe(201)
    const { id } = await institution.json() as { id: string }
    await createAccount(request, user, { name, institutionId: id })
  }
  await logInViaApi(page, user)

  await openPage(page, domain === 'Account' ? '/accounts' : '/transactions')
  const panel = await openFilters(page, domain)
  await expect(panel.getByRole('group', { name: 'Selected filters', exact: true })).toHaveCount(0)
  await expect(panel.getByText('No filters applied', { exact: true })).toBeVisible()
  await expect(panel.getByText(`${domain}s must match every filter you apply`, { exact: true })).toBeVisible()

  // Compare populated layouts, since reference data can arrive after the panel opens
  for (const name of names) await expect(panel.getByRole('checkbox', { name, exact: true })).toBeAttached()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return { names, panel }
}

for (const domain of ['Account', 'Transaction'] as const) {
  test(`wraps long ${domain.toLowerCase()} selections and restores the empty panel height`, AT_EVERY_SIZE, async ({ page, request }) => {
    const { names, panel } = await seedFilterPanel(page, request, domain)
    if (page.viewportSize()!.width >= 750) {
      await expect.poll(() => panel.evaluate((element) => {
        const body = element.lastElementChild!
        const viewport = body.firstElementChild!
        const content = viewport.firstElementChild! as HTMLElement
        return Math.abs(body.getBoundingClientRect().height - content.offsetHeight) < 1
          && viewport.clientHeight === content.offsetHeight
      })).toBe(true)
    }
    const originalPanelHeight = await panel.evaluate((element) => element.getBoundingClientRect().height)
    const originalScrollY = await page.evaluate(() => window.scrollY)
    const originalPadding = page.viewportSize()!.width >= 750
      ? await panel.evaluate((element) => parseFloat(getComputedStyle(element.lastElementChild!.firstElementChild!.firstElementChild!).paddingTop))
      : 0
    for (let index = 0; index < names.length; index++) {
      const option = panel.getByRole('checkbox', { name: names[index], exact: true })
      // Exercise pointer selection once, then use the keyboard while the growing pane moves
      if (index === 0) await option.click()
      else await option.press('Space')
      if (index === 0) await expectChipGeometry(panel, 1)
    }
    await expectChipGeometry(panel, 12)
    if (page.viewportSize()!.width >= 750) {
      // Reaching clipped options can scroll the document and change the panel's available space
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), originalScrollY)
      await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(originalPanelHeight + 1)
    }
    // Measure shrinkage in the same open cycle before resizing or closing adds layout changes
    for (let index = 0; index < names.length; index++) {
      const remove = panel.getByRole('button', { name: `Remove ${names[index]}`, exact: true })
      if (index === 0) await remove.click()
      else await remove.press('Enter')
    }
    await expect(panel.getByRole('group', { name: 'Selected filters', exact: true })).toHaveCount(0)
    await expect(panel.getByText('No filters applied', { exact: true })).toBeVisible()
    if (page.viewportSize()!.width >= 750) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), originalScrollY)
      // Opening upward adds the existing top padding, independently of the chip rows
      await expect.poll(async () => {
        const restored = await panel.evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          padding: parseFloat(getComputedStyle(element.lastElementChild!.firstElementChild!.firstElementChild!).paddingTop),
        }))
        return Math.abs(restored.height - originalPanelHeight - (restored.padding - originalPadding))
      }).toBeLessThanOrEqual(2)
    }
  })

  test(`keeps long ${domain.toLowerCase()} selections reachable by keyboard and in a short viewport`, AT_EVERY_SIZE, async ({ page, request }) => {
    const seeded = await seedFilterPanel(page, request, domain)
    const { names } = seeded
    let { panel } = seeded
    for (const name of names) await panel.getByRole('checkbox', { name, exact: true }).press('Space')
    await expectChipGeometry(panel, 12)
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
    // The phone's sheet holds Apply off while nothing in it differs from the applied filters
    if (original.width < 750) await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeDisabled()
    else await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeEnabled()
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
    if (original.width >= 750) {
      await panel.getByRole('button', { name: 'Clear all', exact: true }).scrollIntoViewIfNeeded()
      await expect.poll(() => panel.evaluate((element) => element.lastElementChild!.firstElementChild!.scrollTop)).toBeGreaterThan(0)
      await page.keyboard.press('Escape')
      panel = await openFilters(page, domain)
      await expect.poll(() => panel.evaluate((element) => element.lastElementChild!.firstElementChild!.scrollTop)).toBe(0)
    }
    await panel.getByRole('button', { name: 'Clear all', exact: true }).click()
    await page.setViewportSize(original)
    panel = await openFilters(page, domain)
    await expect(panel.getByRole('group', { name: 'Selected filters', exact: true })).toHaveCount(0)
    if (original.width < 750) await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeDisabled()
    else await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  })
}

test('retains Tags explanations and invalid amount and date blocking', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Validation account' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const panel = await openFilters(page, 'Transaction')
  await selectFacet(page, panel, 'Tags')
  await expect(panel.getByText('Match transactions with all selected tags', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Any', exact: true }).click()
  await expect(panel.getByText('Match transactions with any selected tag', { exact: true })).toBeVisible()
  await selectFacet(page, panel, 'Amount')
  await panel.getByRole('button', { name: TEST_CURRENCY, exact: true }).click()
  await panel.getByRole('textbox', { name: /^Min(?:\s|$)/ }).fill('20')
  await panel.getByRole('textbox', { name: /^Max(?:\s|$)/ }).fill('10')
  const apply = panel.getByRole('button', { name: 'Apply filters', exact: true })
  // The line under the fields is found through the id the field points to, since Apply carries the same
  // words in a description of its own that a text search would find as well
  const crossedAmount = 'Enter a minimum at or below the maximum'
  await expect(panel.getByRole('textbox', { name: /^Max(?:\s|$)/ })).toHaveAttribute('aria-describedby', /.+/)
  const amountMessageId = await panel.getByRole('textbox', { name: /^Max(?:\s|$)/ }).getAttribute('aria-describedby')
  const amountMessage = panel.locator(`[id="${amountMessageId}"]`)
  await expect(amountMessage).toBeVisible()
  await expect(amountMessage).toHaveText(crossedAmount)
  await expect(apply).toBeDisabled()
  await expect(apply).toHaveAccessibleDescription(crossedAmount)
  await panel.getByRole('textbox', { name: /^Max(?:\s|$)/ }).fill('30')
  await expect(apply).toBeEnabled()
  await expect(apply).not.toHaveAttribute('aria-describedby', /.+/)
  await selectFacet(page, panel, 'Date')
  for (const [label, day] of [['From', '20'], ['To', '10']] as const) {
    const date = panel.getByRole('group', { name: label, exact: true })
    await date.getByRole('textbox', { name: 'Year', exact: true }).fill('2024')
    await date.getByRole('textbox', { name: 'Month', exact: true }).fill('03')
    await date.getByRole('textbox', { name: 'Day', exact: true }).fill(day)
  }
  const crossedDates = "From can't be after To"
  const fromYear = panel.getByRole('group', { name: 'From', exact: true }).getByRole('textbox', { name: 'Year', exact: true })
  await expect(fromYear).toHaveAttribute('aria-describedby', /.+/)
  const dateMessageId = await fromYear.getAttribute('aria-describedby')
  const dateMessage = panel.locator(`[id="${dateMessageId}"]`)
  await expect(dateMessage).toBeVisible()
  await expect(dateMessage).toHaveText(crossedDates)
  // As in the importer, only From takes the error and the message sits on its label row
  await expect(fromYear).toHaveAttribute('aria-invalid', 'true')
  await expect(panel.getByRole('group', { name: 'To', exact: true }).getByRole('textbox', { name: 'Year', exact: true })).not.toHaveAttribute('aria-invalid', 'true')
  await expect(dateMessage.locator('..')).toContainText('From')

  // Side by side, the message on From's label row leaves the labels and the fields level, and fits one line
  if (page.viewportSize()!.width >= 750) {
    const top = async (locator: Locator) => (await locator.boundingBox())!.y
    const fromGroup = panel.getByRole('group', { name: 'From', exact: true })
    const toGroup = panel.getByRole('group', { name: 'To', exact: true })
    expect(await top(fromGroup)).toBe(await top(toGroup))
    expect((await dateMessage.boundingBox())!.height).toBeLessThan(24)
    const labelTop = async (label: string) => (await panel.getByText(label, { exact: true }).first().boundingBox())!.y
    expect(await labelTop('From')).toBe(await labelTop('To'))
  }
  await expect(apply).toBeDisabled()
  await expect(apply).toHaveAccessibleDescription(crossedDates)

  // Under another facet the date editor is out of sight, so the reason takes the line above the footer
  const footerLine = panel.locator('p:not([id])').filter({ hasText: crossedDates })
  await expect(footerLine).toHaveCount(0)
  await selectFacet(page, panel, 'Tags')
  await expect(footerLine).toBeVisible()
})

test('holds Apply off with its reason on a phone until a filter changes', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Nothing to apply account' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const panel = await openFilters(page, 'Transaction')
  const apply = panel.getByRole('button', { name: 'Apply filters', exact: true })

  // Only the phone's sheet closes on an Apply that changes nothing, so only it explains and holds it off
  if (page.viewportSize()!.width >= 750) {
    await expect(apply).toBeEnabled()
    return
  }
  await expect(apply).toBeDisabled()
  await expect(apply).toHaveAccessibleDescription('Nothing to apply')

  // A held-off Apply does nothing when clicked or entered, so the sheet stays open
  await apply.click({ force: true })
  await apply.focus()
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  await expect(apply).toBeDisabled()
  await selectFacet(page, panel, 'Accounts')
  await panel.getByRole('checkbox', { name: 'Nothing to apply account', exact: true }).click()
  await expect(apply).toBeEnabled()
  await panel.getByRole('checkbox', { name: 'Nothing to apply account', exact: true }).click()
  await expect(apply).toBeDisabled()
})
