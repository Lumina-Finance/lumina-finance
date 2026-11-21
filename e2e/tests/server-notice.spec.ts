import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// The first test runs at every size, since the notice's clearance from the menu button depends on the
// screen's width. The reload offer for a server of another version needs a page built with a release
// number. This suite's dev instance builds none and CI builds the page and the server with the same
// one, so unit tests cover it

// Where the app's sidebar replaces the menu button, from the navigation in src/components/navigation
const SIDEBAR_BREAKPOINT_PX = 1050

const MAINTENANCE_NOTICE = 'Lumina Finance is down for maintenance. Please try again in a few minutes.'

test('shows a maintenance state in place of an unreachable server, and clears it once the server answers', AT_EVERY_SIZE, async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday Chequing' })

  // A maintenance refuses every request, so the notice is not cleared by a request that slips through.
  // The change check asks again every minute during one, and the clock below runs through that minute
  // at once. A fake clock stops the notice's eased exit halfway and this test is not about that exit,
  // so it asks for reduced motion and the notice leaves at once
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  let isInMaintenance = false
  const refusals = new Map<string, number>()
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    if (!isInMaintenance) {
      await route.continue()
      return
    }
    const path = new URL(route.request().url()).pathname
    refusals.set(path, (refusals.get(path) ?? 0) + 1)
    await route.fulfill({ status: 503, json: { detail: 'Back soon', maintenance: true } })
  })

  await logInViaApi(page, user)
  await openPage(page, '/settings')
  isInMaintenance = true
  // The menu is a hamburger on a phone, so the page is moved to the way the router follows Back
  await page.evaluate(() => {
    window.history.pushState({}, '', '/accounts')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  // The notice sits in its own status region, apart from the card that failed to load and says the same
  const notice = page.getByRole('status').getByText(MAINTENANCE_NOTICE, { exact: true })
  await expect(notice).toBeVisible()
  await expect(page.getByText(/reach the server/)).toHaveCount(0)

  // Below the width where the sidebar shows, the menu button floats over the top right of the page and
  // the notice stops short of it. At and above it there is no menu button
  const menuButton = page.getByRole('button', { name: 'Open navigation menu' })
  if (page.viewportSize()!.width < SIDEBAR_BREAKPOINT_PX) {
    await expect(menuButton).toBeVisible()
    const [noticeBox, menuBox] = await Promise.all([
      page.getByRole('status').getByRole('note').boundingBox(),
      menuButton.boundingBox(),
    ])
    expect(noticeBox!.x + noticeBox!.width).toBeLessThanOrEqual(menuBox!.x)
  } else {
    await expect(menuButton).toBeHidden()
  }

  // The screen asks for its own data once its code has arrived, and that can come after the page is
  // moved. It retries each refused request once, a second later. Any of those that is answered ends
  // the notice, so the server answers again only once each was refused twice
  for (const path of ['/dashboard/credit', '/dashboard/savings-rate', '/me/runway']) {
    const refusedCount = () => [...refusals].find(([refused]) => refused.endsWith(path))?.[1] ?? 0
    await expect.poll(refusedCount).toBeGreaterThanOrEqual(2)
  }
  await expect(notice).toBeVisible()

  // The page asks again by itself a minute after the maintenance began, with no tab focus or
  // navigation to cause a check. The clock keeps running in real time, so the first jump stops at
  // half a minute, well short of the minute whatever the real time spent since, and the notice stays
  isInMaintenance = false
  await page.clock.fastForward(30_000)
  await expect(notice).toBeVisible()
  await page.clock.fastForward(31_000)

  await expect(notice).toHaveCount(0)
  await expect(page.getByText(MAINTENANCE_NOTICE, { exact: true })).toHaveCount(0)
  await expect(page.getByText('Everyday Chequing').first()).toBeVisible()
})

test('says the server is in maintenance when the app is opened during one', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await page.route(`${API_BASE_URL}/auth/refresh`, async (route) => {
    await route.fulfill({ status: 503, json: { detail: 'Back soon', maintenance: true } })
  })

  await page.goto('/')

  await expect(page.getByText(MAINTENANCE_NOTICE, { exact: true })).toBeVisible()
  await expect(page.getByText(/reach the server/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
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

  await expect(page.getByText(MAINTENANCE_NOTICE, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/reach the server/)).toHaveCount(0)
})
