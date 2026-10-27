/**
 * Guards the passkey detail line in the Multi-factor authentication dialog, which once cut off when
 * a passkey was last used with an ellipsis at phone width, and which once left its "·" separator dangling
 * at the end of the first line when it wrapped
 */
import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: it sets every width it checks itself with page.setViewportSize

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const LONG_NAME = 'My very long passkey name that goes on and on and on and on past the end of any row'

test('wraps the passkey detail line on a phone instead of cutting it off', async ({ page, request }) => {
  const user = await signUpUser(request)
  const now = Date.now()
  const passkey = (name: string, lastUsedMsAgo: number | null) => ({
    id: name,
    name,
    created_at: new Date(now - 9 * DAY_MS).toISOString(),
    last_used_at: lastUsedMsAgo === null ? null : new Date(now - lastUsedMsAgo).toISOString(),
  })
  await page.route(`${API_BASE_URL}/auth/passkeys`, (route) => route.fulfill({
    json: [
      passkey('Phone', 3 * HOUR_MS),
      passkey('Tablet', 10 * MINUTE_MS),
      passkey('Security key', null),
      passkey(LONG_NAME, 3 * HOUR_MS),
    ],
  }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await logInViaApi(page, user)

  const dialog = page.getByRole('dialog', { name: 'Multi-factor authentication' })
  // The detail line is the paragraph under each name, found from the text it holds
  const detailLine = (text: string) => dialog.locator('p', { hasText: text }).first()
  const isCutOff = (text: string) => detailLine(text).evaluate((element) => element.scrollWidth > element.clientWidth)
  const lineCount = (text: string) => detailLine(text).evaluate((element) => {
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight)
    return Math.round(element.getBoundingClientRect().height / lineHeight)
  })
  // The dot is drawn in the gap before the last used words. It shows only when those words sit beside the date,
  // since on a wrapped line the words start at the left edge and push the dot out past it, where the line clips it
  const separator = (text: string) => detailLine(text).evaluate((element) => {
    const [date, lastUsed] = Array.from(element.children)
    return {
      wrapped: lastUsed.getBoundingClientRect().top > date.getBoundingClientRect().top,
      dotInView: lastUsed.getBoundingClientRect().left > element.getBoundingClientRect().left,
      clipsSideways: getComputedStyle(element).overflowX === 'clip',
      // A dot typed into either part's text would stay on its line however the line wraps
      dotInText: (element.textContent ?? '').includes('·'),
      dotDrawn: getComputedStyle(lastUsed, '::before').content === '"·"',
    }
  })
  const openDialog = async () => {
    await openPage(page, '/settings#security')
    await page.locator('#security').getByRole('button', { name: 'Manage', exact: true }).click()
    await expect(dialog.getByText('last used 10 minutes ago')).toBeVisible()
  }

  for (const height of [844, 667]) {
    await page.setViewportSize({ width: 390, height })
    await openDialog()

    for (const text of ['last used 3 hours ago', 'last used 10 minutes ago', 'not used yet']) {
      expect(await isCutOff(text), `${text} at 390x${height}`).toBe(false)
    }
    expect(await lineCount('last used 10 minutes ago')).toBeGreaterThan(1)
    // A wrapped line shows no dot, rather than one that ends the first line or starts the second
    expect(await separator('last used 10 minutes ago'), `wrapped line at 390x${height}`)
      .toEqual({ wrapped: true, dotInView: false, clipsSideways: true, dotInText: false, dotDrawn: true })

    // A very long name still cuts off, and its row keeps inside the dialog
    const longName = dialog.getByText(LONG_NAME, { exact: true })
    expect(await longName.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    const menu = (await dialog.getByRole('button', { name: `Options for ${LONG_NAME}` }).boundingBox())!
    const dialogBox = (await dialog.boundingBox())!
    expect(menu.x + menu.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width)
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
  }

  await page.setViewportSize({ width: 1280, height: 800 })
  await openDialog()
  expect(await lineCount('last used 10 minutes ago')).toBe(1)
  expect(await isCutOff('last used 10 minutes ago')).toBe(false)
  // A line that fits keeps its dot between the two parts
  expect(await separator('last used 10 minutes ago')).toEqual({ wrapped: false, dotInView: true, clipsSideways: true, dotInText: false, dotDrawn: true })
})
