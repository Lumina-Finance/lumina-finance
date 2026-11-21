import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// The first test runs at every size, since the maintenance screen covers the whole window. The reload
// offer for a server of another version needs a page built with a release number. This suite's dev
// instance builds none and CI builds the page and the server with the same one, so unit tests cover it

const MAINTENANCE_NOTICE = 'Lumina Finance is down for maintenance. Please try again in a few minutes.'
const MAINTENANCE_HEADING = "We'll be back soon"

test('covers the app with a maintenance screen, keeps the page under it, and leaves once the server answers', AT_EVERY_SIZE, async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday Chequing' })

  // A maintenance refuses every request, so the screen is not cleared by a request that slips through.
  // The change check asks again every minute during one, and the clock below runs through that minute
  // at once. A fake clock stops an eased fade halfway and this test is not about that fade, so it asks
  // for reduced motion and the screen leaves at once
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  let isInMaintenance = false
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    if (!isInMaintenance) {
      await route.continue()
      return
    }
    await route.fulfill({ status: 503, json: { detail: 'Back soon', maintenance: true } })
  })

  // Built from the server's address, since a server under a path prefix puts it in front
  const cacheStatusPath = new URL(`${API_BASE_URL}/me/cache-status`).pathname
  let cacheChecks = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === cacheStatusPath) cacheChecks += 1
  })

  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  const search = page.getByPlaceholder('Search accounts...')
  await search.fill('Everyday')

  // Coming back to the window asks the server whether anything changed, and the answer is the maintenance
  isInMaintenance = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  const screen = page.getByRole('alertdialog', { name: MAINTENANCE_HEADING })
  await expect(screen).toBeVisible()
  await expect(screen.getByText(MAINTENANCE_NOTICE, { exact: true })).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Copy error details' })).toHaveCount(0)
  await expect(page.getByText(/reach the server/)).toHaveCount(0)

  // Nothing of the app under the screen can be reached by the keyboard or a screen reader
  expect(await page.evaluate(() => document.getElementById('root')?.inert)).toBe(true)
  await page.keyboard.press('Tab')
  await expect(screen.getByRole('button', { name: 'Reload', exact: true })).toBeFocused()

  // The page asks again by itself a minute after the maintenance began, with no tab focus or
  // navigation to cause a check. The clock keeps running in real time, so the first jump stops at
  // half a minute, well short of the minute whatever the real time spent since. The server answers
  // again from here, so a check made too early would end the maintenance, and the count of checks
  // proves none was made before the minute
  isInMaintenance = false
  const checksBeforeJump = cacheChecks
  await page.clock.fastForward(30_000)
  // A check made by the jump is sent before this request, so its count is in by the time this one
  // is answered. The request bypasses the app, so its answer leaves the screen as it was
  await page.evaluate(async (url) => {
    await fetch(url)
  }, `${API_BASE_URL}/version`)
  expect(cacheChecks).toBe(checksBeforeJump)
  await expect(screen).toBeVisible()
  await page.clock.fastForward(31_000)
  await expect.poll(() => cacheChecks).toBeGreaterThan(checksBeforeJump)

  await expect(screen).toHaveCount(0)
  expect(await page.evaluate(() => document.getElementById('root')?.inert)).toBe(false)
  await expect(search).toHaveValue('Everyday')
  await expect(search).toBeFocused()
  await expect(page.getByText('Everyday Chequing').first()).toBeVisible()
})

