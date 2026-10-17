import { expect, test, type Page } from '@playwright/test'

import { signUpUser, TEST_TIMEZONE } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { BASE_URL } from '../support/target'

// Runs on desktop only: what travels between the two sessions is the same at every size

const RANGE_NAME = 'Alpha range'

// The page carries two copies of the range panel, one for a wide layout and one in the floating
// pill, so each lookup keeps only the copy that is showing
function nameField(page: Page) {
  return page.getByLabel('Saved range name').filter({ visible: true })
}

function savedRange(page: Page) {
  return page.getByRole('button', { name: new RegExp(`^${RANGE_NAME}`) }).filter({ visible: true })
}

/** Open the Insights date range pill on its Custom tab, where the saved ranges are listed */
async function openSavedRanges(page: Page) {
  await openPage(page, '/insights')
  await page.getByRole('button', { name: /^Insights date range: /, includeHidden: true }).first().click()
  await page.getByRole('tab', { name: 'Custom', exact: true }).click()
  await expect(nameField(page)).toBeVisible()
}

/** Make the page run the app's cache check, as returning to its window does */
async function runCacheCheck(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

test('shows a saved range, and its deletion, in another signed-in session', async ({ page, browser, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  const otherContext = await browser.newContext({ baseURL: BASE_URL, viewport: page.viewportSize(), locale: 'en-CA', timezoneId: TEST_TIMEZONE })
  try {
    const otherPage = await otherContext.newPage()
    await logInViaApi(otherPage, user)
    await openSavedRanges(page)
    await openSavedRanges(otherPage)
    await expect(savedRange(otherPage)).toHaveCount(0)

    await nameField(page).fill(RANGE_NAME)
    await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).click()
    await expect(savedRange(page)).toHaveCount(1)
    await expect.poll(async () => {
      await runCacheCheck(otherPage)
      return savedRange(otherPage).count()
    }).toBe(1)

    // Saving applies the range and closes the panel, so it is opened again to reach the delete button
    await page.getByRole('button', { name: `Insights date range: ${RANGE_NAME}`, includeHidden: true }).first().click()
    await page.getByRole('tab', { name: 'Custom', exact: true }).click()
    await page.getByRole('button', { name: `Delete ${RANGE_NAME}` }).filter({ visible: true }).click()
    await expect(savedRange(page)).toHaveCount(0)
    await expect.poll(async () => {
      await runCacheCheck(otherPage)
      return savedRange(otherPage).count()
    }).toBe(0)
  } finally {
    await otherContext.close()
  }
})
