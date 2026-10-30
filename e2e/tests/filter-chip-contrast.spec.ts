import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { colourContrast, faintestText } from '../support/contrast'
import { openFilters, selectFacet } from '../support/filters'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the desktop panel and the phone sheet draw the chip on different surfaces

/**
 * Guards the contrast of the selected-filter chips under the Filters panel's fields, at rest and under the
 * pointer. The chip's bronze text sat under 4.5:1 on its tint over the desktop panel's surface in the light
 * theme, and its remove icon was faded under it in both
 */

const LISTS = [
  { domain: 'Account', path: '/accounts', facet: 'Type', option: /./ },
  { domain: 'Transaction', path: '/transactions', facet: 'Accounts', option: 'Everyday' },
] as const

async function openPanelWithOneChip(page: Page,request: APIRequestContext, list: (typeof LISTS)[number]) {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, list.path)

  const panel = await openFilters(page, list.domain)
  await selectFacet(page, panel, list.facet)
  await panel.getByRole('checkbox', { name: list.option }).first().click()
  return panel.getByRole('group', { name: 'Selected filters', exact: true })
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const list of LISTS) {
    test(`draws a ${list.domain.toLowerCase()} filter chip and its remove icon at 4.5:1 in the ${colorScheme} theme`, AT_EVERY_SIZE, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      const chips = await openPanelWithOneChip(page, request, list)
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
      const remove = chips.getByRole('button')
      await expect(remove).toHaveCount(1)

      // The chip springs in with a script-driven fade the contrast reader doesn't wait for
      await expect.poll(() => remove.evaluate((button) => getComputedStyle(button.parentElement!).opacity)).toBe('1')

      const text = await faintestText(chips)
      expect(text.text, 'finds the chip text').toMatch(/\S/)
      expect.soft(text.contrast, `"${text.text}" on its chip`).toBeGreaterThanOrEqual(4.5)
      expect.soft(await colourContrast(remove), 'the remove icon').toBeGreaterThanOrEqual(4.5)

      await remove.hover()
      expect.soft(await colourContrast(remove), 'the remove icon under the pointer').toBeGreaterThanOrEqual(4.5)

      // Pressing the cross still removes the chip
      await remove.click()
      await expect(remove).toHaveCount(0)
    })
  }
}