test('keeps the keyboard off an open dialogue under the maintenance screen', async ({ page, request }) => {
  const user = await signUpUser(request)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  let isInMaintenance = false
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    if (isInMaintenance) await route.fulfill({ status: 503, json: { detail: 'Back soon', maintenance: true } })
    else await route.continue()
  })

  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  await page.getByRole('button', { name: 'Add account' }).first().click()
  const dialogue = page.getByRole('dialog', { name: 'Add account' })
  await expect(dialogue).toBeVisible()
  // A shortcut listening on the window from before the maintenance, as a dialogue's save shortcut does
  await page.evaluate(() => {
    const keys: string[] = []
    Object.assign(window, { shortcutKeys: keys })
    window.addEventListener('keydown', (event) => keys.push(event.key), true)
  })

  isInMaintenance = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const screen = page.getByRole('alertdialog', { name: MAINTENANCE_HEADING })
  await expect(screen).toBeVisible()

  // Escape would close the dialogue, and its focus trap would hold Tab, if either reached it
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Enter')
  await page.keyboard.press('Tab')
  await expect(screen.getByRole('button', { name: 'Reload', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(screen.getByRole('button', { name: 'Reload', exact: true })).toBeFocused()
  expect(await page.evaluate(() => (window as unknown as { shortcutKeys: string[] }).shortcutKeys)).toEqual([])

  isInMaintenance = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(screen).toHaveCount(0)
  await expect(dialogue).toBeVisible()
})

test('says the server is in maintenance when the app is opened during one', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await page.route(`${API_BASE_URL}/auth/refresh`, async (route) => {
    await route.fulfill({ status: 503, json: { detail: 'Back soon', maintenance: true } })
  })

  await page.goto('/')

  await expect(page.getByRole('heading', { name: MAINTENANCE_HEADING })).toBeVisible()
  await expect(page.getByText(MAINTENANCE_NOTICE, { exact: true })).toBeVisible()
  await expect(page.getByText(/reach the server/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy error details' })).toHaveCount(0)
})

test('says the server is in maintenance from the maintenance file when the app is opened and nothing answers', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  // The whole server is out of reach, since any request it accepted would end the maintenance
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    await route.abort('connectionrefused')
  })
  await page.route('**/maintenance.json', async (route) => {
    await route.fulfill({ status: 200, json: { maintenance: true } })
  })

  await page.goto('/')

  await expect(page.getByText(MAINTENANCE_NOTICE, { exact: true })).toBeVisible()
  await expect(page.getByText(/reach the server/)).toHaveCount(0)
})

test('holds sign-in during a maintenance and gives it back once the server answers', async ({ page }) => {
  // The sign-in page asks again every minute during a maintenance, and the clock runs through that
  // minute at once. Nothing answers until then, and the maintenance file says the server is in one
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  let isDown = true
  let signInRequests = 0
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/auth/login')) signInRequests += 1
    if (isDown) await route.abort('connectionrefused')
    else await route.continue()
  })
  await page.route('**/maintenance.json', async (route) => {
    await route.fulfill({ status: 200, json: { maintenance: isDown } })
  })

  await page.goto('/login')
  // Filled in, so the only thing holding the button is the maintenance
  await page.getByLabel('Email').fill('someone@example.com')
  await page.getByLabel('Password').fill('a long enough password')

  const banner = page.getByRole('alert').getByText(MAINTENANCE_NOTICE, { exact: true })
  const logIn = page.getByRole('button', { name: 'Log in', exact: true })
  await expect(banner).toBeVisible()
  await expect(logIn).toBeDisabled()
  // Neither a click on the held button nor Enter in a field sends the sign-in
  await logIn.click({ force: true })
  await page.getByLabel('Password').press('Enter')
  await page.evaluate(async (url) => {
    await fetch(url).catch(() => undefined)
  }, `${API_BASE_URL}/version`)
  expect(signInRequests).toBe(0)

  isDown = false
  await page.clock.fastForward(61_000)

  await expect(banner).toHaveCount(0)
  await expect(logIn).toBeEnabled()
})

test('gives sign-up one maintenance message, and loads its currencies once the server answers', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  let isDown = true
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    if (isDown) await route.abort('connectionrefused')
    else await route.continue()
  })
  await page.route('**/maintenance.json', async (route) => {
    await route.fulfill({ status: 200, json: { maintenance: isDown } })
  })

  await page.goto('/signup')

  await expect(page.getByRole('alert').getByText(MAINTENANCE_NOTICE, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign up', exact: true })).toBeDisabled()
  // A retry offer would fail the same way until the maintenance ends
  await expect(page.getByText('Unable to load currencies.')).toHaveCount(0)
  // The page's own retries ran when the list failed, so only the reload when the maintenance ends
  // can replace this
  await expect(page.getByText('Failed to load currencies')).toBeVisible()

  isDown = false
  await page.clock.fastForward(61_000)

  await expect(page.getByRole('alert')).toHaveCount(0)
  // The picker fills in a currency only once the list has arrived
  await expect(page.getByRole('combobox', { name: 'Base currency' })).toContainText(' · ')
})
